-- 0008_rls_and_indexes.sql
-- Supporting indexes for foreign keys and common owner-scoped list queries.
CREATE INDEX IF NOT EXISTS invoicing_document_lines_user_id_idx ON invoicing.document_lines(user_id);
CREATE INDEX IF NOT EXISTS invoicing_payments_user_id_idx ON invoicing.payments(user_id);
CREATE INDEX IF NOT EXISTS email_captures_lead_id_idx ON public.email_captures(lead_id);
CREATE INDEX IF NOT EXISTS email_logs_client_id_idx ON public.email_logs(client_id);
CREATE INDEX IF NOT EXISTS email_logs_lead_id_idx ON public.email_logs(lead_id);
CREATE INDEX IF NOT EXISTS projects_lead_id_idx ON public.projects(lead_id);

CREATE INDEX IF NOT EXISTS leads_user_created_idx ON public.leads(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS clients_user_created_idx ON public.clients(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS projects_user_created_idx ON public.projects(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS leads_email_lower_idx ON public.leads(lower(email));
CREATE INDEX IF NOT EXISTS clients_email_lower_idx ON public.clients(lower(email));


-- Wrap auth.uid() in a scalar SELECT so PostgreSQL can init-plan it once
-- per statement while preserving each existing policy's expression and name.
DO $$
DECLARE p record; q text; w text; stmt text;
BEGIN
  FOR p IN SELECT schemaname,tablename,policyname,qual,with_check
    FROM pg_policies WHERE schemaname IN ('public','reviewflow','invoicing')
  LOOP
    q := CASE WHEN p.qual IS NULL THEN NULL ELSE regexp_replace(p.qual,'auth[.]uid[[:space:]]*[(][[:space:]]*[)]','(select auth.uid())','g') END;
    w := CASE WHEN p.with_check IS NULL THEN NULL ELSE regexp_replace(p.with_check,'auth[.]uid[[:space:]]*[(][[:space:]]*[)]','(select auth.uid())','g') END;
    stmt := format('ALTER POLICY %I ON %I.%I',p.policyname,p.schemaname,p.tablename);
    IF q IS NOT NULL THEN stmt := stmt || format(' USING (%s)',q); END IF;
    IF w IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)',w); END IF;
    EXECUTE stmt;
  END LOOP;
END $$;
