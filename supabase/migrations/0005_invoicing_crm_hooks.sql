-- ============================================================================
-- crm-with-reviews — Migration 0005: Invoicing -> CRM hooks (Tradepro-ONLY)
-- ----------------------------------------------------------------------------
-- This migration is intentionally NOT part of the standalone Invoicing-system
-- repo: it is the Tradepro-specific glue between the `invoicing` schema and
-- the CRM schema (public.*). It contains database triggers that keep the two
-- products in sync:
--
--   1. Settings defaults      – seed invoicing.settings from the CRM on first
--                               insert (business_name, currency, reply_to)
--   2. Quote accepted -> CRM  – won lead / scheduled project
--   3. Quote sent -> lead     – new|contacted|qualified lead -> proposal
--   4. Email ledger mirror    – invoicing.email_events -> public.email_logs so
--                               the CRM Ledger page lists invoice emails
--
-- Every function is SECURITY DEFINER with `set search_path = public, invoicing`
-- so it can read/write both schemas regardless of the calling role. Every hook
-- body is wrapped in its own exception block so a failure can NEVER roll back
-- the originating invoicing write — it only raises a WARNING.
--
-- No edits are made to existing tables or to public.handle_new_user().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Settings defaults trigger: before insert on invoicing.settings.
-- Copies business_name / currency / reply_to_email from public.settings and
-- phone / email from public.profiles for the same user. Fallbacks leave the
-- invoicing defaults untouched when the CRM has no data yet.
-- ---------------------------------------------------------------------------
create or replace function invoicing.seed_settings_from_crm()
returns trigger
language plpgsql
as $$
declare
  v_business_name text;
  v_currency      text;
  v_reply_to      text;
  v_phone         text;
  v_email         text;
begin
  begin
    -- Prefer the CRM settings row (public.settings), then fall back to the
    -- user's profile row (public.profiles), then keep the incoming defaults.
    select s.business_name, s.currency, s.reply_to_email
      into v_business_name, v_currency, v_reply_to
      from public.settings s
     where s.user_id = new.user_id;

    if v_business_name is null then
      select p.business_name, p.phone, p.email
        into v_business_name, v_phone, v_email
        from public.profiles p
       where p.id = new.user_id;
    else
      select p.phone, p.email
        into v_phone, v_email
        from public.profiles p
       where p.id = new.user_id;
    end if;

    new.business_name := coalesce(nullif(v_business_name, ''), new.business_name);
    new.currency      := coalesce(nullif(v_currency, ''), new.currency);
    new.reply_to_email:= coalesce(nullif(v_reply_to, ''), new.reply_to_email);
    new.phone         := coalesce(nullif(v_phone, ''), new.phone);
    new.email         := coalesce(nullif(v_email, ''), new.email);
  exception when others then
    raise warning 'invoicing.seed_settings_from_crm failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists invoicing_seed_settings on invoicing.settings;
create trigger invoicing_seed_settings
  before insert on invoicing.settings
  for each row execute function invoicing.seed_settings_from_crm();

-- ---------------------------------------------------------------------------
-- 2 & 3. Quote lifecycle triggers: after update of status on documents.
--
--   quote -> accepted : if external_lead_ref points at a lead owned by this
--                       user, set public.leads.status='won'. If
--                       external_project_ref points at a project owned by this
--                       user and the project is still 'new', move it to
--                       'scheduled' ONLY if a scheduled date already exists,
--                       otherwise leave it alone.
--   quote -> sent     : first time a quote is sent, if the linked lead is
--                       new/contacted/qualified move it to 'proposal'.
--
-- Rows always recheck the user_id on the referenced CRM rows so we never
-- touch a different tenant's data.
-- ---------------------------------------------------------------------------
create or replace function invoicing.quote_status_to_crm()
returns trigger
language plpgsql
as $$
begin
  if new.kind = 'quote' and new.status = 'accepted' then
    begin
      if new.external_lead_ref is not null then
        update public.leads
           set status = 'won',
               updated_at = now()
         where id = new.external_lead_ref
           and user_id = new.user_id;
      end if;

      if new.external_project_ref is not null then
        update public.projects
           set status = case when scheduled_date is not null then 'scheduled' else status end,
               updated_at = now()
         where id = new.external_project_ref
           and user_id = new.user_id
           and status = 'new';
      end if;
    exception when others then
      raise warning 'invoicing.quote accepted hook failed: %', sqlerrm;
    end;
  end if;

  if new.kind = 'quote' and new.status = 'sent' and old.status <> 'sent' then
    begin
      if new.external_lead_ref is not null then
        update public.leads
           set status = 'proposal',
               updated_at = now()
         where id = new.external_lead_ref
           and user_id = new.user_id
           and status in ('new', 'contacted', 'qualified');
      end if;
    exception when others then
      raise warning 'invoicing.quote sent hook failed: %', sqlerrm;
    end;
  end if;

  return new;
end;
$$;

