# SETUP-GUIDE — crm-with-reviews

TradePro CRM **+** ReviewFlow merged into a single deployable system backed by
**one Supabase project**. One Cloudflare Pages site serves the dashboard and
`/widget.js`; one Cloudflare Worker serves the API; one Supabase project holds
the CRM schema, the ReviewFlow schema and all edge functions.

```
┌────────────────────────────┐         ┌──────────────────────────────┐
│ Cloudflare Pages            │         │ Cloudflare Worker             │
│  client/dist (build:all)    │         │  crm-with-reviews-api         │
│  /            SPA            │         │  Express routes + JWT auth    │
│  /widget.js   embeddable     │         │  /api/auth /leads /clients    │
│  _redirects, _routes.json    │         │  /api/projects /capture …     │
└──────────────┬──────────────┘         └───────────────┬───────────────┘
               │ fetch(tokens, api)                     │ REVIEWFLOW_URL
               ▼                                        ▼
        ┌─────────────────────────────────────────────────────────────┐
        │  ONE Supabase project                                        │
        │  public.*        CRM tables (profiles/clients/leads/…)       │
        │  reviewflow.*    Reviews tables (settings/leads/review_...  ) │
        │  /functions/v1/* integration edge functions                  │
        └─────────────────────────────────────────────────────────────┘
```

## TL;DR

1. **Create the Supabase project** and apply the migrations (CRM `public`,
   Reviews `reviewflow`, Invoicing `invoicing`).
2. **Deploy the edge functions** — Reviews (`capture-lead`,
   `send-review-email`, `integration-*`) **and** Invoicing
   (`invoicing-api`, `invoicing-public`, `invoicing-cron`,
   `invoicing-resend-webhook`) — and set their secrets
   (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `RESEND_API_KEY`,
   `INTEGRATION_SECRET`, plus the optional `CRON_SECRET` /
   `RESEND_WEBHOOK_SECRET`).
3. **Deploy the Cloudflare Worker** (`server/`) — vars and secrets both in the
   Cloudflare dashboard (the config file sets `keep_vars: true` so deploys
   preserve them). Add `INVOICING_URL` / `INVOICING_SECRET` to turn on the
   Invoicing module.
4. **Deploy the Cloudflare Pages site** (`client/`) with `npm run build:all`
   (output `dist/`), `VITE_API_URL`, `VITE_APP_URL`, `VITE_SUPABASE_URL`,
   `VITE_ENABLE_REVIEWS_INTEGRATION=true`, `VITE_ENABLE_INVOICING=true`.
5. Verify: login → toggle a Review setting → open the **Invoicing** tab →
   create a quote from a won lead and confirm it persists.

---

## 1. One Supabase project

### 1.1 Create the project

In the Supabase dashboard: **New project** (any name, e.g. `crm-with-reviews`).
Note the **Project URL** and from **Project Settings → API** grab:

- `Project URL` — e.g. `https://abcd1234.supabase.co`
- `anon` public key
- `service_role` secret key (**never** expose this client-side)

### 1.2 Apply the migrations

The migrations are under `supabase/migrations/` and bootstrap the **whole**
project: CRM schema (`public`), lead conversion + dashboard stats RPCs, the
ReviewFlow schema (`reviewflow`), and the Invoicing schema (`invoicing`) —
all RLS keyed on `auth.uid()`.

```bash
# The Supabase CLI logs in with your access token.
supabase login

# Link the project (creates supabase/.temp / config.toml working state).
supabase link --project-ref <your-project-ref>   # e.g. abcd1234

# Apply all migrations in order:
supabase db push
```

Or if you prefer applying SQL by hand, copy the five files in order into the
SQL editor and run them:

1. `supabase/migrations/0001_crm_init.sql`
2. `supabase/migrations/0002_crm_lead_conversion.sql`
3. `supabase/migrations/0003_reviewflow_schema.sql`
4. `supabase/migrations/0004_invoicing_schema.sql`
5. `supabase/migrations/0005_invoicing_crm_hooks.sql`

What you get:

| Schema | Tables | Notes |
|---|---|---|
| `public` | `profiles`, `clients`, `leads`, `projects`, `email_captures`, `email_logs`, `settings` | CRM — unchanged from the original |
| `reviewflow` | `settings`, `leads`, `review_requests` | Reviews — single row of settings per user |
| `invoicing` | `settings`, `documents`, `document_lines`, `payments`, `email_events` | Quotes & invoices + RPCs (`mint_document_number`, `cross_walk_crm_customer`) |

