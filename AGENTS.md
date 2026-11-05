# AGENTS.md — crm-with-reviews

Merged monorepo: TradePro CRM + ReviewFlow reviews + Invoicing (quotes &
invoices), one Supabase project, one login. npm workspaces (`server`,
`client`); edge functions under `supabase/functions/`.

## Key design decisions (do not silently revert)

- **One Supabase project, three schemas.** CRM stays in `public.*` (profiles,
  clients, leads, projects, email_captures, email_logs, settings — unchanged
  from the original CRM). Reviews lives in `reviewflow.*` (settings, leads,
  review_requests) and Invoicing in `invoicing.*` (settings, documents,
  document_lines, payments, emails/email_events), each with a `user_id`
  column on every table to resolve name collisions and enable per-user RLS.
  `reviewflow.leads.email` lookups (`integration-lookup`) are scoped by
  `user_id`; the Invoicing `from-project`/`from-lead` constructors read CRM
  rows in `public` through `cross_walk_crm_customer`.
- **Single login.** The CRM's JWT auth (against `public.profiles`) is the only
  auth. The client never uses `@supabase/supabase-js` for the dashboard. The
  Reviews dashboard calls the authenticated Worker proxy
  `/api/integration/reviews/*`, and the Invoicing tab calls
  `/api/invoicing/*`; both forward to edge functions with
  `x-integration-secret` (= `INTEGRATION_SECRET`) + `x-user-id` headers
  (threaded through `reviewFlowService.ts` / `invoicingService.ts` —
  `ReviewFlowLeadPayload` includes `user_id`; always include it when adding
  new payloads).
- **Edge functions are multi-tenant by design.** Every query is scoped by
  `user_id`; `capture-lead` resolves the owner via `widget_api_key`
  (`resolveWidgetOwner` in `_shared/supabase.ts`). The RPC
  `reviewflow.rotate_widget_api_key` uses `auth.uid()` and therefore does NOT
  work under the service-role client — `integration-settings` rotates the key
  inline instead. `adminClient()` must pass
  `{ db: { schema: "reviewflow" } }` or `{ db: { schema: "invoicing" } }` —
  without it every `.from()` hits the CRM tables in `public`.
- **`reviewflow` must be an exposed schema** (Dashboard → Project Settings →
  API → Exposed schemas), otherwise PostgREST rejects the service-role client
  with `PGRST106` regardless of RLS. The same applies to `invoicing`.
- **`verify_jwt` is per-function in `supabase/config.toml`.** A bare
  `[functions] verify_jwt = false` is ignored by the CLI, so the gateway 401s
  every call before the function runs. Deploy with `--no-verify-jwt` or keep
  the twelve `[functions.<name>]` blocks (Reviews + Invoicing — add a block
  whenever you add a function).
- **`createFreshStore()` must return `resolveStore()`**, not `new LocalStore()`
  — the latter silently drops data in production (fixed in this repo).
- **`wrangler.jsonc` sets `keep_vars: true`** so dashboard-managed plain-text
  vars survive a deploy; keys in `vars` still overwrite same-named dashboard
  values. Secrets (`JWT_SECRET`, `SUPABASE_SERVICE_KEY`, …) live in the
  dashboard and are never deleted — wrangler hardcodes `keep_secrets: true`.
  The old "Unable to fetch bindings, routes, or services metadata from the
  dashboard" failure is **not** caused by `keep_vars`: `preUploadApiChecks`
  calls `downloadWorkerConfig` whenever the Worker's `last_deployed_from` is
  `"dash"`, so it only affects the first wrangler deploy of a
  dashboard-created Worker.
- **Invoicing worker config mirrors ReviewFlow.** `config.ts` reads
  `invoicing` from `INVOICING_URL` + `INVOICING_SECRET` (the latter falls back
  to `REVIEWFLOW_SECRET`), plus `SV_API_KEY` and an `enabled` flag. When it is
  not configured, every `/api/invoicing/*` route 404s so a pure-CRM deploy is
  unaffected. `invoicingService.ts` is the only module building outbound
  headers (`x-integration-secret`, `x-user-id`, `x-api-key` for the active
  `pdf|view|download` share endpoints). The client shows the Invoicing tab
  only when `VITE_ENABLE_INVOICING=true` and renders a "not configured" state
  when the server 404s.
