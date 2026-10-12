-- ============================================================================
-- crm-with-reviews — Migration 0003: ReviewFlow (reviews) schema
-- ----------------------------------------------------------------------------
-- DESIGN DECISION (documented in the README):
--
--   The standalone ReviewFlow product was single-tenant: one Supabase project
--   per client, its tables living in `public` (settings / leads /
--   review_requests) with permissive RLS keyed on "authenticated".
--
--   This merged system serves <crm_user> accounts from ONE Supabase project,
--   so the Reviews tables cannot live in `public` (they would collide with the
--   CRM's `leads`) and cannot be shared across users. They are therefore moved
--   into a separate `reviewflow` schema and every table gains a `user_id`
--   column so RLS is keyed on auth.uid() exactly like the CRM tables.
--
--   The ReviewFlow modules (edge functions, widget, dashboard components)
--   remain cleanly separated under reviewflow.* so they can be extracted back
--   into a standalone single-tenant product later (see README "Extracting
--   ReviewFlow again").
--
--   Edge functions run with the service-role key and scope every query by the
--   `user_id` threaded through the CRM API proxy (x-user-id header). The
--   widget/capture edge functions resolve the owning user through the widget
--   API key.
-- ============================================================================

create schema if not exists reviewflow;

-- ---------------------------------------------------------------------------
-- reviewflow.settings — per-user review configuration (one row per user)
-- ---------------------------------------------------------------------------
create table if not exists reviewflow.settings (
  id                      uuid        primary key default gen_random_uuid(),
  user_id                 uuid        not null unique references auth.users (id) on delete cascade,
  business_name           text        not null default '',
  google_review_url       text        not null default '',
  review_from_name        text        not null default '',
  review_from_email       text        not null default '',
  review_reply_to_email   text        not null default '',
  auto_send_enabled       boolean     not null default true,
  auto_send_delay_hours   int         not null default 1
                          check (auto_send_delay_hours between 1 and 168),
  widget_api_key          text        not null default encode(gen_random_bytes(32), 'hex'),
  email_subject_template  text        not null default
    'Thank you for choosing {{business_name}} — we''d love your feedback!',
  email_intro_text        text        not null default
    'It was a pleasure working with you. If you have 60 seconds, a Google review means the world to a small business like ours.',
  email_button_text       text        not null default 'Leave a Google Review',
  email_brand_color       text        not null default '#0ea5e9',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- The row for each user is seeded by public.handle_new_user() on sign-up.

alter table reviewflow.settings enable row level security;

create policy "Users can view own review settings"
  on reviewflow.settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own review settings"
  on reviewflow.settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own review settings"
  on reviewflow.settings for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- reviewflow.leads — review pipeline leads (widget / capture_fn / manual / crm)
-- ---------------------------------------------------------------------------
create table if not exists reviewflow.leads (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users (id) on delete cascade,
  first_name        text        not null default '',
  last_name         text        not null default '',
  email             text        not null,
  phone             text,
  service           text,
  message           text,
  source            text        not null default 'manual'
                    check (source in ('widget','capture_fn','manual','crm')),
  status            text        not null default 'new'
                    check (status in ('new','in_progress','complete','review_sent','cancelled')),
  external_id       text,  -- the CRM's project id (idempotent upserts)
  completed_at      timestamptz,
  review_send_after timestamptz,  -- computed: completed_at + delay
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists reviewflow_leads_user_idx    on reviewflow.leads (user_id);
create index if not exists reviewflow_leads_status_idx  on reviewflow.leads (user_id, status);
create index if not exists reviewflow_leads_email_idx   on reviewflow.leads (user_id, lower(email));
create index if not exists reviewflow_leads_created_idx on reviewflow.leads (user_id, created_at desc);
create index if not exists reviewflow_leads_ext_id_idx  on reviewflow.leads (external_id)
  where external_id is not null;

alter table reviewflow.leads enable row level security;

create policy "Users can view own review leads"
  on reviewflow.leads for select
  using (auth.uid() = user_id);

create policy "Users can insert own review leads"
  on reviewflow.leads for insert
  with check (auth.uid() = user_id);

create policy "Users can update own review leads"
  on reviewflow.leads for update
  using (auth.uid() = user_id);

create policy "Users can delete own review leads"
  on reviewflow.leads for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- reviewflow.review_requests — log of every review email sent
-- ---------------------------------------------------------------------------
create table if not exists reviewflow.review_requests (
  id                  uuid        primary key default gen_random_uuid(),
  user_id             uuid        not null references auth.users (id) on delete cascade,
  lead_id             uuid        not null references reviewflow.leads(id) on delete cascade,
  recipient_email     text        not null,
  recipient_name      text,
  email_subject       text,
  resend_message_id   text,
  status              text        not null default 'sent'
                      check (status in ('sent','delivered','bounced','failed')),
  triggered_by        text        not null default 'auto'
                      check (triggered_by in ('auto','manual')),
  sent_at             timestamptz not null default now(),
  created_at          timestamptz not null default now()
);

create index if not exists reviewflow_rr_user_idx on reviewflow.review_requests (user_id);
create index if not exists reviewflow_rr_lead_idx on reviewflow.review_requests (lead_id);
create index if not exists reviewflow_rr_sent_idx on reviewflow.review_requests (user_id, sent_at desc);

alter table reviewflow.review_requests enable row level security;

create policy "Users can view own review requests"
  on reviewflow.review_requests for select
  using (auth.uid() = user_id);

create policy "Users can insert own review requests"
  on reviewflow.review_requests for insert
  with check (auth.uid() = user_id);

create policy "Users can update own review requests"
  on reviewflow.review_requests for update
  using (auth.uid() = user_id);

create policy "Users can delete own review requests"
  on reviewflow.review_requests for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Helper: rotate the widget API key safely (used by the Settings page).
-- Per-user: only rotates the calling user's own settings row.
-- ---------------------------------------------------------------------------
create or replace function reviewflow.rotate_widget_api_key()
returns table (widget_api_key text)
language plpgsql
security definer set search_path = reviewflow
as $$
begin
  update reviewflow.settings
     set widget_api_key = encode(gen_random_bytes(32), 'hex'),
         updated_at = now()
   where user_id = auth.uid();

  return query select s.widget_api_key
               from reviewflow.settings s
               where s.user_id = auth.uid();
end;
$$;

revoke all on function reviewflow.rotate_widget_api_key() from public;
grant execute on function reviewflow.rotate_widget_api_key() to authenticated;