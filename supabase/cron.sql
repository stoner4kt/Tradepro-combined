-- ============================================================================
-- Invoicing reminder cron template (pg_cron + pg_net + vault)
-- ----------------------------------------------------------------------------
-- This file is TEMPLATE DOCUMENTATION, not an applied migration. It shows the
-- PostgreSQL pieces that power the invoicing reminder flow; the actual secret
-- values are configured at runtime (never in migrations):
--
--   * pg_cron   (Supabase extension, enabled in the dashboard) schedules the
--               invoicing-cron edge function.
--   * pg_net    posts the HTTP request.
--   * vault     (Supabase Vault) stores SSRF-safe secrets, including the
--               CRON_SECRET that protects the invoicing-cron function.
--
-- Apply the SQL below in Dashboard → SQL editor (or a migration) AFTER:
--   1. supabase/migrations/0004 and 0005 are applied
--   2. the invoicing-* edge functions are deployed
--   3. Vault secrets are set (see SETUP-GUIDE.md → Invoicing → pg_cron)
--
-- Everything is idempotent. Keep secrets OUT of this file.
-- ============================================================================

-- pg_cron + pg_net are Supabase managed extensions; ensure they are available.
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- --------------------------------------------------------------------------
-- 1. Load CRON_SECRET from Vault into a Postgres setting for this schedule.
--    (Requires a vault secret named "cron_secret"; see SETUP-GUIDE.md.)
--    The value must equal the CRON_SECRET edge-function secret.
-- --------------------------------------------------------------------------
-- select set_config('invoicing.cron_secret', decrypted_secret, false)
-- from vault.decrypted_secrets where name = 'cron_secret';

-- --------------------------------------------------------------------------
-- 2. Edge URL placeholder — replace with your function URL (idempotent).
--    https://<project-ref>.supabase.co/functions/v1/invoicing-cron
-- --------------------------------------------------------------------------

-- --------------------------------------------------------------------------
-- 3. Schedule: run invoicing-cron every 15 minutes.
-- --------------------------------------------------------------------------
select cron.schedule(
  'invoicing-cron-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/invoicing-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('invoicing.cron_secret', true),
      'x-app-apikey', current_setting('invoicing.cron_secret', true)
    ),
    body := jsonb_build_object('kind', 'reminders', 'dry_run', false)
  );
  $$
);

-- --------------------------------------------------------------------------
-- 4. (Optional) confirmation / health payoff — list scheduled jobs:
-- --------------------------------------------------------------------------
-- select * from cron.job where jobname like 'invoicing-%';
-- select * from net._http_response order by created desc limit 5;