-- 0011_rpc_hardening.sql
-- Close unsafe SECURITY DEFINER RPCs identified in the source audit.
CREATE OR REPLACE FUNCTION public.convert_lead_to_client(p_user_id uuid,p_lead_id uuid)
RETURNS TABLE(client_id uuid,project_id uuid)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE v_lead public.leads%ROWTYPE; v_client_id uuid; v_project_id uuid;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id=p_lead_id AND user_id=p_user_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'lead not found'; END IF;
  INSERT INTO public.clients(user_id,first_name,last_name,email,phone)
  VALUES(v_lead.user_id,v_lead.first_name,v_lead.last_name,v_lead.email,v_lead.phone)
  ON CONFLICT DO NOTHING;
  IF nullif(trim(v_lead.email),'') IS NOT NULL THEN
    SELECT id INTO v_client_id FROM public.clients
      WHERE user_id=p_user_id AND lower(email)=lower(v_lead.email)
      ORDER BY created_at ASC LIMIT 1;
  END IF;
  IF v_client_id IS NULL THEN
    INSERT INTO public.clients(user_id,first_name,last_name,email,phone)
    VALUES(v_lead.user_id,v_lead.first_name,v_lead.last_name,v_lead.email,v_lead.phone)
    RETURNING id INTO v_client_id;
  END IF;
  SELECT id INTO v_project_id FROM public.projects
    WHERE user_id=p_user_id AND lead_id=p_lead_id LIMIT 1;
  IF v_project_id IS NULL THEN
    INSERT INTO public.projects(user_id,client_id,lead_id,title,status,est_value,scope)
    VALUES(p_user_id,v_client_id,p_lead_id,
      coalesce(nullif(v_lead.first_name||' '||v_lead.last_name,' '),v_lead.email)||' — '||v_lead.service||' job',
      'new',v_lead.estimated_value,v_lead.message)
    RETURNING id INTO v_project_id;
  END IF;
  RETURN QUERY SELECT v_client_id,v_project_id;
END $$;
REVOKE ALL ON FUNCTION public.convert_lead_to_client(uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.convert_lead_to_client(uuid,uuid) TO service_role;
REVOKE ALL ON FUNCTION public.convert_lead_to_client(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION invoicing.mint_document_number(p_user_id uuid,p_kind text)
RETURNS TABLE(id uuid,number text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public, invoicing
AS $$
DECLARE v_settings_id uuid; v_counter bigint; v_prefix text; v_doc_id uuid;
BEGIN
  IF p_kind NOT IN ('quote','invoice') THEN RAISE EXCEPTION 'invalid document kind'; END IF;
  IF NOT EXISTS(SELECT 1 FROM auth.users WHERE auth.users.id=p_user_id) THEN RAISE EXCEPTION 'user not found'; END IF;
  SELECT id INTO v_settings_id FROM invoicing.settings WHERE user_id=p_user_id FOR UPDATE;
  IF v_settings_id IS NULL THEN
    INSERT INTO invoicing.settings(user_id) VALUES(p_user_id) ON CONFLICT(user_id) DO NOTHING;
    SELECT id INTO v_settings_id FROM invoicing.settings WHERE user_id=p_user_id FOR UPDATE;
  END IF;
  SELECT CASE WHEN p_kind='quote' THEN coalesce(next_quote_number,1) ELSE coalesce(next_invoice_number,1) END,
         CASE WHEN p_kind='quote' THEN coalesce(nullif(quote_prefix,''),'QT-') ELSE coalesce(nullif(invoice_prefix,''),'INV-') END
    INTO v_counter,v_prefix FROM invoicing.settings WHERE id=v_settings_id;
  INSERT INTO invoicing.documents(user_id,kind,number,status) VALUES(p_user_id,p_kind,v_prefix||v_counter::text,'draft') RETURNING id INTO v_doc_id;
  IF p_kind='quote' THEN UPDATE invoicing.settings SET next_quote_number=v_counter+1 WHERE id=v_settings_id;
  ELSE UPDATE invoicing.settings SET next_invoice_number=v_counter+1 WHERE id=v_settings_id; END IF;
  RETURN QUERY SELECT v_doc_id,v_prefix||v_counter::text;
END $$;
REVOKE ALL ON FUNCTION invoicing.mint_document_number(uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION invoicing.mint_document_number(uuid,text) TO service_role;

REVOKE ALL ON FUNCTION public.get_dashboard_stats(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.get_dashboard_stats(uuid) TO service_role;
DROP FUNCTION IF EXISTS reviewflow.rotate_widget_api_key();