**Schema-collision decision:** the CRM's `leads` table stays intact in
`public`. The Reviews product lives in a separate `reviewflow` schema and the
Invoicing module in `invoicing`, each with a `user_id` column on every table,
so there is no name collision and each CRM user only ever sees their own data.
Both modules (edge functions, dashboard components) are cleanly separated so
either product can be extracted again (see README → "Extracting again").

Registration automatically seeds:
- `public.profiles` + `public.settings` (as before)
- `reviewflow.settings` for the new user (via `handle_new_user()`)

The `invoicing.settings` row is created lazily on first access; a
`before insert` trigger (`invoicing.seed_settings_from_crm`) then copies
`business_name` / `currency` / `reply_to_email` from `public.settings` and
email/phone from `public.profiles` so a new user starts with their CRM
defaults.

### 1.3 Create the first user

Two options:

**Option A — dashboard sign-up.** Open the Pages site, click "Create an
account". The Supabase Auth sign-up trigger seeds all three rows.

**Option B — script.** One command creates a user with email confirmed and
seeds everything:

```bash
cd server
PROVISION_EMAIL=boss@you.co PROVISION_PASSWORD='super-secret' \
SUPABASE_URL=https://<ref>.supabase.co SUPABASE_SERVICE_KEY=<service-role-key> \
npx tsx scripts/provision-user.ts
```

---

## 2. Edge functions (Reviews + Invoicing)

### 2.1 Local verification

The edge functions are TypeScript in `supabase/functions/`. You can run one
locally:

```bash
supabase functions serve capture-lead --env-file ./supabase/.env.local
```

(`supabase/.env.local` holds the same secret names — see below.)

### 2.2 Set secrets

Each function reads secrets from the environment. Set them **once per
function** (secrets are shared per project when using `supabase secrets set`):

```bash
cd supabase
supabase secrets set SUPABASE_URL=https://<ref>.supabase.co
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
supabase secrets set RESEND_API_KEY=re_xxxx
# This MUST equal the Worker's REVIEWFLOW_SECRET / INVOICING_SECRET:
supabase secrets set INTEGRATION_SECRET=<long-random-string>
# Optional, per-function:
supabase secrets set --env invoicing-cron CRON_SECRET=<long-random-string>
supabase secrets set --env invoicing-resend-webhook RESEND_WEBHOOK_SECRET=<long-random-string>
```

> Note: there is no JWT requirement here — `integration-*` and `invoicing-*`
> functions are authenticated server-to-server with `x-integration-secret`.
> The dashboard never calls them directly; it goes through the Worker proxy,
> which adds the secret and the authenticated user's id.

### 2.3 Deploy all functions

```bash
# Reviews
supabase functions deploy capture-lead
supabase functions deploy send-review-email
supabase functions deploy integration-capture
supabase functions deploy integration-lead
supabase functions deploy integration-lookup
supabase functions deploy integration-overview
supabase functions deploy integration-send-review
supabase functions deploy integration-settings

# Invoicing
supabase functions deploy invoicing-api
supabase functions deploy invoicing-public
supabase functions deploy invoicing-cron
supabase functions deploy invoicing-resend-webhook
```

or, if you're on a shell with a loop:

```bash
for fn in capture-lead send-review-email integration-capture integration-lead \
          integration-lookup integration-overview integration-send-review \
          integration-settings invoicing-api invoicing-public \
          invoicing-cron invoicing-resend-webhook; do
  supabase functions deploy "$fn"
done
```

> Verify with `deno check <fn>/index.ts` before deploying (edge functions are
> not compiled by the monorepo build).

### 2.4 What the functions do

| Function | Purpose | Auth |
|---|---|---|
| `capture-lead` | Public widget submissions | `x-widget-key` (resolves the owning user) |
| `send-review-email` | Send review email for a reviewflow lead | `x-integration-secret` + `x-user-id` |
| `integration-capture` | CRM→Reviews mirror (lead won / project completed) | `x-integration-secret` + `x-user-id` |
| `integration-lead` | Admin CRUD + send-review on reviewflow leads | `x-integration-secret` + `x-user-id` |
| `integration-lookup` | Review-status badge data for a contact | `x-integration-secret` + `x-user-id` |
| `integration-overview` | One-call snapshot (settings + leads + requests) | `x-integration-secret` + `x-user-id` |
| `integration-send-review` | Send review email keyed by email/external_id | `x-integration-secret` + `x-user-id` |
| `integration-settings` | Read / update review settings, rotate widget key | `x-integration-secret` + `x-user-id` |
| `invoicing-api` | Quotes/invoices CRUD, actions (send/accept/decline/mark-paid), settings, payments, revenue, `/documents/from-project` & `/from-lead` | `x-integration-secret` + `x-user-id` (+ `x-api-key` on active share endpoints) |
| `invoicing-public` | Token-based share page (view/download/print) | token only (no auth) |
| `invoicing-cron` | Scheduled due-date reminders + stale-quote nudge | `CRON_SECRET` |
| `invoicing-resend-webhook` | Resend status updates → `invoicing.email_events` (mirrored to Ledger) | signature verification |

