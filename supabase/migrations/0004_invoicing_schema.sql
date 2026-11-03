-- ============================================================================
-- crm-with-reviews — Migration 0004: Invoicing (quotes & invoices) schema
-- ----------------------------------------------------------------------------
-- Invoicing lives in its own `invoicing` schema on the SAME Supabase project,
-- mirroring the ReviewFlow precedent. Every table carries a user_id column and
-- per-user RLS keyed on auth.uid(), so the module is multi-tenant and stays
-- cleanly extractable into the standalone Invoicing-system repo later.
--
-- The standalone Invoicing-system migrations (0001-0003) are merged here in
-- order, contents kept byte-identical apart from the filename, so this schema
-- can be diffed against the standalone repo.
--
--   standalone 0001  ->  invoicing.settings, invoicing.documents,
--                        invoicing.document_lines, invoicing.payments
--   standalone 0002  ->  invoicing.email_events
--   standalone 0003  ->  invoicing.customers + storage bucket
--
-- Edge functions run with the service-role key and scope every query by the
-- user_id threaded through the CRM API proxy (x-user-id header).
-- ============================================================================

create schema if not exists invoicing;

-- ---------------------------------------------------------------------------
-- invoicing.settings — per-user invoicing configuration (one row per user).
-- Created lazily by the API; 0005 adds a before-insert trigger that seeds it
-- from the CRM (public.settings / public.profiles) so a user's first
-- document already has sensible defaults.
-- ---------------------------------------------------------------------------
create table if not exists invoicing.settings (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null unique references auth.users (id) on delete cascade,
  business_name         text        not null default '',
  email                 text        not null default '',
  phone                 text        not null default '',
  reply_to_email        text        not null default '',
  currency              text        not null default 'USD',
  locale                text        not null default 'en-US',
  tax_rate              numeric(6,4) not null default 0,
  payment_terms_days    integer     not null default 14,
  quote_valid_days      integer     not null default 30,
  invoice_prefix        text        not null default 'INV-',
  quote_prefix          text        not null default 'QT-',
  next_invoice_number   bigint      not null default 1,
  next_quote_number     bigint      not null default 1,
  notes                 text        not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists invoicing_settings_user_idx on invoicing.settings (user_id);

alter table invoicing.settings enable row level security;

create policy "Users can view own invoicing settings"
  on invoicing.settings for select
  using (auth.uid() = user_id);

create policy "Users can insert own invoicing settings"
  on invoicing.settings for insert
  with check (auth.uid() = user_id);

create policy "Users can update own invoicing settings"
  on invoicing.settings for update
  using (auth.uid() = user_id);

create policy "Users can delete own invoicing settings"
  on invoicing.settings for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- invoicing.documents — quotes AND invoices in one table (kind column).
-- Documents reference the CRM via external_* refs (public.clients.id,
-- public.projects.id, public.leads.id) plus an immutable customer_snapshot so
-- the PDF/email stay correct even if the CRM contact later changes.
--
-- status evolution:
--   quote   : draft -> sent -> accepted | declined ; void
--   invoice : draft -> issued -> partially_paid -> paid ; overdue ; void
-- ---------------------------------------------------------------------------
create table if not exists invoicing.documents (
  id                    uuid        primary key default gen_random_uuid(),
  user_id               uuid        not null references auth.users (id) on delete cascade,
  kind                  text        not null check (kind in ('quote','invoice')),
  number                text        not null,
  status                text        not null default 'draft'
                        check (status in ('draft','sent','accepted','declined','issued','partially_paid','paid','overdue','void')),
  external_customer_ref uuid,          -- public.clients.id (same user)
  external_project_ref  uuid,          -- public.projects.id (same user)
  external_lead_ref     uuid,          -- public.leads.id (same user)
  customer_snapshot     jsonb       not null default '{}'::jsonb,
  issue_date            date,
  due_date              date,
  quote_valid_until     date,
  title                 text        not null default '',
  notes                 text        not null default '',
  currency              text        not null default 'USD',
  subtotal_minor        bigint      not null default 0,
  tax_minor             bigint      not null default 0,
  total_minor           bigint      not null default 0,
  amount_paid_minor     bigint      not null default 0,
  token                 text        not null default encode(gen_random_bytes(16), 'hex'),
  sent_at               timestamptz,
  meta                  jsonb       not null default '{}'::jsonb,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create unique index if not exists invoicing_documents_number_idx
  on invoicing.documents (user_id, kind, number);
create index if not exists invoicing_documents_user_idx
  on invoicing.documents (user_id);
create index if not exists invoicing_documents_status_idx
  on invoicing.documents (user_id, kind, status);
create index if not exists invoicing_documents_customer_idx
  on invoicing.documents (user_id, external_customer_ref)
  where external_customer_ref is not null;
create index if not exists invoicing_documents_project_idx
  on invoicing.documents (user_id, external_project_ref)
  where external_project_ref is not null;
create index if not exists invoicing_documents_lead_idx
  on invoicing.documents (user_id, external_lead_ref)
  where external_lead_ref is not null;
create index if not exists invoicing_documents_token_idx
  on invoicing.documents (token);

alter table invoicing.documents enable row level security;

create policy "Users can view own documents"
  on invoicing.documents for select
  using (auth.uid() = user_id);

create policy "Users can insert own documents"
  on invoicing.documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update own documents"
  on invoicing.documents for update
  using (auth.uid() = user_id);

create policy "Users can delete own documents"
  on invoicing.documents for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- invoicing.document_lines — line items on a document
-- ---------------------------------------------------------------------------
create table if not exists invoicing.document_lines (
  id                uuid        primary key default gen_random_uuid(),
  user_id           uuid        not null references auth.users (id) on delete cascade,
  document_id       uuid        not null references invoicing.documents (id) on delete cascade,
  description       text        not null default '',
  quantity          numeric(12,2) not null default 1 check (quantity > 0),
  unit_price_minor  bigint      not null default 0,
  sort_order        integer     not null default 0,
  created_at        timestamptz not null default now()
);

create index if not exists invoicing_document_lines_doc_idx
  on invoicing.document_lines (document_id, sort_order);

alter table invoicing.document_lines enable row level security;

create policy "Users can view own document lines"
  on invoicing.document_lines for select
  using (auth.uid() = user_id);

create policy "Users can insert own document lines"
  on invoicing.document_lines for insert
  with check (auth.uid() = user_id);

create policy "Users can update own document lines"
  on invoicing.document_lines for update
  using (auth.uid() = user_id);

create policy "Users can delete own document lines"
  on invoicing.document_lines for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- invoicing.payments — payments against an invoice (records amount paid)
-- ---------------------------------------------------------------------------
create table if not exists invoicing.payments (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  document_id   uuid        not null references invoicing.documents (id) on delete cascade,
  amount_minor  bigint      not null check (amount_minor > 0),
  method        text        not null default 'other' check (method in ('cash','card','bank','check','other')),
  received_at   timestamptz not null default now(),
  notes         text        not null default '',
  created_at    timestamptz not null default now()
);

create index if not exists invoicing_payments_doc_idx on invoicing.payments (document_id);

alter table invoicing.payments enable row level security;

create policy "Users can view own payments"
  on invoicing.payments for select
  using (auth.uid() = user_id);

create policy "Users can insert own payments"
  on invoicing.payments for insert
  with check (auth.uid() = user_id);

create policy "Users can delete own payments"
  on invoicing.payments for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- invoicing.email_events — outbound email log for documents. 0005 mirrors
-- these into public.email_logs so the CRM Ledger page shows them for free.
-- ---------------------------------------------------------------------------
create table if not exists invoicing.email_events (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  document_id   uuid        not null references invoicing.documents (id) on delete cascade,
  kind          text        not null check (kind in ('quote_sent','invoice_sent','payment_received','reminder')),
  to_email      text        not null,
  subject       text        not null default '',
  message_id    text,
  status        text        not null default 'queued'
                check (status in ('queued','sent','delivered','bounced','failed','complained')),
  meta          jsonb       not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists invoicing_email_events_doc_idx on invoicing.email_events (document_id);
create index if not exists invoicing_email_events_user_idx on invoicing.email_events (user_id);

alter table invoicing.email_events enable row level security;

create policy "Users can view own email events"
  on invoicing.email_events for select
  using (auth.uid() = user_id);

create policy "Users can insert own email events"
  on invoicing.email_events for insert
  with check (auth.uid() = user_id);

create policy "Users can update own email events"
  on invoicing.email_events for update
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- invoicing.customers — the standalone Invoicing-system's own customers table.
-- In the Tradepro-combined UI this table stays UNUSED: customers come from the
-- CRM (documents carry external_customer_ref to public.clients). The table
-- exists only so the standalone migrations remain copy-friendly.
-- ---------------------------------------------------------------------------
create table if not exists invoicing.customers (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  name        text        not null default '',
  email       text        not null default '',
  phone       text        not null default '',
  address     jsonb       not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists invoicing_customers_user_idx on invoicing.customers (user_id);

alter table invoicing.customers enable row level security;

create policy "Users can view own customers"
  on invoicing.customers for select
  using (auth.uid() = user_id);

create policy "Users can insert own customers"
  on invoicing.customers for insert
  with check (auth.uid() = user_id);

create policy "Users can update own customers"
  on invoicing.customers for update
  using (auth.uid() = user_id);

create policy "Users can delete own customers"
  on invoicing.customers for delete
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Auto-update updated_at triggers
-- ---------------------------------------------------------------------------
create or replace function invoicing.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists invoicing_settings_updated_at on invoicing.settings;
create trigger invoicing_settings_updated_at before update on invoicing.settings
  for each row execute function invoicing.set_updated_at();

drop trigger if exists invoicing_documents_updated_at on invoicing.documents;
create trigger invoicing_documents_updated_at before update on invoicing.documents
  for each row execute function invoicing.set_updated_at();

drop trigger if exists invoicing_customers_updated_at on invoicing.customers;
create trigger invoicing_customers_updated_at before update on invoicing.customers
  for each row execute function invoicing.set_updated_at();

-- ---------------------------------------------------------------------------
-- Storage bucket for generated document PDFs. PDF files are written by the
-- invoicing-* edge functions with the service-role key (which bypasses RLS);
-- the public share pages render HTML client-side and never need anon reads.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('invoicing-documents', 'invoicing-documents', false)
on conflict (id) do nothing;