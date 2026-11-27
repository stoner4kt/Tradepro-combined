-- 0010_invoicing_integrity.sql
-- Atomic, idempotent payment recording and guarded document lifecycle.
ALTER TABLE invoicing.payments ADD COLUMN IF NOT EXISTS idempotency_key text;
CREATE UNIQUE INDEX IF NOT EXISTS invoicing_payments_document_idempotency_idx
  ON invoicing.payments(document_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

CREATE OR REPLACE FUNCTION invoicing.enforce_document_lifecycle()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, invoicing
AS $$
DECLARE allowed boolean := false;
BEGIN
  IF TG_OP='UPDATE' THEN
    IF OLD.status <> 'draft' AND (
      NEW.number IS DISTINCT FROM OLD.number OR NEW.kind IS DISTINCT FROM OLD.kind OR
      NEW.customer_snapshot IS DISTINCT FROM OLD.customer_snapshot OR
      NEW.currency IS DISTINCT FROM OLD.currency OR
      NEW.subtotal_minor IS DISTINCT FROM OLD.subtotal_minor OR
      NEW.tax_minor IS DISTINCT FROM OLD.tax_minor OR
      NEW.total_minor IS DISTINCT FROM OLD.total_minor OR
      NEW.external_customer_ref IS DISTINCT FROM OLD.external_customer_ref OR
      NEW.external_project_ref IS DISTINCT FROM OLD.external_project_ref OR
      NEW.external_lead_ref IS DISTINCT FROM OLD.external_lead_ref
    ) THEN RAISE EXCEPTION 'sent documents are immutable'; END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
      allowed := CASE OLD.kind
        WHEN 'quote' THEN (OLD.status='draft' AND NEW.status IN ('sent','void'))
          OR (OLD.status='sent' AND NEW.status IN ('accepted','declined','void'))
        WHEN 'invoice' THEN (OLD.status='draft' AND NEW.status IN ('issued','void'))
          OR (OLD.status='issued' AND NEW.status IN ('partially_paid','paid','overdue','void'))
          OR (OLD.status='partially_paid' AND NEW.status IN ('paid','overdue','void'))
          OR (OLD.status='overdue' AND NEW.status IN ('partially_paid','paid','void'))
        ELSE false END;
      IF NOT allowed THEN RAISE EXCEPTION 'invalid document status transition'; END IF;
      IF OLD.status IN ('paid','void') THEN RAISE EXCEPTION 'terminal document status'; END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS invoicing_document_lifecycle_guard ON invoicing.documents;
CREATE TRIGGER invoicing_document_lifecycle_guard BEFORE UPDATE ON invoicing.documents
FOR EACH ROW EXECUTE FUNCTION invoicing.enforce_document_lifecycle();

CREATE OR REPLACE FUNCTION invoicing.prevent_sent_line_mutation()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public, invoicing
AS $$
DECLARE doc_status text; doc_id uuid;
BEGIN
  doc_id := CASE WHEN TG_OP='DELETE' THEN OLD.document_id ELSE NEW.document_id END;
  SELECT status INTO doc_status FROM invoicing.documents WHERE id=doc_id
    AND user_id=CASE WHEN TG_OP='DELETE' THEN OLD.user_id ELSE NEW.user_id END FOR UPDATE;
  IF doc_status IS DISTINCT FROM 'draft' THEN RAISE EXCEPTION 'lines on non-draft documents are immutable'; END IF;
  RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;
DROP TRIGGER IF EXISTS invoicing_document_lines_guard ON invoicing.document_lines;
CREATE TRIGGER invoicing_document_lines_guard BEFORE INSERT OR UPDATE OR DELETE ON invoicing.document_lines
FOR EACH ROW EXECUTE FUNCTION invoicing.prevent_sent_line_mutation();

CREATE OR REPLACE FUNCTION invoicing.record_payment(
  p_user_id uuid,p_document_id uuid,p_amount_minor bigint,p_method text,
  p_reference text,p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, invoicing
AS $$
DECLARE d invoicing.documents%ROWTYPE; existing invoicing.payments%ROWTYPE; payment invoicing.payments%ROWTYPE; remaining bigint;
BEGIN
  IF p_amount_minor <= 0 OR p_idempotency_key IS NULL OR length(p_idempotency_key) NOT BETWEEN 8 AND 128 THEN
    RAISE EXCEPTION 'invalid payment request';
  END IF;
  SELECT * INTO d FROM invoicing.documents WHERE id=p_document_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'document not found'; END IF;
  SELECT * INTO existing FROM invoicing.payments WHERE document_id=p_document_id AND idempotency_key=p_idempotency_key;
  IF FOUND THEN RETURN jsonb_build_object('payment',to_jsonb(existing),'duplicate',true); END IF;
  IF d.kind <> 'invoice' OR d.status NOT IN ('issued','partially_paid','overdue') THEN
    RAISE EXCEPTION 'invoice is not payable';
  END IF;
  remaining := d.total_minor-d.amount_paid_minor;
  IF p_amount_minor > remaining THEN RAISE EXCEPTION 'payment exceeds outstanding balance'; END IF;
  INSERT INTO invoicing.payments(user_id,document_id,amount_minor,method,notes,idempotency_key)
  VALUES(p_user_id,p_document_id,p_amount_minor,coalesce(p_method,'other'),coalesce(p_reference,''),p_idempotency_key)
  RETURNING * INTO payment;
  UPDATE invoicing.documents SET amount_paid_minor=amount_paid_minor+p_amount_minor,
    status=CASE WHEN amount_paid_minor+p_amount_minor >= total_minor THEN 'paid' ELSE 'partially_paid' END,
    updated_at=now()
  WHERE id=p_document_id AND user_id=p_user_id;
  RETURN jsonb_build_object('payment',to_jsonb(payment),'duplicate',false);
END $$;
REVOKE ALL ON FUNCTION invoicing.record_payment(uuid,uuid,bigint,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION invoicing.record_payment(uuid,uuid,bigint,text,text,text) TO service_role;
REVOKE ALL ON FUNCTION invoicing.enforce_document_lifecycle() FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION invoicing.prevent_sent_line_mutation() FROM PUBLIC,anon,authenticated;

-- Svix delivery deduplication for the Resend webhook.
CREATE TABLE IF NOT EXISTS invoicing.webhook_receipts (
  svix_id text PRIMARY KEY,
  received_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE invoicing.webhook_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoicing.webhook_receipts FROM PUBLIC,anon,authenticated;
GRANT ALL ON invoicing.webhook_receipts TO service_role;


CREATE OR REPLACE FUNCTION invoicing.delete_payment(p_user_id uuid,p_payment_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, invoicing
AS $$
DECLARE p invoicing.payments%ROWTYPE; d invoicing.documents%ROWTYPE; paid bigint; next_status text;
BEGIN
  SELECT * INTO p FROM invoicing.payments WHERE id=p_payment_id AND user_id=p_user_id;
  IF NOT FOUND THEN RETURN false; END IF;
  SELECT * INTO d FROM invoicing.documents WHERE id=p.document_id AND user_id=p_user_id FOR UPDATE;
  IF NOT FOUND OR d.status='paid' OR d.status='void' THEN RAISE EXCEPTION 'payment cannot be deleted'; END IF;
  DELETE FROM invoicing.payments WHERE id=p_payment_id AND user_id=p_user_id;
  SELECT coalesce(sum(amount_minor),0) INTO paid FROM invoicing.payments WHERE document_id=p.document_id AND user_id=p_user_id;
  next_status := CASE WHEN paid >= d.total_minor THEN 'paid' WHEN paid > 0 THEN 'partially_paid' ELSE 'issued' END;
  UPDATE invoicing.documents SET amount_paid_minor=paid,status=next_status,updated_at=now()
    WHERE id=p.document_id AND user_id=p_user_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION invoicing.delete_payment(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION invoicing.delete_payment(uuid,uuid) TO service_role;
