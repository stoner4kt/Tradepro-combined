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

## Explicit deployment gate

Do not deploy until all staging checks pass, migrations have a reviewed rollback plan, CI is green, and an owner has approved the final PR. No migration or secret change is performed by this checklist.
