begin;

do $$
begin
  if to_regclass('public.profiles') is null
    or to_regclass('public.user_areas') is null
    or to_regprocedure('public.catalyst_admin_configure_user(uuid,uuid,text,text,text[])') is null then
    raise exception 'Catalyst core migration is missing. Apply 20261023173300_catalyst_core.sql before this auth compatibility migration.';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'id' and data_type = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'full_name' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'role' and data_type = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'profiles'
      and column_name = 'is_active' and data_type = 'boolean'
  ) then
    raise exception 'public.profiles exists, but its columns do not match the Catalyst schema. Stop and review the existing database before continuing.';
  end if;
end;
$$;

do $$
begin
  if to_regprocedure('public.handle_new_user()') is null then
    execute $function$
      create function public.handle_new_user()
      returns trigger
      language plpgsql
      security definer
      set search_path = ''
      as $body$
      begin
        insert into public.profiles (id, full_name, role, is_active)
        values (
          new.id,
          coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'Nuevo usuario'),
          'tutor',
          false
        )
        on conflict (id) do nothing;
        return new;
      end;
      $body$;
    $function$;
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and t.tgname = 'on_auth_user_created'
      and not t.tgisinternal
  ) then
    execute $trigger$
      create trigger on_auth_user_created
      after insert on auth.users
      for each row execute function public.handle_new_user()
    $trigger$;
  end if;

  if not exists (
    select 1 from pg_trigger t
    where t.tgrelid = 'auth.users'::regclass
      and t.tgname = 'on_auth_user_created'
      and t.tgfoid = 'public.handle_new_user()'::regprocedure
      and t.tgtype = 5
      and t.tgenabled in ('O', 'A')
      and not t.tgisinternal
  ) then
    raise exception 'The active on_auth_user_created trigger must call public.handle_new_user() after INSERT. Existing user records and triggers were not modified.';
  end if;
end;
$$;

commit;
