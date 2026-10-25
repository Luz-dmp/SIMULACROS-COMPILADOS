begin;

do $$
declare
  bucket_is_private boolean;
  project_url text;
  publishable_key text;
  cleanup_secret text;
begin
  if to_regclass('public.documents') is null
    or to_regclass('public.compilations') is null
    or to_regclass('public.operation_logs') is null
    or to_regclass('storage.objects') is null
    or to_regprocedure('public.catalyst_is_active()') is null
    or to_regprocedure('public.catalyst_is_admin()') is null
    or to_regprocedure('public.catalyst_has_area(text)') is null
    or to_regprocedure('public.catalyst_can_use_questions(uuid[],text)') is null
    or to_regprocedure('extensions.hmac(bytea,bytea,text)') is null then
    raise exception 'Catalyst PDF hardening prerequisites are missing. Inspect the remote schema and migration history before applying this migration.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compilations'
      and column_name = 'id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compilations'
      and column_name = 'owner_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compilations'
      and column_name = 'area_code' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compilations'
      and column_name = 'pdf_created_at' and data_type = 'timestamp with time zone'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compilations'
      and column_name = 'pdf_storage_path' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'compilations'
      and column_name = 'question_ids' and data_type = 'ARRAY'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'storage_path' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'documents'
      and column_name = 'processed_storage_path' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operation_logs'
      and column_name = 'actor_id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operation_logs'
      and column_name = 'entity_id' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operation_logs'
      and column_name = 'operation' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operation_logs'
      and column_name = 'entity_type' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operation_logs'
      and column_name = 'status' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'operation_logs'
      and column_name = 'details' and data_type = 'jsonb'
  ) then
    raise exception 'Catalyst PDF hardening schema does not match the locally known Catalyst schema. No changes were made.';
  end if;

  select b.public is false into bucket_is_private
    from storage.buckets b where b.id = 'catalyst-private';
  if bucket_is_private is distinct from true then
    raise exception 'The catalyst-private bucket is missing or public. No changes were made.';
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Supabase Vault is unavailable. Configure Vault and verify the project before applying this migration.';
  end if;

  select decrypted_secret into project_url
    from vault.decrypted_secrets where name = 'catalyst_supabase_url';
  select decrypted_secret into publishable_key
    from vault.decrypted_secrets where name = 'catalyst_publishable_key';
  select decrypted_secret into cleanup_secret
    from vault.decrypted_secrets where name = 'catalyst_pdf_cleanup_secret';

  if coalesce(project_url, '') = ''
    or coalesce(publishable_key, '') = ''
    or coalesce(cleanup_secret, '') = '' then
    raise exception 'Configure catalyst_supabase_url, catalyst_publishable_key, and catalyst_pdf_cleanup_secret in Supabase Vault before applying this migration.';
  end if;
end;
$$;

drop policy if exists "private files upload under own authorized folder" on storage.objects;
create policy "private files upload under own authorized folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'catalyst-private'
    and public.catalyst_is_active()
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and case
      when name ~* '[.]pdf$'
        or lower(coalesce(metadata ->> 'mimetype', '')) = 'application/pdf' then
        (storage.foldername(name))[2] = 'generated-pdfs'
        and lower(coalesce(metadata ->> 'mimetype', '')) = 'application/pdf'
        and name ~* (
          '^' || (select auth.uid())::text
          || '/generated-pdfs/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
          || '/pdf-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[.]pdf$'
        )
        and exists (
          select 1 from public.compilations c
          where c.id::text = (storage.foldername(name))[3]
            and c.owner_id = (select auth.uid())
            and c.pdf_storage_path = name
            and c.pdf_created_at > now() - interval '15 days'
            and (
              public.catalyst_is_admin()
              or (
                (c.area_code is null or public.catalyst_has_area(c.area_code))
                and public.catalyst_can_use_questions(c.question_ids, c.area_code)
              )
            )
        )
      else (storage.foldername(name))[2] is distinct from 'generated-pdfs'
    end
  );

drop policy if exists "generated PDFs readable by authorized compilation users" on storage.objects;
drop policy if exists "generated PDFs readable by owner or administrator" on storage.objects;
create policy "generated PDFs readable by owner or administrator"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'catalyst-private'
    and public.catalyst_is_active()
    and exists (
      select 1 from public.compilations c
      where c.pdf_storage_path = name
        and (
          public.catalyst_is_admin()
          or (
            c.owner_id = (select auth.uid())
            and (c.area_code is null or public.catalyst_has_area(c.area_code))
            and public.catalyst_can_use_questions(c.question_ids, c.area_code)
          )
        )
    )
  );

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

do $$
begin
  perform cron.unschedule(jobid)
    from cron.job
    where jobname = 'catalyst-generated-pdf-retention';

  perform cron.schedule(
    'catalyst-generated-pdf-retention',
    '*/15 * * * *',
    $job$
      with signing as (
        select
          floor(extract(epoch from clock_timestamp()))::bigint::text as request_timestamp,
          (select decrypted_secret from vault.decrypted_secrets
            where name = 'catalyst_pdf_cleanup_secret') as cleanup_secret
      )
      select net.http_post(
        url := (select decrypted_secret from vault.decrypted_secrets
          where name = 'catalyst_supabase_url') || '/functions/v1/cleanup-generated-pdfs',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'apikey', (select decrypted_secret from vault.decrypted_secrets
            where name = 'catalyst_publishable_key'),
          'x-catalyst-timestamp', signing.request_timestamp,
          'x-catalyst-signature', encode(
            extensions.hmac(
              convert_to(signing.request_timestamp, 'UTF8'),
              convert_to(signing.cleanup_secret, 'UTF8'),
              'sha256'
            ),
            'hex'
          )
        ),
        body := '{}'::jsonb
      )
      from signing;
    $job$
  );
end;
$$;

commit;
