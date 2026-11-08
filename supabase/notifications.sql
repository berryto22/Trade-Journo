-- Run once in the Supabase SQL Editor to enable per-browser push reminders.
create table if not exists public.push_subscriptions (
  endpoint text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  subscription jsonb not null,
  timezone text not null default 'UTC',
  preferences jsonb not null default '{"mondayReminder":true,"mondayTime":"08:00","londonPrep":true,"prepMinutes":30,"londonOpen":true}'::jsonb,
  last_sent jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from anon, authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;

drop policy if exists "Users manage their own browser push subscriptions" on public.push_subscriptions;
create policy "Users manage their own browser push subscriptions" on public.push_subscriptions
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
