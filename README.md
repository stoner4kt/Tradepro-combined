# crm-with-reviews

TradePro CRM **+** ReviewFlow **+** Invoicing, merged into one deployable
system on a **single Supabase project**.

- **TradePro CRM** — service-business CRM (leads, clients, projects, email
  capture, ledger) with its own JWT auth against the `profiles` table.
- **ReviewFlow** — the standalone review-request product (kanban pipeline,
  review emails, embeddable `widget.js`, edge functions) now running off the
  **same** Supabase project and reachable from the CRM dashboard **under the
  same login**.
- **Invoicing** — quotes & invoices (line items, settings with per-user
  numbering, PDF/view/download, Resend email, payments, revenue) running as
  edge functions in a clean `invoicing` schema and reachable from the **same
  dashboard / same login** via the `/api/invoicing/*` proxy. Standalone
  share pages for unlocked documents are served by `invoicing-public`.

See **[SETUP-GUIDE.md](./SETUP-GUIDE.md)** for the exact deployment steps.

## Repository layout

```
.
├── package.json                 # npm workspaces: server + client
├── supabase/
│   ├── migrations/              # ONE project — CRM + Reviews + Invoicing
│   │   ├── 0001_crm_init.sql            # public.* CRM schema + signup trigger
│   │   ├── 0002_crm_lead_conversion.sql # convert_lead_to_client, get_dashboard_stats
│   │   ├── 0003_reviewflow_schema.sql   # reviewflow.* Reviews schema + RLS
│   │   ├── 0004_invoicing_schema.sql    # invoicing.* quotes/invoices schema
│   │   └── 0005_invoicing_crm_hooks.sql # crossed-walk helper + email mirror
│   └── functions/               # ReviewFlow + Invoicing edge functions
│       ├── _shared/             # cors, supabase clients, email helpers
│       ├── _shared/core/        # invoicing core: types, money, numbering
│       ├── _shared/invoicing/   # re-export shims for the invoicing-* functions
│       ├── capture-lead/
│       ├── send-review-email/
│       ├── integration-*/       # capture, lead, lookup, overview, send-review, settings
│       ├── invoicing-api/       # quotes/invoices CRUD + actions (auth proxy)
│       ├── invoicing-public/    # token-based share page (no auth)
│       ├── invoicing-cron/      # scheduled due-date reminders
│       └── invoicing-resend-webhook/  # Resend status updates → email_events
├── server/                      # Cloudflare Worker — Express-compatible CRM API
│   ├── src/
│   │   ├── worker.ts            # Workers entry (cloudflare:node httpServerHandler)
│   │   ├── app.ts               # route wiring
│   │   ├── routes/              # auth, leads, clients, projects, dashboard,
│   │   │                        #   settings, captures, integration (reviews),
│   │   │                        #   invoicing (quotes/invoices proxy)
│   │   ├── services/            # auth, email, reviewFlow, invoicing
│   │   ├── store/               # Store interface + LocalStore + SupabaseStore
│   │   └── utils/               # config, jwt, logger, validation
│   ├── wrangler.jsonc           # deploy config; vars set in the dashboard
│   └── .env.example
└── client/                      # Cloudflare Pages — React + Vite dashboard
    ├── src/
    │   ├── pages/               # Dashboard, Leads, Clients, Projects, Reviews,
    │   │                        #   Invoicing, Settings, Ledger, Auth
    │   ├── widget/index.ts      # embeddable widget (built to dist/widget.js)
    │   └── lib/api.ts           # CRM API client + Reviews + Invoicing proxy
    ├── vite.widget.config.ts    # widget build
    ├── public/_redirects        # SPA deep-link fallback
    ├── public/_routes.json      # static-only Pages routing
    └── .env.example
```

## How the merge works

### One Supabase project, two schemas

The CRM schema stays exactly as before in `public`. The Reviews product moves
into a dedicated **`reviewflow`** schema:

| | CRM (`public.*`) | Reviews (`reviewflow.*`) |
|---|---|---|
| Tables | `profiles`, `clients`, `leads`, `projects`, `email_captures`, `email_logs`, `settings` | `settings` (1 row/user), `leads`, `review_requests` |
| Keyed on | `user_id` (`auth.uid()`) | `user_id` (`auth.uid()`) |
| RLS | per-user | per-user |

This resolves the **CRM `leads` vs Reviews `leads` name collision** cleanly:
both tables can coexist because the Reviews one lives in a different schema.
The merged dashboard shows CRM project status next to review status through
the existing `integration-lookup` badge (`ReviewStatusBadge`).

### One login

The CRM already issues its own JWT tokens against `profiles`. The
standalone ReviewFlow's client-side `supabase.auth` session is **not used** in
the merged dashboard — the Reviews UI simply calls the same CRM API token.
Every Reviews page/action goes through the authenticated Worker proxy at
`/api/integration/reviews/*`, which forwards each request to the matching edge
function with:

- `x-integration-secret` — the shared secret (`REVIEWFLOW_SECRET` on the
  Worker = `INTEGRATION_SECRET` on the functions), and
- `x-user-id` — the authenticated CRM user's id, so reviews data is scoped to
  that user.

### Widget

`client/src/widget/index.ts` is the zero-dependency ReviewFlow widget. It is
built **first** by `npm run build:all` into `public/widget.js`, which the app
build then copies into `dist/widget.js` — so the same Pages deployment serves
both the dashboard and `/widget.js`. The Settings page's “Widget &
Integration” snippets reference `VITE_APP_URL` + `VITE_SUPABASE_URL` exactly
like the standalone.

## Invoicing (quotes & invoices)

