# TradePro Go-live hardening — implementation report

Branch: `hardening/go-live` (based on `main`)
Scope: first reviewable security/database tranche. This report intentionally distinguishes code committed from behaviour not yet verified.

## Item status

| Item | Status | Notes |
|---|---|---|
| A1 — 0007 security lockdown | partial | Revokes table/sequence/routine access from PUBLIC, anon and authenticated in the three schemas; grants service_role; pins search_path on existing routines; adds postgres default privileges. Supabase-admin default privileges and RPC signature/body hardening remain outstanding. |
| A2 — 0008 RLS and indexes | partial | Adds the six called-out FK indexes and common owner/created/email indexes. The 56 auth.uid() policy expressions are not rewritten. |
| A3 — auth support migration | skipped | Token lifecycle, rate-limit tables/functions, opt-outs, consent and settings columns not implemented. |
| A4 — invoicing integrity | skipped | State machine triggers and atomic payment RPC are not implemented. |
| A5 — security checks | partial | Added `supabase/tests/security_checks.sql`; not executed against Supabase. It is a post-migration diagnostic, not proof that the current database passes. |
| B1 — fail-closed config | partial | Removed committed JWT fallback and added production-required-variable validation plus exact HTTPS CORS_ORIGIN validation. APP_ORIGIN/API_ORIGIN are exposed as config fields but cookie/session work is not complete. |
| B2–B5 | skipped | Cookie sessions, CSRF, email verification/password flows, rate limiting and public capture redesign remain outstanding. |
| B6 — headers/health/body size | partial | Health endpoint now returns only `{ok:true}`; JSON limit reduced to 256 KB; nosniff added. Deep health, HSTS, Referrer-Policy, request IDs and generic global errors remain outstanding. |
| B7–B10 | skipped | Tenant audit, pagination, scheduled jobs and dependency remediation not implemented. |
| C1–C8 | skipped | Edge-function hardening and Svix verification not implemented. |
| D1–D7 | skipped | Frontend security, widget, CI and observability work not implemented. |
| E1–E12 | skipped | UX scope not implemented. |
| F1–F3 | partial | This report and a go-live owner checklist are included; README/SETUP-GUIDE/AGENTS have not yet been reconciled. |

## Migration order

1. `0007_security_lockdown.sql`
2. `0008_rls_and_indexes.sql`
3. Remaining migrations 0009 onward are not yet authored.

**Important:** 0007 is a broad privilege change. Review the SQL and confirm the application and edge functions use only service_role before applying it. Do not apply to production as part of this branch review.

## New environment variables / changed requirements

- `JWT_SECRET` no longer has a committed fallback; production validation requires at least 32 characters.
- Production validation now requires `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SUPABASE_ANON_KEY`, `CORS_ORIGIN` (one exact HTTPS origin), `INTEGRATION_SECRET`, `CRON_SECRET`, and `COOKIE_DOMAIN`.
- If `RESEND_API_KEY` is set, `RESEND_WEBHOOK_SECRET` is required.
- `APP_ORIGIN` and `API_ORIGIN` are read into config for subsequent cookie/CSRF work, but are not currently validated or used for session enforcement.

## Manual owner steps

- Review migration 0007 carefully before running it; do not apply until the worker/edge-function access model has been confirmed.
- Apply migrations only to a disposable/staging Supabase project first.
- Run `supabase/tests/security_checks.sql` in the Supabase SQL editor and investigate every returned row.
- Keep public signups, production cookie auth, Cloudflare cron and Resend changes disabled until the remaining auth/edge-function work is completed.
- Supply all required production secrets through the Cloudflare dashboard; never commit them.

## Rollback notes

- Revert this branch or cherry-pick the desired commits before merging.
- Database privilege changes are not automatically undone by reverting files. Prepare explicit GRANT/ALTER DEFAULT PRIVILEGES rollback SQL based on the pre-migration grants before applying 0007.
- Indexes from 0008 can be dropped independently if needed; do not drop unrelated existing indexes.

## Verification actually performed

- Read `AGENTS.md`, `README.md`, and `SETUP-GUIDE.md` from the repository before editing.
- Confirmed the repository default branch is `main` and created `hardening/go-live` from it.
- Added migrations 0007 and 0008, the security diagnostic SQL, production configuration validation, health/body-limit/header changes, and the profile-column selection fix.
- **Not run:** npm install, typecheck, unit tests, client/worker builds, npm audit, Deno checks, Supabase SQL execution/advisors, Cloudflare or Resend checks. The connected GitHub workflow in this session provides remote repository operations only; no repository checkout/runtime was available to execute these commands. No live Supabase or Cloudflare APIs were called.