- **Invoicing totals are server-side.** The client editor sends line items
  with `tax = 0`; `invoicing-api` recomputes subtotal/tax/total via
  `applyTotals` (settings `tax_rate`) and stamps due dates / quote validity
  from `invoicing.settings` on send. Never trust client totals.
- **The share page is public by token.** `invoicing-public` resolves a
  document by its 16-byte `token` with no auth — the token IS the permission.
  The `invoicing-api` `pdf|view|download` endpoints additionally require
  `x-api-key` (= `SV_API_KEY` from `invoicing.settings`) and the Worker proxy
  always sends it.

## Build & test

```bash
npm install
npm run build      # server + client (widget first via build:all)
npm test           # vitest (server, in-memory LocalStore)
npm run typecheck -w server && npm run typecheck:worker -w server
cd server && npm run dev:worker    # local worker
cd client && npm run dev           # vite, proxies /api to :4000
```

Edge functions aren't compiled locally; verify with `deno check` in
`supabase/functions` against the shared `_shared/` helpers.

## Where things live

- `server/src/services/reviewFlowService.ts` — all outbound ReviewFlow calls
  (notify, proxy to /api/integration route handlers).
- `server/src/routes/integration.ts` — `/api/integration/reviews/*` proxy.
- `server/src/services/invoicingService.ts` — all outbound Invoicing calls.
- `server/src/routes/invoicing.ts` — `/api/invoicing/*` proxy (allowlisted
  actions; every route 404s when not configured).
- `client/src/pages/Reviews.tsx` — merged Reviews dashboard (Overview, Leads
  board w/ drag+drop, History, Email builder, Settings+widget snippets). Also
  hosts the 5-minute frontend auto-send polling loop.
- `client/src/pages/Invoicing.tsx` — Invoicing dashboard (list + line-item
  editor + settings) and the `/q/:token` `/i/:token` share redirectors live
  in `App.tsx` (`PublicDocumentForwarder`).
- `supabase/functions/_shared/send-review-email.ts` — the single send-review
  implementation used by both `send-review-email` and `integration-lead`.
- `supabase/functions/_shared/core/` + `_shared/invoicing/` — invoicing core
  (money, document numbering, email) and the multi-tenant shims
  (`adminClient({ schema: "invoicing" })`, `checkIntegrationSecret`,
  `checkXApiKey`, `userIdFromRequest`).
- `supabase/functions/invoicing-api/` — everything the dashboard does
  (documents CRUD, actions send/accept/decline/mark-paid, settings, payments,
  revenue, `from-project`/`from-lead`, totals recompute).
- `supabase/functions/invoicing-cron/` + `invoicing-resend-webhook/` —
  scheduled reminders + Resend status webhook → `email_events`.
- `client/src/widget/index.ts` — zero-dependency widget; built first by
  `build:all` to `public/widget.js`, copied into `dist/` by the app build.
  Widget talks to the same project's `capture-lead` edge function using
  `data-supabase-url` (falls back to `VITE_SUPABASE_URL` at build time).

## Extractability

ReviewFlow modules (edge functions, widget, Reviews dashboard code) are kept
cleanly separated (`reviewflow.*` schema, `src/pages/Reviews.tsx`,
`src/widget`, `supabase/functions/`) so the standalone product can be
recreated later by stripping `user_id`/integration auth and restoring
single-tenant RLS. The Invoicing module follows the same pattern: `invoicing.*`
schema, `invoicing-*` edge functions, `client/src/pages/Invoicing.tsx`, and
`server/src/services/invoicingService.ts` reference nothing CRM-specific, so it
can ship standalone by stripping the `user_id`/integration headers and the
`/api/invoicing/*` worker proxy (`migrations/0005` is the Tradepro-only CRM
glue and must NOT be copied).