drop trigger if exists invoicing_quote_status_to_crm on invoicing.documents;
create trigger invoicing_quote_status_to_crm
  after update of status on invoicing.documents
  for each row when (new.kind = 'quote')
  execute function invoicing.quote_status_to_crm();

-- ---------------------------------------------------------------------------
-- 4. Email ledger mirror: invoicing.email_events -> public.email_logs.
-- On insert we always write a ledger row (status pending when queued), store
-- its id in email_events.meta.ledger_id, and copy `provider` back. On an
-- update of email_events.status we update the mirrored ledger row so Resend
-- webhook status transitions stay in sync.
--
-- template: invoice_<kind>      (quote_sent, invoice_sent, payment_received, reminder)
-- status  : queued->pending, sent/delivered->sent, bounced/failed/complained->failed
-- provider: resend, or console when the email was queued by dev mode
-- client_id / lead_id are resolved from the document's external refs and only
-- linked when they belong to the same user.
-- ---------------------------------------------------------------------------
create or replace function invoicing.mirror_email_event_to_ledger()
returns trigger
language plpgsql
as $$
declare
  v_client_id uuid;
  v_lead_id   uuid;
  v_provider  text := 'resend';
  v_template  text := 'invoice_' || new.kind;
  v_status    text;
  v_ledger_id uuid;
begin
  -- Map the email event status onto the CRM email_logs status vocabulary.
  case new.status
    when 'queued' then v_status := 'pending';
    when 'sent' then v_status := 'sent';
    when 'delivered' then v_status := 'sent';
    when 'bounced' then v_status := 'failed';
    when 'failed' then v_status := 'failed';
    when 'complained' then v_status := 'failed';
    else v_status := 'pending';
  end case;

  -- Emails queued by the local dev console (no Resend) carry provider console.
  if new.status = 'queued' and coalesce(new.meta->>'dev_console', 'false') = 'true' then
    v_provider := 'console';
  end if;

  begin
    -- Resolve the CRM row ids from the document's external refs (same user).
    select d.external_customer_ref into v_client_id
      from invoicing.documents d
     where d.id = new.document_id;

    select d.external_lead_ref into v_lead_id
      from invoicing.documents d
     where d.id = new.document_id;

    insert into public.email_logs
      (user_id, client_id, lead_id, to_email, subject, template, status, provider, sent_at)
    values
      (new.user_id, v_client_id, v_lead_id, new.to_email, new.subject, v_template, v_status, v_provider, new.created_at)
    returning id into v_ledger_id;

    -- Remember the ledger id so a later status update can mirror through.
    update invoicing.email_events
       set meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object('ledger_id', v_ledger_id)
     where id = new.id;

    exception when others then
      raise warning 'invoicing.mirror_email_event failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists invoicing_email_ledger_insert on invoicing.email_events;
create trigger invoicing_email_ledger_insert
  after insert on invoicing.email_events
  for each row execute function invoicing.mirror_email_event_to_ledger();

-- On status updates, mirror through to the ledger row we linked at insert
-- time (only when meta.ledger_id exists).
create or replace function invoicing.mirror_email_event_status_to_ledger()
returns trigger
language plpgsql
as $$
declare
  v_ledger_id uuid;
  v_status    text;
begin
  v_ledger_id := (new.meta->>'ledger_id')::uuid;
  if v_ledger_id is null then
    return new;
  end if;

  case new.status
    when 'queued' then v_status := 'pending';
    when 'sent' then v_status := 'sent';
    when 'delivered' then v_status := 'sent';
    when 'bounced' then v_status := 'failed';
    when 'failed' then v_status := 'failed';
    when 'complained' then v_status := 'failed';
    else v_status := 'pending';
  end case;

  begin
    update public.email_logs
       set status = v_status,
           provider = case when new.status = 'queued'
                            and coalesce(new.meta->>'dev_console','false') = 'true' then 'console' else 'resend' end
     where id = v_ledger_id
       and user_id = new.user_id;
  exception when others then
    raise warning 'invoicing.mirror_email_event_status failed: %', sqlerrm;
  end;
  return new;
end;
$$;

drop trigger if exists invoicing_email_ledger_update on invoicing.email_events;
create trigger invoicing_email_ledger_update
  after update of status on invoicing.email_events
  for each row execute function invoicing.mirror_email_event_status_to_ledger();

-- ---------------------------------------------------------------------------
-- Grants. Anon must never reach the tables (RLS is per-user anyway and the
-- functions are authenticated-only helpers). The edge functions use the
-- service-role key which bypasses RLS; these grants exist so functions/views
-- (e.g. Supabase Studio SQL) can be run by the owner.
-- ---------------------------------------------------------------------------
revoke all on function invoicing.seed_settings_from_crm() from public, anon;
revoke all on function invoicing.quote_status_to_crm() from public, anon;
revoke all on function invoicing.mirror_email_event_to_ledger() from public, anon;
revoke all on function invoicing.mirror_email_event_status_to_ledger() from public, anon;