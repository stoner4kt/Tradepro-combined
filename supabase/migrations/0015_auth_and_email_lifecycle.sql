-- 0015_auth_and_email_lifecycle.sql
CREATE OR REPLACE FUNCTION public.increment_token_version(p_user_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
DECLARE v integer;
BEGIN
 UPDATE public.profiles SET token_version=coalesce(token_version,0)+1 WHERE id=p_user_id RETURNING token_version INTO v;
 IF v IS NULL THEN RAISE EXCEPTION 'profile not found'; END IF;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.increment_token_version(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.increment_token_version(uuid) TO service_role;

CREATE TABLE IF NOT EXISTS public.email_opt_out_tokens(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 email text NOT NULL,
 token_hash text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL,
 used_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_opt_out_tokens_expiry_idx ON public.email_opt_out_tokens(expires_at);
ALTER TABLE public.email_opt_out_tokens ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_opt_out_tokens FROM PUBLIC,anon,authenticated;
GRANT ALL ON public.email_opt_out_tokens TO service_role;

CREATE UNIQUE INDEX IF NOT EXISTS review_requests_resend_message_id_unique
 ON reviewflow.review_requests(resend_message_id) WHERE resend_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.cleanup_security_rows()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $$
BEGIN
 DELETE FROM public.rate_limits WHERE updated_at<now()-interval '1 day';
 DELETE FROM public.auth_tokens WHERE expires_at<now()-interval '2 days' OR used_at<now()-interval '2 days';
 DELETE FROM public.email_opt_out_tokens WHERE expires_at<now()-interval '2 days' OR used_at<now()-interval '2 days';
END $$;
REVOKE ALL ON FUNCTION public.cleanup_security_rows() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cleanup_security_rows() TO service_role;
