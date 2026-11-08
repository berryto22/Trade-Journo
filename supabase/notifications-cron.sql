-- Configure placeholders before running this once in the Supabase SQL Editor.
-- Enable pg_cron, pg_net and Vault first if they are not enabled on the project.
select vault.create_secret('https://dbgfxmeuivxmbcbssrlr.supabase.co', 'trade_journal_project_url');
select vault.create_secret('YOUR_NOTIFICATION_SCHEDULER_SECRET', 'trade_journal_scheduler_secret');

select cron.schedule(
  'trade-journal-browser-reminders',
  '* * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'trade_journal_project_url') || '/functions/v1/scheduled-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-scheduler-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'trade_journal_scheduler_secret')
    ),
    body := '{}'::jsonb
  );
  $$
);
