-- Run once in the Supabase SQL Editor to add account-level ntfy delivery.
create table if not exists public.notification_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  ntfy_topic text check (ntfy_topic is null or ntfy_topic ~ '^[A-Za-z0-9_-]{1,64}$'),
  timezone text not null default 'UTC',
  preferences jsonb not null default '{}'::jsonb,
  last_sent jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.notification_settings enable row level security;
revoke all on public.notification_settings from anon, authenticated;
grant select, insert, update on public.notification_settings to authenticated;

drop policy if exists "Users manage their own notification settings" on public.notification_settings;
create policy "Users manage their own notification settings" on public.notification_settings
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