---

## 3. Cloudflare Worker (server)

The API is an Express app running inside a Worker via the Cloudflare
`nodejs_compat` runtime (see `server/src/worker.ts`).

### 3.1 Configure vars

**The Cloudflare dashboard is the source of truth.** `server/wrangler.jsonc`
deliberately has no `vars` block; it sets `keep_vars: true` so a deploy never
deletes bindings created in the dashboard. Add these under **Workers & Pages →
tradepro-combined → Settings → Variables and Secrets** as plain-text variables:

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CORS_ORIGIN` | `https://<your-pages-domain>.pages.dev` |
| `REVIEWFLOW_AUTO_SEND` | `true` |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | `<anon-key>` |
| `REVIEWFLOW_URL` | `https://<ref>.supabase.co` |
| `INVOICING_URL` | `https://<ref>.supabase.co` |

`REVIEWFLOW_URL` and `INVOICING_URL` are **the same Supabase project** now
(edge functions live on it under `/functions/v1`).

> Do not add a `vars` block back into `wrangler.jsonc`: any key present there
> overrides the dashboard value on every push, which defeats the point.

### 3.2 Set secrets

```bash
cd server
npx wrangler login
npx wrangler secret put JWT_SECRET            # used to sign CRM tokens
npx wrangler secret put SUPABASE_SERVICE_KEY  # service-role key
npx wrangler secret put RESEND_API_KEY        # for lead/project emails
npx wrangler secret put RESEND_FROM_EMAIL     # optional (defaults to onboarding@resend.dev)
npx wrangler secret put CAPTURE_SECRET        # optional — only if you protect /api/capture
# Integration secret — MUST equal the edge function INTEGRATION_SECRET:
npx wrangler secret put REVIEWFLOW_SECRET
# Invoicing — same INTEGRATION_SECRET; only needed if you don't set
# REVIEWFLOW_SECRET (config.ts falls back to REVIEWFLOW_SECRET):
npx wrangler secret put INVOICING_SECRET
# Optional alias accepted by config.ts if you prefer the name:
#   npx wrangler secret put INTEGRATION_SECRET
```

### 3.3 Deploy

```bash
cd server
npm run deploy:worker
```

Health check: `GET https://<worker>.workers.dev/api/health` should return
`{ "ok": true, "store": "supabase", ... }`.

### 3.4 Environment variables summary

| Env var | Where | Required |
|---|---|---|
| `SUPABASE_URL` | dashboard vars | yes |
| `SUPABASE_ANON_KEY` | dashboard vars | yes |
| `SUPABASE_SERVICE_KEY` | secret | yes |
| `JWT_SECRET` | secret | yes |
| `REVIEWFLOW_URL` | dashboard vars (same as SUPABASE_URL) | for Reviews |
| `REVIEWFLOW_SECRET` | secret (= INTEGRATION_SECRET on functions) | for Reviews |
| `REVIEWFLOW_AUTO_SEND` | dashboard vars | for auto-send |
| `INVOICING_URL` | dashboard vars (same as SUPABASE_URL) | for Invoicing |
| `INVOICING_SECRET` | secret (= INTEGRATION_SECRET; falls back to `REVIEWFLOW_SECRET`) | for Invoicing |
| `RESEND_API_KEY` | secret | for email |
| `RESEND_FROM_EMAIL` / `RESEND_REPLY_TO` | secret | optional overrides |
| `CORS_ORIGIN` | dashboard vars | yes |
| `CAPTURE_SECRET` / `REQUIRE_CAPTURE_SECRET` | secret/s | optional |
| `JWT_EXPIRES_IN` | secret/vars | optional (default 7d) |

---

## 4. Cloudflare Pages (client)

### 4.1 Build configuration

- **Framework preset:** `Vite`
- **Build command:** `npm run build:all`
- **Build output directory:** `dist`
- **Root directory:** `client` (if Pages is linked at the repo root, set the
  root directory to `client`)

`npm run build:all` builds the **widget first** (into `public/widget.js`),
then the app, so the final `dist/` contains both `index.html` and `widget.js`.

`client/public/_redirects` (SPA fallback) and `client/public/_routes.json`
(static-only configuration) are copied into `dist/` automatically, so deep
links like `/reviews`, `/settings`, `/ledger` don't 404 on refresh.

### 4.2 Environment variables

Set these in **Pages → Settings → Environment variables** (for Production):

