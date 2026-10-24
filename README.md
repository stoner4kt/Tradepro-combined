# crm-with-reviews

TradePro CRM **+** ReviewFlow, merged into one deployable system on a **single
Supabase project**.

- **TradePro CRM** — service-business CRM (leads, clients, projects, email
  capture, ledger) with its own JWT auth against the `profiles` table.
- **ReviewFlow** — the standalone review-request product (kanban pipeline,
  review emails, embeddable `widget.js`, edge functions) now running off the
  **same** Supabase project and reachable from the CRM dashboard **under the
  same login**.

See **[SETUP-GUIDE.md](./SETUP-GUIDE.md)** for the exact deployment steps.

## Repository layout

```
.
├── package.json                 # npm workspaces: server + client
├── supabase/
│   ├── migrations/              # ONE project — CRM + Reviews
│   │   ├── 0001_crm_init.sql            # public.* CRM schema + signup trigger
│   │   ├── 0002_crm_lead_conversion.sql # convert_lead_to_client, get_dashboard_stats
│   │   └── 0003_reviewflow_schema.sql   # reviewflow.* Reviews schema + RLS
│   └── functions/               # ReviewFlow edge functions (single project)
│       ├── _shared/             # cors, supabase client, email helpers
│       ├── capture-lead/
│       ├── send-review-email/
│       └── integration-*/       # capture, lead, lookup, overview, send-review, settings
├── server/                      # Cloudflare Worker — Express-compatible CRM API
│   ├── src/
│   │   ├── worker.ts            # Workers entry (cloudflare:node httpServerHandler)
│   │   ├── app.ts               # route wiring
│   │   ├── routes/              # auth, leads, clients, projects, dashboard,
│   │   │                        #   settings, captures, integration (reviews proxy)
│   │   ├── services/            # auth, email, reviewFlow integration
│   │   ├── store/               # Store interface + LocalStore + SupabaseStore
│   │   └── utils/               # config, jwt, logger, validation
│   ├── wrangler.jsonc           # deploy config; vars set in the dashboard
│   └── .env.example
└── client/                      # Cloudflare Pages — React + Vite dashboard
    ├── src/
    │   ├── pages/               # Dashboard, Leads, Clients, Projects, Reviews,
    │   │                        #   Settings, Ledger, Auth
    │   ├── widget/index.ts      # embeddable widget (built to dist/widget.js)
    │   └── lib/api.ts           # CRM API client + Reviews proxy client
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

### Concurrency / extraction

To ship ReviewFlow standalone again later:

1. Copy `supabase/functions/_shared`, `supabase/functions/*`, and
   `client/src/widget` into a fresh repo.
2. Apply the original single-tenant migrations (remove `user_id`, restore the
   single settings row + permissive authenticated RLS).
3. Swap the dashboard's `api.*` Reviews calls back to direct
   `@supabase/supabase-js` / edge-function calls.

No CRM-specific code leaks into the Reviews modules: the edge functions only
depend on `user_id` + `x-integration-secret` headers.

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
| `CORS_ORIGIN` | Pages domain |
| `CAPTURE_SECRET`, `REQUIRE_CAPTURE_SECRET` | optional capture protection |

**Pages (`client/`):**

| Var | Notes |
|---|---|
| `VITE_API_URL` | Worker base URL |
| `VITE_APP_URL` | Pages URL (widget snippets) |
| `VITE_SUPABASE_URL` | merged project |
| `VITE_ENABLE_REVIEWS_INTEGRATION` | `true` |
| `VITE_API_TIMEOUT_MS` | optional |

**Edge functions (`supabase/functions/`):**

| Var | Notes |
|---|---|
| `SUPABASE_URL` | project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | service-role secret |
| `RESEND_API_KEY` | review emails |
| `INTEGRATION_SECRET` | shared with the Worker |

No real secrets are committed — all values are placeholders in
`.env.example` files, and the Worker vars live in the Cloudflare dashboard.

## License

Private/internal product code. (This repository merges two existing private
product codebases; no public license is granted.)