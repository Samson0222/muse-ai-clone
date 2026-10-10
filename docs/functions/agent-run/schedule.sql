-- Production cron dispatcher for `agent-run`.
--
-- Run this in the Supabase SQL Editor after deploying `agent-run`.
-- This creates one global cron job that asks the Edge Function to run all due
-- rows from `public.scheduled_agent_tasks`.
--
-- SECURITY: this file is committed with placeholders only.
-- Paste the real values into the SQL Editor when you run it, and never save
-- them back into this file.
--
-- How the call is authenticated:
-- - `agent-run` is deployed with the gateway JWT check OFF:
--     supabase functions deploy agent-run --no-verify-jwt
--   The newer `sb_publishable_` API keys are not JWTs, so the gateway would
--   reject this cron call. The function authenticates callers itself: users by
--   their access token, this cron job by `x-cron-secret`.
-- - `x-cron-secret` must equal the `CRON_SECRET` function secret, which
--   `agent-run` checks before running the dispatcher:
--     supabase secrets set CRON_SECRET="<same value>"
--   Generate one with:  openssl rand -hex 32
-- - No API key and no service-role key is stored in the database.
--
-- Important:
-- - Do not put a hardcoded userId or task here.
-- - User-created schedules should be saved in `public.scheduled_agent_tasks`.
-- - The Edge Function handles `mode = "run_due_schedules"`.

create extension if not exists pg_cron;
create extension if not exists pg_net;
create extension if not exists supabase_vault with schema vault;

-- Create-or-update the Vault secrets (safe to re-run).
do $$
declare
  secret_values constant jsonb := jsonb_build_object(
    'muse_agent_project_url', 'https://YOUR_PROJECT_REF.supabase.co',
    'muse_agent_cron_secret', 'YOUR_CRON_SECRET'
  );
  secret_name text;
  existing_id uuid;
begin
  for secret_name in select jsonb_object_keys(secret_values) loop
    select id into existing_id from vault.secrets where name = secret_name;

    if existing_id is null then
      perform vault.create_secret(secret_values ->> secret_name, secret_name);
    else
      perform vault.update_secret(existing_id, secret_values ->> secret_name);
    end if;
  end loop;
end;
$$;

-- Keep this cron setup re-runnable by removing the previous job if it exists.
do $$
begin
  perform cron.unschedule('muse-agent-run-due-schedules');
exception
  when others then
    null;
end;
$$;

select cron.schedule(
  'muse-agent-run-due-schedules',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := (
      select decrypted_secret
      from vault.decrypted_secrets
      where name = 'muse_agent_project_url'
    )
      || '/functions/v1/agent-run',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'muse_agent_cron_secret'
      )
    ),
    body := jsonb_build_object(
      'mode', 'run_due_schedules',
      'source', 'pg_cron',
      'triggeredAt', now()
    )
  );
  $$
);

-- Optional cleanup, once the job above is scheduled: earlier versions of this
-- file stored a service-role key or an anon key in the Vault. They are unused.
-- delete from vault.secrets where name in ('muse_agent_service_role_key', 'muse_agent_anon_key');
