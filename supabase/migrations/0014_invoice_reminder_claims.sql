-- 0014_invoice_reminder_claims.sql
CREATE TABLE IF NOT EXISTS invoicing.reminder_claims(
  document_id uuid NOT NULL REFERENCES invoicing.documents(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  due_date date NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  PRIMARY KEY(document_id,due_date)
);
ALTER TABLE invoicing.reminder_claims ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON invoicing.reminder_claims FROM PUBLIC,anon,authenticated;
GRANT ALL ON invoicing.reminder_claims TO service_role;

CREATE OR REPLACE FUNCTION invoicing.claim_due_invoice_reminders(p_grace_days integer DEFAULT 7,p_limit integer DEFAULT 100)
RETURNS SETOF invoicing.documents
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,invoicing
AS $$
BEGIN
 RETURN QUERY
 WITH due AS (
  SELECT d.id,d.user_id,d.due_date
  FROM invoicing.documents d
  WHERE d.kind='invoice' AND d.status IN ('issued','partially_paid','overdue')
    AND d.due_date<current_date
    AND (d.sent_at IS NULL OR d.sent_at<now()-make_interval(days=>greatest(1,p_grace_days)))
  ORDER BY d.due_date,d.created_at
  FOR UPDATE SKIP LOCKED
  LIMIT greatest(1,least(coalesce(p_limit,100),500))
 ), claims AS (
  INSERT INTO invoicing.reminder_claims(document_id,user_id,due_date,claimed_at)
  SELECT id,user_id,due_date,now() FROM due
  ON CONFLICT(document_id,due_date) DO UPDATE
   SET claimed_at=now()
   WHERE invoicing.reminder_claims.sent_at IS NULL
     AND invoicing.reminder_claims.claimed_at<now()-interval '15 minutes'
  RETURNING document_id
 )
 SELECT d.* FROM invoicing.documents d JOIN claims c ON c.document_id=d.id;
END $$;
REVOKE ALL ON FUNCTION invoicing.claim_due_invoice_reminders(integer,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION invoicing.claim_due_invoice_reminders(integer,integer) TO service_role;
