# TradePro go-live hardening — review report

**Review branch:** `hardening/go-live`  
**Pull request:** [#7 — Draft go-live hardening](https://github.com/stoner4kt/Tradepro-combined/pull/7)  
**Base:** `main`

This branch contains the broad implementation tranche from the go-live brief. It is a review candidate, not a production release. Items marked partial or pending below must not be treated as signed off.

## Implemented in code

| Area | Work included | Verification status |
|---|---|---|
| Database security | Migrations 0007–0015: privilege lockdown, RLS policy wrapping/indexes, auth/rate-limit support, invoicing state machine, privileged RPC hardening, scheduled claims, public share details and email lifecycle support | Clean local Supabase migration/diagnostic job is still running; not applied to any remote project |
| Authentication | HttpOnly 8-hour session cookie, SameSite=Lax, Secure in production, CSRF origin/referer + JSON + `X-TradePro`, logout/logout-all and token-version revocation | Server typecheck and unit tests passed in dependency-remediation workflow |
| Auth lifecycle | Email verification, resend, forgot/reset password, password change, generic account-enumeration responses and password policy checks | Code and route tests included; live Resend delivery not tested |
| Rate limiting | Postgres-backed IP/email buckets for auth, per-user authenticated request quota, public share/webhook/widget limits and per-tenant email caps | Unit/route checks included; live concurrency and production load not tested |
| Tenant boundaries | Owner-scoped queries, relationship ownership checks, integration profile checks and SQL diagnostics for grants, RLS, tenant predicates and function search paths | Partial: no complete live tenant-isolation matrix or staging database sign-off |
| Invoicing | Atomic payment RPC, row locking, payment/document integrity and status-transition triggers; non-draft documents are read-only and duplicate-as-draft is available | Migration and application code included; concurrency/load behaviour not tested against a remote database |
| Scheduled jobs | Cloudflare Worker Cron handlers for ReviewFlow, invoice reminders/overdue work and daily deep-health/security cleanup | Code/config only; no Cloudflare deployment or scheduled execution performed |
| Edge security | Shared integration-secret checks, tenant validation, public share hardening, no-JWT gateway configuration and deployment/smoke scripts | Deno checks passed in the dependency-remediation workflow; live gateway smoke test not run |
| Resend webhook | Svix HMAC verification, timestamp window, multiple signatures, unique delivery claim, monotonic status updates and rate limiting | Deterministic Svix test vectors added; CI run still pending |
| Privacy | Authenticated account data export and password-confirmed account deletion with private invoice storage cleanup | Code included; not exercised against a real Supabase account/storage bucket |
| Frontend security/accessibility | Cookie-based API calls, route lazy loading, render error boundary, modal focus trap/restore, improved confirmations, privacy links and data-management settings | Client build passed in dependency-remediation workflow; full WCAG/mobile audit remains outstanding |
| Dependency remediation | React Router 7.18.7, Zod 4.6.7, patched transitive `undici` and `esbuild` overrides, refreshed npm lockfile and Dependabot updates | Dependency workflow passed install, typecheck, tests, build, Worker typecheck, Deno checks and reported **0 vulnerabilities** |
| Documentation | Setup addendum, go-live checklist, privacy/terms review placeholders and implementation report | Committed; legal text requires owner/counsel completion |

## Remaining work and launch blockers

1. **Tenant-isolation sign-off:** complete a table-by-table review of every CRM, ReviewFlow and Invoicing read/write path; run two-tenant negative tests against staging; inspect RLS policies and grants on the actual Supabase project.
2. **Public capture:** optional Cloudflare Turnstile verification and a complete acknowledgement-email opt-out/compliance pass remain outstanding.
3. **Pagination and scale:** list endpoints still need consistent cursor/limit pagination and load testing.
4. **UX scope:** onboarding checklist, full mobile-card treatment across all major lists, complete accessibility audit, global toast/confirmation consistency and final app-shell polish remain partial.
5. **Legal:** the Privacy and Terms pages are clearly marked draft placeholders. Replace them with reviewed legal copy and verified contact details before launch.
6. **Observability:** configure production alerting/error monitoring and verify operational dashboards; no Sentry/monitoring project was configured.
7. **Operations:** review backup/restore and retention procedures, confirm Resend DNS (SPF/DKIM/DMARC), and verify Cloudflare custom domains/secrets before deployment.
8. **Live verification:** run the edge no-JWT smoke script against staging; verify Resend webhook delivery, scheduled jobs, auth email delivery, storage deletion and payment concurrency.

## Required production configuration

Production startup now fails closed unless the required secrets and origins are configured. Set these in the Cloudflare Worker dashboard, not in committed files:

- `JWT_SECRET` (at least 32 random characters)
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
- `APP_ORIGIN`, `API_ORIGIN`, `CORS_ORIGIN` (exactly equal to APP_ORIGIN), `COOKIE_DOMAIN` (must cover both HTTPS hosts)
- `INTEGRATION_SECRET`, `CRON_SECRET` (at least 32 random characters)
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_WEBHOOK_SECRET` (`whsec_...`)
- If Invoicing is enabled: `INVOICING_URL`, `INVOICING_SECRET`, `SV_API_KEY`

Set matching Supabase Edge Function secrets separately, including `SUPABASE_SERVICE_ROLE_KEY`, `INTEGRATION_SECRET`, `RESEND_WEBHOOK_SECRET` and `X_API_KEY`. The Worker-side `SV_API_KEY` is forwarded as `x-api-key`.

The Pages app and API must use custom HTTPS domains on the same registrable domain for the SameSite=Lax cookie model.

## Migration order and safety

Apply pending migrations in numeric order through 0015, only after reviewing the current remote migration history. In particular, migration 0007 changes schema/table/function privileges. Do not apply it to production until the service-role access model for every Worker and Edge Function has been checked.

The CI workflow now boots a disposable local Supabase stack, applies migrations from a clean database and runs `supabase/tests/security_checks.sql`. That local run is separate from the connected production project. No remote Supabase migration or Cloudflare deployment has been performed from this branch.

## Verification record

- Dependency-remediation workflow: `npm ci`, typecheck, server tests, client/server build, Worker typecheck and Deno checks passed; `npm audit` reported **0 vulnerabilities**; updated package manifests and lockfile were committed to this branch.
- The main CI run on the lockfile-updated branch is in progress. It includes Svix tests, full dependency audit, Gitleaks and the local Supabase migration/RLS diagnostic job.
- No live Supabase data, secrets, schema or Cloudflare Worker settings were changed.
- No PR merge or production deployment was performed.

## Rollback

Reverting Git does not reverse database grants, default privileges, triggers or data changes. Before applying migrations remotely, prepare and peer-review explicit rollback SQL for the exact target project's current grants and schema state. Keep a verified backup and a tested restore path. Do not assume a Git revert is a database rollback.
