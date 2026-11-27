# Go-live owner checklist (incomplete hardening branch)

This checklist is intentionally conservative. The current `hardening/go-live` branch is a partial implementation tranche and is **not production-ready**.

## Before any deployment

- [ ] Resume the Supabase project and confirm backups/export are available.
- [ ] Review all pending migrations in staging first. In particular, migration 0007 revokes anon/authenticated/PUBLIC access and changes function search paths; validate service-role access for every Worker and edge-function path before applying.
- [ ] Apply migrations in numeric order only after review: 0007, 0008, then future 0009 onward when authored.
- [ ] Run `supabase/tests/security_checks.sql` in the Supabase SQL editor. It should return zero rows; this is not a substitute for a full manual review.
- [ ] Keep `reviewflow` and `invoicing` exposed to the Data API for service-role PostgREST clients, while keeping public role grants revoked.
- [ ] Set Worker secrets in the Cloudflare dashboard. Current code requires JWT_SECRET (32+ chars), SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, CORS_ORIGIN (exact HTTPS origin), INTEGRATION_SECRET, CRON_SECRET and COOKIE_DOMAIN in production. Set RESEND_WEBHOOK_SECRET when RESEND_API_KEY is enabled.
- [ ] Set APP_ORIGIN and API_ORIGIN consistently with the Pages and Worker origins in preparation for the pending cookie/CSRF implementation.
- [ ] Verify the Resend sending domain (SPF, DKIM and DMARC) before enabling outbound email.
- [ ] Configure Cloudflare custom domains and monitoring only after the remaining Worker/session and scheduled-job implementation is complete.

## Explicitly not ready

Email verification/reset flows, HttpOnly cookie sessions and CSRF, persistent rate limits, tenant-isolation regression coverage, scheduled review sending, Svix webhook verification, public invoice JSON share API, frontend security headers/CSP, CI/dependency remediation, and the UX work in sections E1–E12 remain unimplemented. Do not launch based on this checklist.

## Rollback

Reverting Git does not reverse database grants or default privileges. Prepare and peer-review SQL that restores the exact pre-migration grants before applying 0007. Treat index removal separately; do not drop unrelated indexes.
