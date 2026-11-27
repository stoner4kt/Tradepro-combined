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
