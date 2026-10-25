begin;

alter table public.compilations
  add column pdf_created_at timestamptz;

alter table public.compilations
  add constraint compilations_pdf_path_matches_owner
  check (
    pdf_storage_path is null
    or pdf_storage_path ~ (
      '^' || owner_id::text || '/generated-pdfs/' || id::text || '/pdf-[0-9a-f-]{36}[.]pdf$'
    )
  ),
  add constraint compilations_pdf_path_and_created_at_match
  check ((pdf_storage_path is null) = (pdf_created_at is null));

create index compilations_pdf_retention_idx
  on public.compilations (pdf_created_at)
  where pdf_storage_path is not null;

create index operation_logs_pdf_retention_idx
  on public.operation_logs (created_at)
  where operation = 'pdf.generated' and entity_type = 'compilation';

create policy "generated PDFs readable by authorized compilation users"
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
            (c.area_code is null or public.catalyst_has_area(c.area_code))
            and public.catalyst_can_use_questions(c.question_ids, c.area_code)
          )
        )
    )
  );

create or replace function public.catalyst_validate_generated_pdf_history()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  compilation public.compilations%rowtype;
begin
  if new.operation <> 'pdf.generated' then
    return new;
  end if;

  if new.entity_type is distinct from 'compilation'
    or new.status is distinct from 'success'
    or new.details ->> 'pdfRetention' is distinct from 'true' then
    raise exception 'Generated PDF history entries must use the dedicated retention marker.';
  end if;

  select * into compilation
    from public.compilations c
    where c.id::text = new.entity_id;

  if not found then
    raise exception 'Generated PDF history must reference an existing compilation.';
  end if;
  if compilation.owner_id is distinct from new.actor_id
    or compilation.area_code is distinct from new.area_code
    or compilation.pdf_storage_path is distinct from new.details ->> 'pdfStoragePath'
    or compilation.pdf_created_at is distinct from (new.details ->> 'pdfCreatedAt')::timestamptz then
    raise exception 'Generated PDF history must match its owning compilation and stored PDF.';
  end if;

  return new;
end;
$$;

create trigger catalyst_validate_generated_pdf_history
  before insert on public.operation_logs
  for each row execute function public.catalyst_validate_generated_pdf_history();

revoke all on function public.catalyst_validate_generated_pdf_history() from public, anon, authenticated;

commit;
