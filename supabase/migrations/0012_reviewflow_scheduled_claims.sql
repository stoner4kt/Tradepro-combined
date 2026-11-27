-- 0012_reviewflow_scheduled_claims.sql
ALTER TABLE reviewflow.leads ADD COLUMN IF NOT EXISTS review_sent_at timestamptz;
ALTER TABLE reviewflow.leads ADD COLUMN IF NOT EXISTS review_send_claimed_at timestamptz;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS daily_email_cap integer NOT NULL DEFAULT 50;
CREATE INDEX IF NOT EXISTS reviewflow_due_send_idx
  ON reviewflow.leads(review_send_after)
  WHERE status='complete' AND review_sent_at IS NULL;

CREATE OR REPLACE FUNCTION reviewflow.claim_due_review_emails(p_limit integer DEFAULT 20)
RETURNS SETOF reviewflow.leads
LANGUAGE sql SECURITY DEFINER
SET search_path = pg_catalog, public, reviewflow
AS $$
  WITH due AS (
    SELECT id FROM reviewflow.leads
    WHERE status='complete' AND review_send_after IS NOT NULL
      AND review_send_after <= now() AND review_sent_at IS NULL
      AND (review_send_claimed_at IS NULL OR review_send_claimed_at < now()-interval '15 minutes')
    ORDER BY review_send_after
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1,least(coalesce(p_limit,20),100))
  )
  UPDATE reviewflow.leads l SET review_send_claimed_at=now(),updated_at=now()
  FROM due WHERE l.id=due.id
  RETURNING l.*;
$$;
REVOKE ALL ON FUNCTION reviewflow.claim_due_review_emails(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION reviewflow.claim_due_review_emails(integer) TO service_role;
