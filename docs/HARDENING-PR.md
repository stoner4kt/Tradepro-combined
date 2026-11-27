# TradePro go-live hardening — implementation report

Branch: `hardening/go-live` (based on `main`)
Pull request: [#7 — draft](https://github.com/stoner4kt/Tradepro-combined/pull/7)

This is a substantial hardening pass, but it is **not certified production-ready**. The table distinguishes implementation from verification; migrations have not been applied to any Supabase project.

## Implementation status

| Area | Status | Implemented in this branch |
|---|---|---|
| Database least privilege | Partial | 0007 revokes public/anon/authenticated table, sequence and function access in public/reviewflow/invoicing; grants service_role; pins function search_path; includes postgres and supabase_admin default-privilege rules. 0011 scopes privileged lead conversion and document-number RPCs. |
| RLS and indexes | Partial | 0008 adds FK/owner indexes and wraps existing auth.uid() policy calls for init-plan caching. 0009 adds private auth/rate-limit/opt-out tables. This is not a full manual review of every policy and every function. |
| Auth lifecycle | Partial | Hashed single-use email verification and password-reset tokens, resend verification, generic forgot-password response, password reset/change, password breach k-anonymity check, token-version revocation and logout-all. Production signup now waits for email verification. |
| Sessions and CSRF | Partial | Short-lived HS256 JWT in HttpOnly, Secure, SameSite=None production cookie; cookie domain validated against app/API origins; bearer auth disabled in production; mutating API requests require exact APP_ORIGIN, JSON and X-TradePro header. |
| Rate limiting | Partial | Atomic Postgres rate_limit_hit RPC and hashed-key middleware on auth/public capture; edge widget, review-email and public share limits. Not every route/function has an explicit tailored limit. |
| Tenant isolation | Partial | Scoped conversion RPC, project client/lead ownership validation, tenant-scoped project relationship reads, delete-not-found semantics, UUID validation and profile existence check for invoicing API. Full adversarial tenant test matrix remains outstanding. |
| Invoicing integrity | Partial | 0010 guards document lifecycle and sent-line mutation; atomic idempotent payment record/delete RPCs; manual mark-paid uses payment RPC. 0014 adds atomic invoice reminder claims. |
| Public share pages | Partial | Public HTML edge renderer replaced with a JSON share API; responsive SPA quote/invoice pages, typed quote acceptance/decline, issuer address/tax fields, noindex/no-store headers, share expiry/revoke/regenerate API actions. UI for all share-management actions and PDF rendering remain incomplete; browser print-to-PDF is available. |
| Cloudflare scheduled work | Implemented, unverified | Worker Cron: every 5 minutes atomically claims/sends due ReviewFlow reviews; every 15 minutes runs invoice reminders and overdue sweep; daily cleans expired security rows. Browser review polling was removed. |
| Edge-function security | Partial | Shared fail-closed constant-time integration-secret checks, UUID tenant IDs, cron secret verification, widget origin allowlist/consent/honeypot/rate limits, Resend Svix timestamp/signature verification and receipt dedupe, unsubscribe endpoint. Remaining edge handlers still need a full per-function security and input audit. |
| Email compliance | Partial | Per-user daily review cap, recipient opt-out checks, one-time unsubscribe tokens, idempotent Resend sends and opt-out storage. Transactional invoice mail suppression policy and full consent/privacy retention policy still need review. |
| Frontend security/accessibility | Partial | No localStorage bearer token, cookie credentials, expired-session handling, accessible verification/recovery forms, widget labels/consent/focus handling, sandboxed email preview, responsive public share pages, generated CSP/security headers, favicon/manifest and real 404. Broader keyboard/screen-reader and contrast audit remains. |
| CI and dependencies | Partial | CI workflow covers npm install/typecheck/tests/build/worker typecheck, Deno edge checks, npm audit and Gitleaks; Dependabot configured. Dependency upgrades/remediation must follow actual CI/audit findings and lockfile verification. |
| UX requirements | Partial | Auth recovery/verification, widget origin configuration, daily email cap, issuer address/tax fields, public share page and quote response. Remaining E1–E12 items need a dedicated review against the brief. |

## Migration order

Apply only in a disposable/staging Supabase project first, after reviewing each SQL file:

1. `0007_security_lockdown.sql`
2. `0008_rls_and_indexes.sql`
3. `0009_auth_support.sql`
4. `0010_invoicing_integrity.sql`
5. `0011_rpc_hardening.sql`
6. `0012_reviewflow_scheduled_claims.sql`
7. `0013_public_document_details.sql`
8. `0014_invoice_reminder_claims.sql`
9. `0015_auth_and_email_lifecycle.sql`

**Do not apply these migrations to production yet.** 0007 changes schema privileges broadly. Confirm all API/edge paths use service_role as intended and prepare a grant rollback before applying. Confirm the new columns and unique indexes against the actual project state.

## Production configuration

Set Worker values in Cloudflare and Supabase Edge Function secrets separately:

- `NODE_ENV=production`
- `CORS_ORIGIN` exactly equal to `APP_ORIGIN`
- `APP_ORIGIN` and `API_ORIGIN` as HTTPS subdomains covered by `COOKIE_DOMAIN` (use custom domains on the same registrable domain)
- `JWT_SECRET`, `INTEGRATION_SECRET`, `CRON_SECRET` at least 32 random characters
- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`
- `RESEND_API_KEY`, `RESEND_FROM_EMAIL` on a verified sending domain, and `RESEND_WEBHOOK_SECRET=whsec_...`
- `SV_API_KEY` at least 32 characters when Invoicing is enabled
- Set matching `INTEGRATION_SECRET` on Supabase Edge Functions. If `REVIEWFLOW_SECRET` or `INVOICING_SECRET` are set on the Worker, they must match it.
- Set `CRON_SECRET` on both the Worker and `invoicing-cron`.
- Set `SUPABASE_SERVICE_ROLE_KEY` and `RESEND_WEBHOOK_SECRET` in the Supabase project secrets.
- Set `ALLOW_BEARER_AUTH=false` in production.

Never commit real values to Git.

## Verification status

The GitHub Actions CI workflow was added and triggered by this branch. Check PR #7's Checks tab for the actual run result. No local checkout/runtime was available in this session, and no live Supabase, Cloudflare or Resend environment was modified. No migrations were executed, no production deploy was performed, and no live credentials were accessed.

## Manual staging verification required

- Apply migrations in order to a disposable Supabase project.
- Run `supabase/tests/security_checks.sql` and resolve every returned row.
- Run Supabase advisors and inspect all RLS policies, SECURITY DEFINER routines and grants.
- Test login, verification, resend, forgot/reset, change-password, logout-all, cookie/CSRF and rate-limit behaviour across the configured Pages/Worker custom domains.
- Test tenant A cannot read/update/delete tenant B leads, clients, projects, documents, payments, settings, captures, logs or edge-function resources.
- Test concurrent/idempotent payments, reversals, invoice reminder claims and scheduled review claims.
- Test Resend Svix valid/invalid/replayed/stale signatures, opt-out and webhook retry semantics.
- Verify Cloudflare Cron execution, secrets, logs, Resend domain authentication and email deliverability.
- Complete accessibility, UX and dependency review before marking this PR ready.

## Rollback

Reverting Git does not reverse database changes. Prepare explicit GRANT/ALTER DEFAULT PRIVILEGES rollback SQL based on pre-migration grants before applying 0007. Review data/schema changes separately; drop only new indexes/tables/columns after confirming no production data depends on them.