The Invoicing module follows the exact same integration pattern as ReviewFlow:

- Data lives in its own **`invoicing`** schema (`settings`, `documents`,
  `document_lines`, `payments`, `email_events`) with a `user_id` column on
  every table and per-user RLS. Total, tax, and due-date reminders are
  recomputed server-side by the edge functions.
- The dashboard talks to `/api/invoicing/*` on the CRM Worker. Every route is
  allowlisted in `server/src/routes/invoicing.ts` and 404s when the
  integration is not configured. The `invoicingService.ts` module is the only
  place that builds outbound headers (`x-integration-secret`,
  `x-user-id`, `x-api-key` for the active share endpoints).
- Edge functions are multi-tenant and scoped by `user_id`
  (`_shared/invoicing/supabase.ts`); `adminClient()` passes
  `{ db: { schema: "invoicing" } }` just like `reviewflow` in the Reviews
  module.
- "Create quote" buttons on **Projects** and **won Leads** construct a
  document via `/invoicing/from-project` and `/invoicing/from-lead` using the
  CRM `public.clients` snapshot, then deep-link back into the editor.
- Public share pages are served *without* auth by `invoicing-public` at
  `/functions/v1/invoicing-public/<quote|invoice>/<token>`; the client
  redirects `/q/:token` and `/i/:token` share links straight there.
- `invoicing-cron` fires scheduled due-date reminders; the optional
  `invoicing-resend-webhook` mirrors Resend status updates into
  `invoicing.email_events`, which migration `0005` copies into
  `public.email_logs` so they show up in the CRM Ledger.

To enable: set `INVOICING_URL` + `INVOICING_SECRET` on the Worker
(`INVOICING_SECRET` falls back to `REVIEWFLOW_SECRET`) and ship the client
with `VITE_ENABLE_INVOICING=true`. Without either, the Invoicing tab shows its
"not configured" state and the `/api/invoicing/*` routes 404 — a pure-CRM
deploy is unaffected.

### Concurrency / extraction

To ship ReviewFlow standalone again later:

1. Copy `supabase/functions/_shared`, `supabase/functions/*`, and
   `client/src/widget` into a fresh repo.
2. Apply the original single-tenant migrations (remove `user_id`, restore the
   single settings row + permissive authenticated RLS).
3. Swap the dashboard's `api.*` Reviews calls back to direct
   `@supabase/supabase-js` / edge-function calls.

The Invoicing module is kept just as extractable: `supabase/functions/_shared`
(core + invoicing shims), the `invoicing-*` functions, and `pages/Invoicing.tsx`
are cleanly separated behind the `invoicing` schema. Extracting means stripping
`user_id`/integration auth and restoring single-tenant RLS — mirroring the
ReviewFlow recipe.

No CRM-specific code leaks into the Reviews modules: the edge functions only
depend on `user_id` + `x-integration-secret` headers. The same is true for the
`invoicing-*` functions (plus `x-api-key` for the active share endpoints).

## Development

```bash
npm install
npm run dev          # server (tsx, :4000) + client (vite, :5173 with /api proxy)
```

For a fully local run against your Supabase project, create `.env` files from
`server/.env.example` and `client/.env.example`.

```bash
# Build both packages (widget → app, then server)
npm run build

# Tests (server API tests against an in-memory store)
npm test

# Type-check the Worker build explicitly
npm run typecheck:worker -w server

# Deploy worker
npm run deploy:worker -w server     # uses server/wrangler.jsonc
```

## Environment variables

**Worker (`server/`):**

| Var | Notes |
|---|---|
| `SUPABASE_URL` | single merged project |
| `SUPABASE_ANON_KEY` | public |
| `SUPABASE_SERVICE_KEY` | secret |
| `JWT_SECRET` | secret — signs CRM tokens |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `RESEND_REPLY_TO` | email sending |
| `REVIEWFLOW_URL` | **same** Supabase project URL |
| `REVIEWFLOW_SECRET` (alias `INTEGRATION_SECRET`) | must equal edge-function `INTEGRATION_SECRET` |
| `REVIEWFLOW_AUTO_SEND` | auto-send on completed projects |
| `INVOICING_URL` | **same** Supabase project URL |
| `INVOICING_SECRET` (falls back to `REVIEWFLOW_SECRET`) | must equal edge-function `INTEGRATION_SECRET` |
| `CORS_ORIGIN` | Pages domain |
| `CAPTURE_SECRET`, `REQUIRE_CAPTURE_SECRET` | optional capture protection |

**Pages (`client/`):**

| Var | Notes |
|---|---|
| `VITE_API_URL` | Worker base URL |
| `VITE_APP_URL` | Pages URL (widget snippets) |
| `VITE_SUPABASE_URL` | merged project |
| `VITE_ENABLE_REVIEWS_INTEGRATION` | `true` |
| `VITE_ENABLE_INVOICING` | `true` — shows the Invoicing tab + quote buttons |
| `VITE_API_TIMEOUT_MS` | optional |

**Edge functions (`supabase/functions/`):**

| Var | Notes |
|---|---|
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role secret |
| `RESEND_API_KEY` | review emails; also used by invoicing-* |
| `INTEGRATION_SECRET` | shared with the Worker (`REVIEWFLOW_SECRET` / `INVOICING_SECRET`) |
| `CRON_SECRET` | `invoicing-cron` schedule auth |
| `RESEND_WEBHOOK_SECRET` | `invoicing-resend-webhook` signature verification |

No real secrets are committed — all values are placeholders in
`.env.example` files, and the Worker vars live in the Cloudflare dashboard.

## License

Private/internal product code. (This repository merges two existing private
product codebases; no public license is granted.)