| Var | Example | Purpose |
|---|---|---|
| `VITE_API_URL` | `https://crm-with-reviews-api.<acct>.workers.dev` | browser → Worker base URL |
| `VITE_APP_URL` | `https://crm-with-reviews.pages.dev` | used in widget + snippets |
| `VITE_SUPABASE_URL` | `https://<ref>.supabase.co` | baked fallback for widget snippet |
| `VITE_ENABLE_REVIEWS_INTEGRATION` | `true` | enables Reviews tab/badges |
| `VITE_ENABLE_INVOICING` | `true` | enables Invoicing tab + quote buttons from Projects/Leads |
| `VITE_API_TIMEOUT_MS` | `20000` | optional API timeout |

Deploy. The URL is your Pages domain.

---

## 5. Verify

With everything live:

1. **Login** at `https://<pages-domain>` (create an account if needed — this
   one login reaches the *entire* system: dashboard stats, leads, clients,
   projects, email ledger, Reviews dashboard, Invoicing and all settings).
2. **Reviews**: open **Reviews → Settings**, change a field (e.g.
   **Automation → Send after** slider) and save/blur the field. Reload and
   navigate back — the value persists through
   `Pages → Worker → integration-settings → reviewflow.settings`.
3. **Invoicing**:
   - Open **Invoicing** → **New quote**. Add a line item and save — the
     totals (subtotal / tax / total) are recalculated by
     `invoicing-api` server-side.
   - In **Settings** set your business name, quote prefix + next number,
     payment terms, tax rate and bank details; save and reload.
   - Creating a quote via **Projects → Create quote** or a **won lead →
     Quote** asks `/invoicing/from-project` / `/invoicing/from-lead` and
     deep-links into the editor with the customer snapshot + estimated value
     pre-filled.
   - **Send** the quote → a share link is produced; opening `/q/<token>`
     (or `/i/<token>` for invoices) forwards to the public `invoicing-public`
     page with no login required.
4. Sanity checks:
   - **Ledger**: after any review or invoice email, the email log shows it
     (invoice emails arrive via the `email_events → public.email_logs`
     mirror in migration 0005).
   - **Reviews → Leads**: add a lead, drag it to *Complete*; toast confirms
     the update; `review_send_after` is set to `now + delay`.
   - **Projects**: mark a project *completed* → the review-status badge on the
     project card flips to *review_sent* after the auto-send fires (or use
     "Send Review Request" on the card).

---

## Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| Login fails on the Pages site but works via the API | `VITE_API_URL` wrong or missing; the browser calls the Worker directly |
| `/api/integration/reviews/*` returns 404 | `REVIEWFLOW_URL` + `REVIEWFLOW_SECRET` not both set on the Worker |
| `/api/invoicing/*` returns 404 | `INVOICING_URL` + `INVOICING_SECRET` not both set on the Worker (or the client was built without `VITE_ENABLE_INVOICING`) |
| Invoicing tab shows “not configured” | `VITE_ENABLE_INVOICING` not set at client build time |
| Edge functions return 401 | `INTEGRATION_SECRET` on the functions ≠ `REVIEWFLOW_SECRET` / `INVOICING_SECRET` on the Worker |
| “Quote not found or has no client” from `from-project` | the CRM project has no `client_id` — set a client on the project first |
| Invoice emails missing from Ledger | `invoicing-resend-webhook` not deployed / `RESEND_WEBHOOK_SECRET` mismatch; `email_events` still records sends locally even without the webhook |
| Edge functions return `x-user-id header is required` | The Worker is older than the functions; redeploy the Worker so `user_id` flows through |
| “Failed to load settings” in Reviews | `reviewflow.settings` row missing for the user — sign up again or insert one manually; migrations + `handle_new_user()` normally seed it |
| Sending review email fails | `RESEND_API_KEY` set on the edge functions, and `review_from_email` is a verified sender in Resend |
| Widget submits nothing | The snippet's `data-supabase-url` points at the merged project and `data-api-key` matches the settings `widget_api_key` |
| Widget `404` on `capture-lead` | `supabase functions deploy capture-lead` not run yet |

## Auto-send scheduling

The merged dashboard includes the standalone's auto-send behaviour:

- Marking a review lead **Complete** stamps `completed_at` + `review_send_after`
  and (with auto-send enabled) schedules the email.
- While the Reviews page is open, a **5-minute polling loop** sends anything
  that became due (free-tier friendly — no cron required).

For more reliable delivery you can add a real scheduler (e.g. Supabase
`pg_cron` on the Pro plan, or a Cloudflare Worker Cron trigger) that calls
`integration-send-review` with `email` / `external_id` + the integration
secret + `x-user-id`. That is a drop-in replacement for the polling loop.