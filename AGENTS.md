# AGENTS.md — crm-with-reviews

Merged monorepo: TradePro CRM + ReviewFlow reviews, one Supabase project, one
login. npm workspaces (`server`, `client`); edge functions under
`supabase/functions/`.

## Key design decisions (do not silently revert)

- **One Supabase project, two schemas.** CRM stays in `public.*` (profiles,
  clients, leads, projects, email_captures, email_logs, settings — unchanged
  from the original CRM). Reviews lives in `reviewflow.*` (settings, leads,
  review_requests) with a `user_id` column on every table to resolve the name
  collision and enable per-user RLS. `reviewflow.leads.email` lookups
  (`integration-lookup`) are scoped by `user_id`.
- **Single login.** The CRM's JWT auth (against `public.profiles`) is the only
  auth. The client never uses `@supabase/supabase-js` for the dashboard. The
  Reviews dashboard calls the authenticated Worker proxy
  `/api/integration/reviews/*`, which forwards to edge functions with
  `x-integration-secret` (= `INTEGRATION_SECRET`) + `x-user-id` headers
  (threaded through `reviewFlowService.ts` — `ReviewFlowLeadPayload` includes
  `user_id`; always include it when adding new payloads).
- **Edge functions are multi-tenant by design.** Every query is scoped by
  `user_id`; `capture-lead` resolves the owner via `widget_api_key`
  (`resolveWidgetOwner` in `_shared/supabase.ts`). The RPC
  `reviewflow.rotate_widget_api_key` uses `auth.uid()` and therefore does NOT
  work under the service-role client — `integration-settings` rotates the key
  inline instead. `adminClient()` must pass `{ db: { schema: "reviewflow" } }`
  — without it every `.from()` hits the CRM tables in `public`.
- **`reviewflow` must be an exposed schema** (Dashboard → Project Settings →
  API → Exposed schemas), otherwise PostgREST rejects the service-role client
  with `PGRST106` regardless of RLS.
- **`verify_jwt` is per-function in `supabase/config.toml`.** A bare
  `[functions] verify_jwt = false` is ignored by the CLI, so the gateway 401s
  every call before the function runs. Deploy with `--no-verify-jwt` or keep
  the eight `[functions.<name>]` blocks.
- **`createFreshStore()` must return `resolveStore()`**, not `new LocalStore()`
  — the latter silently drops data in production (fixed in this repo).
- **`wrangler.jsonc` must NOT set `keep_vars: true`** (breaks Worker Builds:
  "Unable to fetch bindings..."). Vars in config, secrets as dashboard secrets.

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
- `client/src/pages/Reviews.tsx` — merged Reviews dashboard (Overview, Leads
  board w/ drag+drop, History, Email builder, Settings+widget snippets). Also
  hosts the 5-minute frontend auto-send polling loop.
- `supabase/functions/_shared/send-review-email.ts` — the single send-review
  implementation used by both `send-review-email` and `integration-lead`.
- `client/src/widget/index.ts` — zero-dependency widget; built first by
  `build:all` to `public/widget.js`, copied into `dist/` by the app build.
  Widget talks to the same project's `capture-lead` edge function using
  `data-supabase-url` (falls back to `VITE_SUPABASE_URL` at build time).

## Extractability

ReviewFlow modules (edge functions, widget, Reviews dashboard code) are kept
cleanly separated (`reviewflow.*` schema, `src/pages/Reviews.tsx`,
`src/widget`, `supabase/functions/`) so the standalone product can be
recreated later by stripping `user_id`/integration auth and restoring
single-tenant RLS.