create extension if not exists pgcrypto with schema extensions;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 80),
  role text not null default 'tutor' check (role in ('admin', 'tutor')),
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
declare
  profile_id_attnum smallint;
  profile_full_name_attnum smallint;
  profile_role_attnum smallint;
  auth_user_id_attnum smallint;
begin
  select attnum into profile_id_attnum
    from pg_attribute
    where attrelid = 'public.profiles'::regclass and attname = 'id' and not attisdropped
      and atttypid = 'uuid'::regtype and attnotnull;
  select attnum into profile_full_name_attnum
    from pg_attribute
    where attrelid = 'public.profiles'::regclass and attname = 'full_name' and not attisdropped
      and atttypid = 'text'::regtype and attnotnull;
  select attnum into profile_role_attnum
    from pg_attribute
    where attrelid = 'public.profiles'::regclass and attname = 'role' and not attisdropped
      and atttypid = 'text'::regtype and attnotnull;
  select attnum into auth_user_id_attnum
    from pg_attribute
    where attrelid = 'auth.users'::regclass and attname = 'id' and not attisdropped
      and atttypid = 'uuid'::regtype;

  if profile_id_attnum is null or profile_full_name_attnum is null or profile_role_attnum is null
    or auth_user_id_attnum is null
    or not exists (
      select 1 from pg_attribute
      where attrelid = 'public.profiles'::regclass and attname = 'is_active' and not attisdropped
        and atttypid = 'boolean'::regtype and attnotnull
    )
    or not exists (
      select 1 from pg_attribute
      where attrelid = 'public.profiles'::regclass and attname = 'created_at' and not attisdropped
        and atttypid = 'timestamptz'::regtype and attnotnull
    )
    or not exists (
      select 1 from pg_attribute
      where attrelid = 'public.profiles'::regclass and attname = 'updated_at' and not attisdropped
        and atttypid = 'timestamptz'::regtype and attnotnull
    ) then
    raise exception 'public.profiles has incompatible required columns. Existing profiles were not modified.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'p'
      and conkey = array[profile_id_attnum]::smallint[]
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'f'
      and conkey = array[profile_id_attnum]::smallint[]
      and confrelid = 'auth.users'::regclass
      and confkey = array[auth_user_id_attnum]::smallint[] and confdeltype = 'c'
      and convalidated
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'length.*trim.*full_name'
      and pg_get_constraintdef(oid) ~ '>= *2'
      and pg_get_constraintdef(oid) ~ '<= *80'
      and convalidated
  ) or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.profiles'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) ~* 'role.*=[[:space:]]*any.*''admin''.*''tutor'''
      and convalidated
  ) then
    raise exception 'public.profiles is missing a required primary key, auth foreign key, or value constraint. Existing profiles were not modified.';
  end if;

  if not exists (
    select 1
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.profiles'::regclass and a.attname = 'role'
      and replace(lower(pg_get_expr(d.adbin, d.adrelid)), ' ', '') in ('''tutor''::text', '''tutor''')
  ) or not exists (
    select 1
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.profiles'::regclass and a.attname = 'is_active'
      and replace(lower(pg_get_expr(d.adbin, d.adrelid)), ' ', '') = 'false'
  ) or not exists (
    select 1
    from pg_attribute a
    join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
    where a.attrelid = 'public.profiles'::regclass and a.attname in ('created_at', 'updated_at')
      and replace(lower(pg_get_expr(d.adbin, d.adrelid)), ' ', '') in ('now()', 'current_timestamp')
    group by a.attrelid
    having count(distinct a.attname) = 2
  ) then
    raise exception 'public.profiles has incompatible defaults. Existing profiles were not modified.';
  end if;
end;
$$;

create table public.user_areas (
  user_id uuid not null references public.profiles(id) on delete cascade,
  area_code text not null check (area_code in ('Mat', 'Lec', 'Soc', 'Nat', 'Ing')),
  primary key (user_id, area_code)
);

create table public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  file_name text not null,
  storage_path text not null unique,
  mime_type text not null default 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  file_size bigint not null check (file_size > 0),
  areas text[] not null default '{}' check (areas <@ array['Mat', 'Lec', 'Soc', 'Nat', 'Ing']::text[]),
  status text not null default 'uploaded' check (status in ('uploaded', 'processed', 'failed')),
  processing_error text,
  processed_storage_path text,
  created_at timestamptz not null default now(),
  check (storage_path like owner_id::text || '/private/' || id::text || '/%'),
  check (
    processed_storage_path is null
    or processed_storage_path like owner_id::text || '/private/' || id::text || '/%'
  )
);

create table public.questions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents(id) on delete cascade,
  owner_id uuid not null references public.profiles(id),
  source_key text not null,
  session_number smallint check (session_number in (1, 2)),
  question_number text not null,
  area_code text check (area_code in ('Mat', 'Lec', 'Soc', 'Nat', 'Ing')),
  classification_confidence numeric(4,3) check (classification_confidence between 0 and 1),
  classification_reason text,
  is_manual_classification boolean not null default false,
  question_payload jsonb not null,
  updated_at timestamptz not null default now(),
  unique (document_id, source_key)
);

create table public.compilations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id),
  compilation_type text not null check (compilation_type in ('simulacro', 'compilado', 'mini-simulacro')),
  area_code text check (area_code in ('Mat', 'Lec', 'Soc', 'Nat', 'Ing')),
  title text not null,
  configuration jsonb not null default '{}',
  question_ids uuid[] not null default '{}',
  pdf_storage_path text,
  created_at timestamptz not null default now()
);

create table public.operation_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references public.profiles(id),
  operation text not null,
  entity_type text,
  entity_id text,
  area_code text,
  status text not null check (status in ('success', 'failure')),
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index documents_owner_created_idx on public.documents (owner_id, created_at desc);
create index questions_document_idx on public.questions (document_id, session_number, question_number);
create index questions_area_idx on public.questions (area_code);
create index compilations_owner_created_idx on public.compilations (owner_id, created_at desc);
create index operation_logs_created_idx on public.operation_logs (created_at desc);

create or replace function public.catalyst_is_active()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function public.catalyst_is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  );
$$;

create or replace function public.catalyst_has_area(target_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or exists (
      select 1 from public.user_areas ua
      where ua.user_id = (select auth.uid()) and ua.area_code = target_area
    )
  );
$$;

create or replace function public.catalyst_has_all_areas(target_areas text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or coalesce(target_areas, '{}'::text[]) <@ array(
      select ua.area_code from public.user_areas ua where ua.user_id = (select auth.uid())
    )
  );
$$;

create or replace function public.catalyst_can_delete_private_file(target_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or (
      (storage.foldername(target_name))[1] = (select auth.uid())::text
      and not exists (
        select 1 from public.documents d
        where d.owner_id = (select auth.uid())
          and (d.storage_path = target_name or d.processed_storage_path = target_name)
          and not public.catalyst_has_all_areas(d.areas)
      )
    )
  );
$$;

create or replace function public.catalyst_can_use_questions(target_ids uuid[], target_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or not exists (
      select 1
      from unnest(coalesce(target_ids, '{}'::uuid[])) requested(id)
      left join public.questions q on q.id = requested.id
      where q.id is null or q.area_code is null
        or not public.catalyst_has_area(q.area_code)
        or (target_area is not null and q.area_code <> target_area)
    )
  );
$$;

create or replace function public.catalyst_admin_configure_user(
  actor_id uuid,
  target_id uuid,
  new_name text,
  new_role text,
  new_areas text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_areas text[] := coalesce(new_areas, '{}'::text[]);
  existing_role text;
  existing_active boolean;
begin
  if not exists (select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin' and p.is_active) then
    raise exception 'Active administrator required.';
  end if;
  perform pg_advisory_xact_lock(801177031);
  if target_id = actor_id and new_role <> 'admin' then
    raise exception 'Administrator cannot remove own role.';
  end if;
  if length(trim(new_name)) not between 2 and 80 or new_role not in ('admin', 'tutor') then
    raise exception 'Invalid user name or role.';
  end if;
  if new_role = 'tutor' and cardinality(assigned_areas) = 0 then
    raise exception 'Tutor must have at least one assigned area.';
  end if;
  if exists (select 1 from unnest(assigned_areas) as candidate(code)
    where candidate.code not in ('Mat', 'Lec', 'Soc', 'Nat', 'Ing')) then
    raise exception 'Invalid area assignment.';
  end if;
  select p.role, p.is_active into existing_role, existing_active
    from public.profiles p where p.id = target_id for update;
  if not found then raise exception 'User profile does not exist.'; end if;
  if existing_role = 'admin' and existing_active and new_role <> 'admin'
    and (select count(*) from public.profiles p where p.role = 'admin' and p.is_active) <= 1 then
    raise exception 'At least one active administrator must remain.';
  end if;
  update public.profiles
    set full_name = trim(new_name), role = new_role, updated_at = now()
    where id = target_id;
  delete from public.user_areas where user_id = target_id;
  insert into public.user_areas (user_id, area_code)
    select target_id, candidate.code
    from (select distinct code from unnest(assigned_areas) as area(code)) candidate;
end;
$$;

create or replace function public.catalyst_admin_set_user_active(
  actor_id uuid,
  target_id uuid,
  active_state boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_role text;
begin
  if not exists (select 1 from public.profiles p
    where p.id = actor_id and p.role = 'admin' and p.is_active) then
    raise exception 'Active administrator required.';
  end if;
  perform pg_advisory_xact_lock(801177031);
  if target_id = actor_id then raise exception 'Administrator cannot change own account status.'; end if;
  select p.role into target_role from public.profiles p where p.id = target_id for update;
  if not found then raise exception 'User profile does not exist.'; end if;
  if not active_state and target_role = 'admin'
    and (select count(*) from public.profiles p where p.role = 'admin' and p.is_active) <= 1 then
    raise exception 'At least one active administrator must remain.';
  end if;
  update public.profiles set is_active = active_state, updated_at = now() where id = target_id;
end;
$$;

alter table public.profiles enable row level security;
alter table public.user_areas enable row level security;
alter table public.documents enable row level security;
alter table public.questions enable row level security;
alter table public.compilations enable row level security;
alter table public.operation_logs enable row level security;

create policy "profiles readable by self or admin"
  on public.profiles for select to authenticated
  using (id = (select auth.uid()) or public.catalyst_is_admin());

create policy "areas readable by self or admin"
  on public.user_areas for select to authenticated
  using (user_id = (select auth.uid()) or public.catalyst_is_admin());

create policy "documents readable by owner or authorized area"
  on public.documents for select to authenticated
  using (
    public.catalyst_is_active()
    and ((owner_id = (select auth.uid()) and public.catalyst_has_all_areas(areas))
      or public.catalyst_is_admin()
      or exists (select 1 from unnest(areas) as candidate(code)
        where public.catalyst_has_area(candidate.code)))
  );
create policy "documents insert by authorized owner"
  on public.documents for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.catalyst_is_active()
    and (public.catalyst_is_admin() or areas <@ array(
      select ua.area_code from public.user_areas ua where ua.user_id = (select auth.uid())
    )));
create policy "documents update by owner or admin"
  on public.documents for update to authenticated
  using (public.catalyst_is_active() and
    (owner_id = (select auth.uid()) or public.catalyst_is_admin()))
  with check (public.catalyst_is_active() and
    (public.catalyst_is_admin() or (owner_id = (select auth.uid()) and areas <@ array(
      select ua.area_code from public.user_areas ua where ua.user_id = (select auth.uid())
    ))));
create policy "documents delete by owner or admin"
  on public.documents for delete to authenticated
  using (public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or (owner_id = (select auth.uid()) and public.catalyst_has_all_areas(areas))
  ));

create or replace function public.catalyst_guard_document_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.catalyst_is_admin() and (
    new.id <> old.id
    or new.owner_id <> old.owner_id
    or new.file_name <> old.file_name
    or new.storage_path <> old.storage_path
    or new.mime_type <> old.mime_type
    or new.file_size <> old.file_size
    or new.areas is distinct from old.areas
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Tutors cannot change document identity or area metadata.';
  end if;
  return new;
end;
$$;

create trigger catalyst_document_identity_immutable
  before update on public.documents
  for each row execute function public.catalyst_guard_document_identity();

create policy "questions readable by authorized area"
  on public.questions for select to authenticated
  using (public.catalyst_is_active() and
    (public.catalyst_is_admin() or (area_code is not null and public.catalyst_has_area(area_code))
      or (owner_id = (select auth.uid()) and area_code is null)));
create policy "questions insert in authorized area"
  on public.questions for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.catalyst_is_active()
    and exists (select 1 from public.documents d where d.id = document_id and d.owner_id = (select auth.uid()))
    and (public.catalyst_is_admin() or area_code is null or public.catalyst_has_area(area_code)));
create policy "questions update within authorized area"
  on public.questions for update to authenticated
  using (public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or (area_code is not null and public.catalyst_has_area(area_code))
    or (owner_id = (select auth.uid()) and area_code is null)
  ))
  with check (public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or area_code is null
    or public.catalyst_has_area(area_code)
  ));
create policy "questions delete by owner or admin"
  on public.questions for delete to authenticated
  using (public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or (owner_id = (select auth.uid()) and
      (area_code is null or public.catalyst_has_area(area_code)))
  ));

create or replace function public.catalyst_guard_question_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.catalyst_is_admin() then
    if new.owner_id <> old.owner_id
      or new.document_id <> old.document_id
      or new.source_key <> old.source_key
      or new.session_number is distinct from old.session_number
      or new.question_number is distinct from old.question_number
      or new.question_payload is distinct from old.question_payload
      or new.classification_confidence is distinct from old.classification_confidence
      or (old.is_manual_classification and not new.is_manual_classification) then
      raise exception 'Tutors may only correct a question classification.';
    end if;
  end if;
  return new;
end;
$$;

create trigger catalyst_question_identity_immutable
  before update on public.questions
  for each row execute function public.catalyst_guard_question_identity();

create policy "compilations readable by authorized area"
  on public.compilations for select to authenticated
  using (public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or ((area_code is null or public.catalyst_has_area(area_code))
      and public.catalyst_can_use_questions(question_ids, area_code))
  ));
create policy "compilations insert in authorized area"
  on public.compilations for insert to authenticated
  with check (owner_id = (select auth.uid()) and public.catalyst_is_active()
    and (area_code is null or public.catalyst_has_area(area_code))
    and public.catalyst_can_use_questions(question_ids, area_code));
create policy "compilations update by owner or admin"
  on public.compilations for update to authenticated
  using (public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or (owner_id = (select auth.uid())
      and (area_code is null or public.catalyst_has_area(area_code))
      and public.catalyst_can_use_questions(question_ids, area_code))
  ))
  with check ((owner_id = (select auth.uid()) or public.catalyst_is_admin())
    and (area_code is null or public.catalyst_has_area(area_code))
    and public.catalyst_can_use_questions(question_ids, area_code));
create policy "compilations delete by owner or admin"
  on public.compilations for delete to authenticated
  using (public.catalyst_is_active() and (
    public.catalyst_is_admin()
    or (owner_id = (select auth.uid())
      and (area_code is null or public.catalyst_has_area(area_code))
      and public.catalyst_can_use_questions(question_ids, area_code))
  ));

create policy "logs readable by admin"
  on public.operation_logs for select to authenticated
  using (
    public.catalyst_is_active()
    and (public.catalyst_is_admin() or (
      actor_id = (select auth.uid())
      and (area_code is null or public.catalyst_has_area(area_code))
    ))
  );
create policy "logs insert by active actor"
  on public.operation_logs for insert to authenticated
  with check (
    actor_id = (select auth.uid())
    and public.catalyst_is_active()
    and (area_code is null or public.catalyst_has_area(area_code))
  );

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'catalyst-private',
  'catalyst-private',
  false,
  52428800,
  array[
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/pdf',
    'application/json',
    'image/png',
    'image/jpeg',
    'image/webp'
  ]
)
on conflict (id) do nothing;

create policy "private files readable by owner or administrator"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'catalyst-private'
    and public.catalyst_is_active()
    and (public.catalyst_is_admin() or exists (
      select 1 from public.documents d
      where d.owner_id = (select auth.uid())
        and (d.storage_path = name or d.processed_storage_path = name)
        and public.catalyst_has_all_areas(d.areas)
    ))
  );
create policy "private files upload under own authorized folder"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'catalyst-private'
    and (storage.foldername(name))[1] = (select auth.uid())::text
    and public.catalyst_is_active()
  );
create policy "private files update by owner or admin"
  on storage.objects for update to authenticated
  using (bucket_id = 'catalyst-private' and public.catalyst_is_active() and (
    public.catalyst_is_admin() or exists (
      select 1 from public.documents d
      where d.owner_id = (select auth.uid())
        and (d.storage_path = name or d.processed_storage_path = name)
        and public.catalyst_has_all_areas(d.areas)
    )
  ))
  with check (bucket_id = 'catalyst-private' and public.catalyst_is_active() and (
    public.catalyst_is_admin() or exists (
      select 1 from public.documents d
      where d.owner_id = (select auth.uid())
        and (d.storage_path = name or d.processed_storage_path = name)
        and public.catalyst_has_all_areas(d.areas)
    )
  ));
create policy "private files delete by owner or admin"
  on storage.objects for delete to authenticated
  using (bucket_id = 'catalyst-private' and public.catalyst_can_delete_private_file(name));

grant select on public.profiles, public.user_areas to authenticated;
grant select, insert, update, delete on public.documents, public.questions, public.compilations to authenticated;
grant select, insert on public.operation_logs to authenticated;

revoke all on function public.catalyst_is_active() from public, anon;
revoke all on function public.catalyst_is_admin() from public, anon;
revoke all on function public.catalyst_has_area(text) from public, anon;
revoke all on function public.catalyst_has_all_areas(text[]) from public, anon;
revoke all on function public.catalyst_can_delete_private_file(text) from public, anon;
revoke all on function public.catalyst_can_use_questions(uuid[], text) from public, anon;
revoke all on function public.catalyst_admin_configure_user(uuid, uuid, text, text, text[]) from public, anon, authenticated;
revoke all on function public.catalyst_admin_set_user_active(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.catalyst_guard_question_identity() from public, anon;
revoke all on function public.catalyst_guard_document_identity() from public, anon;
grant execute on function public.catalyst_is_active() to authenticated;
grant execute on function public.catalyst_is_admin() to authenticated;
grant execute on function public.catalyst_has_area(text) to authenticated;
grant execute on function public.catalyst_has_all_areas(text[]) to authenticated;
grant execute on function public.catalyst_can_delete_private_file(text) to authenticated;
grant execute on function public.catalyst_can_use_questions(uuid[], text) to authenticated;
grant execute on function public.catalyst_admin_configure_user(uuid, uuid, text, text, text[]) to service_role;
grant execute on function public.catalyst_admin_set_user_active(uuid, uuid, boolean) to service_role;
