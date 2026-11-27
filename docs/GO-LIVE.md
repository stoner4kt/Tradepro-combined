# Go-live owner checklist

The `hardening/go-live` branch contains a broad hardening implementation, but is **not yet approved for production**. Complete this checklist in staging and record evidence in PR #7 before deployment.

## Supabase staging

- [ ] Confirm backup/restore procedure and export current grants/policies.
- [ ] Review migrations 0007–0015 in numeric order.
- [ ] Apply to a disposable staging project only.
- [ ] Confirm all CRM, ReviewFlow, Invoicing and scheduled edge-function calls use service_role as intended.
- [ ] Run `supabase/tests/security_checks.sql`; resolve every returned row.
- [ ] Run Supabase security/performance advisors and review all RLS policies, function grants and SECURITY DEFINER search paths.
- [ ] Verify token, rate-limit, unsubscribe, reminder-claim and review-claim tables are inaccessible to anon/authenticated.
- [ ] Test atomic/idempotent payments and document lifecycle transitions with concurrent requests.

## Cloudflare and domains

- [ ] Configure app and API custom domains under the same registrable domain.
- [ ] Set exact `CORS_ORIGIN=APP_ORIGIN`, `APP_ORIGIN`, `API_ORIGIN`, and matching `COOKIE_DOMAIN`.
- [ ] Set production secrets: JWT_SECRET, SUPABASE_SERVICE_KEY, INTEGRATION_SECRET, CRON_SECRET, RESEND_API_KEY, RESEND_WEBHOOK_SECRET and SV_API_KEY (if Invoicing is enabled).
- [ ] Set `ALLOW_BEARER_AUTH=false`.
- [ ] Verify cookie flags and CSRF checks from the deployed Pages origin.
- [ ] Verify Worker Cron triggers execute every 5 minutes, 15 minutes and daily at 03:00 UTC; inspect failures and retries.
- [ ] Verify CSP/security headers from the deployed Pages site.

## Email and widget

- [ ] Verify sending domain SPF, DKIM and DMARC.
- [ ] Set matching secrets on Supabase Edge Functions (they are not copied from Cloudflare).
- [ ] Test email verification, resend, forgot/reset password and change-password flows.
- [ ] Test Svix valid, invalid, stale and replayed webhook deliveries.
- [ ] Test recipient unsubscribe and verify opted-out addresses cannot receive review-request email.
- [ ] Configure exact HTTPS widget origins in each user's Settings before embedding.
- [ ] Test widget consent, honeypot, rate limits, duplicate submissions and keyboard navigation.

## Application and CI

- [ ] Review PR #7 and confirm the CI checks are green.
- [ ] Run the complete tenant-isolation matrix across CRM, ReviewFlow, Invoicing and public endpoints.
- [ ] Run frontend keyboard/screen-reader/contrast checks.
- [ ] Review npm audit findings and Dependabot PRs; upgrade vulnerable dependencies with a synchronized lockfile.
- [ ] Verify public quote/invoice links, expiry, revocation, quote acceptance/decline and print-to-PDF.
- [ ] Complete the remaining UX brief items and update the report with evidence.

## Supabase, Resend and monitoring owner tasks

- [ ] Resume the Supabase project if it has paused; confirm the actual database backup/restore plan (the Free tier has no managed backups or PITR).
- [ ] In Supabase Auth, disable public signups because the Worker provisions users through the Admin API. Set Site URL and allowed redirect URLs to the exact APP_ORIGIN and its verification/reset routes.
- [ ] Keep `reviewflow` and `invoicing` in the Supabase Data API exposed schemas for service-role clients.
- [ ] Set Edge Function secrets separately from Cloudflare Worker secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, INTEGRATION_SECRET, CRON_SECRET, RESEND_API_KEY, RESEND_FROM_EMAIL and RESEND_WEBHOOK_SECRET. Generate secrets with `openssl rand -hex 32`.
- [ ] Run `npm run deploy:functions` against staging, then `scripts/smoke-functions.sh` with SUPABASE_URL and SUPABASE_ANON_KEY. These scripts deploy/check gateway configuration; they do not replace function-level auth tests.
- [ ] Verify Resend sending domain SPF, DKIM and DMARC (prefer a dedicated mail subdomain) and configure its Svix webhook URL/signing secret.
- [ ] Configure Cloudflare Pages and Worker custom domains for `app.<domain>` and `api.<domain>`, add the Cron triggers from wrangler.jsonc, and set Pages VITE_API_URL and VITE_SUPABASE_URL build variables.
- [ ] Configure an uptime monitor against `/api/health`; use the CRON_SECRET-protected `/api/health/deep` only from trusted monitoring.
- [ ] Review Free-tier limits before launch: Supabase database/storage/edge invocation quotas and inactivity pause, Resend's roughly 100-email/day allowance, and lack of managed backups/PITR. Recheck current vendor limits before relying on them.
- [ ] Optional: add Cloudflare Turnstile only after implementing and configuring TURNSTILE_SECRET; it is not enabled by this branch.

## Explicit deployment gate

Do not deploy until all staging checks pass, migrations have a reviewed rollback plan, CI is green, and an owner has approved the final PR. No migration or secret change is performed by this checklist.
