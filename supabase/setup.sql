-- Run once in the Supabase SQL Editor for this project.
-- The browser uses the publishable key only; all data is protected by RLS.

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  phone text,
  avatar_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_data (
  user_id uuid primary key references auth.users(id) on delete cascade,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.user_data enable row level security;
revoke all on public.profiles, public.user_data from anon, authenticated;
grant select, insert, update on public.profiles to authenticated;
grant select, insert, update on public.user_data to authenticated;

drop policy if exists "Users manage their own profile" on public.profiles;
create policy "Users manage their own profile" on public.profiles
  for all to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

drop policy if exists "Users manage their own journal data" on public.user_data;
create policy "Users manage their own journal data" on public.user_data
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute procedure public.create_profile_for_new_user();

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('trade-media', 'trade-media', false, 52428800, array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'])
on conflict (id) do update set public = false, file_size_limit = 52428800;
update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','video/mp4','video/webm','video/quicktime'] where id = 'trade-media';

drop policy if exists "Users read their own trade media" on storage.objects;
create policy "Users read their own trade media" on storage.objects
  for select to authenticated
  using (bucket_id = 'trade-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users upload their own trade media" on storage.objects;
create policy "Users upload their own trade media" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'trade-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users update their own trade media" on storage.objects;
create policy "Users update their own trade media" on storage.objects
  for update to authenticated
  using (bucket_id = 'trade-media' and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'trade-media' and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "Users delete their own trade media" on storage.objects;
create policy "Users delete their own trade media" on storage.objects
  for delete to authenticated
  using (bucket_id = 'trade-media' and (storage.foldername(name))[1] = (select auth.uid())::text);
