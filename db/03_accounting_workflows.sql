-- Additive migration. Apply as erp_owner after the base schema. Never rebuild a live DB.
BEGIN;
CREATE TABLE IF NOT EXISTS accounting_document_versions (
  tenant_id UUID NOT NULL REFERENCES tenants(id), document_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('JOURNAL','VOUCHER')),
  revision INT NOT NULL CHECK (revision > 0), payload_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, document_id)
);
ALTER TABLE accounting_document_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounting_document_versions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS accounting_versions_tenant ON accounting_document_versions;
CREATE POLICY accounting_versions_tenant ON accounting_document_versions
  USING (tenant_id = fn_current_tenant()) WITH CHECK (tenant_id = fn_current_tenant());
GRANT SELECT ON accounting_document_versions TO erp_app;

CREATE OR REPLACE FUNCTION fn_accounting_operator(p_tenant UUID, p_user UUID, p_action TEXT) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_branch UUID;
BEGIN
  PERFORM fn_assert_tenant(p_tenant);
  SELECT u.branch_id INTO v_branch FROM users u JOIN roles r ON r.tenant_id=u.tenant_id AND r.id=u.role_id
    JOIN branches b ON b.tenant_id=u.tenant_id AND b.id=u.branch_id
    WHERE u.tenant_id=p_tenant AND u.id=p_user AND u.is_active AND b.is_active
      AND r.permissions_json->'manageAccounting' = 'true'::jsonb
      AND (p_action <> 'POST' OR r.can_post) AND (p_action <> 'REVERSE' OR r.can_reverse);
  IF v_branch IS NULL THEN RAISE EXCEPTION 'PERMISSION_DENIED: accounting operator required'; END IF;
  RETURN v_branch;
END $$;

CREATE OR REPLACE FUNCTION fn_accounting_line(p_tenant UUID,p_account UUID,p_party UUID,p_center UUID,p_manual BOOLEAN) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_account accounts%ROWTYPE;
BEGIN
  PERFORM fn_assert_tenant(p_tenant);
  SELECT * INTO v_account FROM accounts WHERE tenant_id=p_tenant AND id=p_account FOR SHARE;
  IF NOT FOUND OR NOT v_account.is_active OR NOT v_account.is_analytical THEN
    RAISE EXCEPTION 'ACCOUNT_RULE: active analytical account required';
  END IF;
  IF p_party IS NOT NULL THEN
    PERFORM 1 FROM parties WHERE tenant_id=p_tenant AND id=p_party AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_RULE: active tenant party required'; END IF;
  END IF;
  IF p_center IS NOT NULL THEN
    PERFORM 1 FROM cost_centers WHERE tenant_id=p_tenant AND id=p_center AND is_active FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'ACCOUNT_RULE: active tenant cost center required'; END IF;
  END IF;
  -- Do not create a GL/stock divergence or bypass drawer reconciliation through manual GL.
  IF EXISTS(SELECT 1 FROM warehouses WHERE tenant_id=p_tenant AND inventory_account_id=p_account)
     OR EXISTS(SELECT 1 FROM tenant_accounting_settings WHERE tenant_id=p_tenant AND default_inventory_account_id=p_account) THEN
    RAISE EXCEPTION 'ACCOUNT_RULE: inventory accounts require inventory documents';
  END IF;
  IF p_manual AND (EXISTS(SELECT 1 FROM pos_shifts WHERE tenant_id=p_tenant AND cash_account_id=p_account)
     OR EXISTS(SELECT 1 FROM tenant_accounting_settings WHERE tenant_id=p_tenant AND default_cash_account_id=p_account)) THEN
    RAISE EXCEPTION 'ACCOUNT_RULE: drawer movements require shift vouchers';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION save_accounting_draft(p_tenant UUID,p_id UUID,p_kind TEXT,p_payload JSONB,p_user UUID,p_expected INT DEFAULT NULL,p_device VARCHAR DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_branch UUID; v_fy UUID; v_currency UUID; v_date DATE; v_hash TEXT;
  v_old accounting_document_versions%ROWTYPE; v_status doc_status_enum; v_line RECORD; v_amount NUMERIC; v_shift UUID;
BEGIN
  v_branch := fn_accounting_operator(p_tenant,p_user,'SAVE');
  IF p_kind NOT IN ('JOURNAL','VOUCHER') OR p_id IS NULL THEN RAISE EXCEPTION 'ACCOUNT_RULE: invalid document'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_id::text,0));
  v_hash := encode(digest(p_payload::text,'sha256'),'hex');
  SELECT * INTO v_old FROM accounting_document_versions WHERE tenant_id=p_tenant AND document_id=p_id FOR UPDATE;
  IF FOUND THEN
    IF v_old.kind <> p_kind THEN RAISE EXCEPTION 'DRAFT_CONFLICT: document kind differs'; END IF;
    IF p_kind='JOURNAL' THEN
      SELECT status INTO v_status FROM journal_entries WHERE tenant_id=p_tenant AND id=p_id AND branch_id=v_branch AND source_type='MANUAL' FOR UPDATE;
    ELSE
      SELECT status INTO v_status FROM vouchers WHERE tenant_id=p_tenant AND id=p_id AND branch_id=v_branch FOR UPDATE;
    END IF;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: document'; END IF;
    IF v_old.payload_hash=v_hash THEN RETURN p_id; END IF; -- harmless retry, including after posting
    IF v_status <> 'DRAFT' THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: posted document is immutable'; END IF;
    IF p_expected IS NULL OR p_expected <> v_old.revision THEN RAISE EXCEPTION 'DRAFT_CONFLICT: reload the latest revision'; END IF;
  ELSIF p_expected IS NOT NULL THEN RAISE EXCEPTION 'NOT_FOUND: draft';
  END IF;
  v_date := (p_payload->>'date')::date;
  v_fy := fn_fiscal_year_for(p_tenant,v_date); v_currency := fn_base_currency(p_tenant);
  IF v_fy IS NULL OR v_currency IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: open fiscal year and base currency required'; END IF;
  IF p_kind='JOURNAL' THEN
    IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' OR jsonb_array_length(p_payload->'lines') NOT BETWEEN 1 AND 200 THEN
      RAISE EXCEPTION 'ACCOUNT_RULE: one to 200 draft lines required';
    END IF;
    IF v_old.document_id IS NULL THEN
      INSERT INTO journal_entries(id,tenant_id,branch_id,fiscal_year_id,entry_date,source_type,description,reference_no,created_by,device_info)
        VALUES(p_id,p_tenant,v_branch,v_fy,v_date,'MANUAL',p_payload->>'description',p_payload->>'reference_no',p_user,p_device);
    ELSE
      IF EXISTS(SELECT 1 FROM journal_entries WHERE tenant_id=p_tenant AND id=p_id AND fiscal_year_id<>v_fy) THEN RAISE EXCEPTION 'ACCOUNT_RULE: journal fiscal year is immutable'; END IF;
      DELETE FROM journal_lines WHERE tenant_id=p_tenant AND journal_entry_id=p_id;
      UPDATE journal_entries SET entry_date=v_date,fiscal_year_id=v_fy,description=p_payload->>'description',reference_no=p_payload->>'reference_no'
        WHERE tenant_id=p_tenant AND id=p_id;
    END IF;
    FOR v_line IN SELECT * FROM jsonb_to_recordset(p_payload->'lines') AS x(account_id UUID,party_id UUID,cost_center_id UUID,debit NUMERIC,credit NUMERIC) LOOP
      PERFORM fn_accounting_line(p_tenant,v_line.account_id,v_line.party_id,v_line.cost_center_id,TRUE);
      IF v_line.debit IS NULL OR v_line.credit IS NULL OR v_line.debit<>round(v_line.debit,4) OR v_line.credit<>round(v_line.credit,4) THEN
        RAISE EXCEPTION 'ACCOUNT_RULE: amounts must have at most four decimal places';
      END IF;
      INSERT INTO journal_lines(tenant_id,journal_entry_id,account_id,party_id,cost_center_id,currency_id,debit_original,debit_base,credit_original,credit_base)
        VALUES(p_tenant,p_id,v_line.account_id,v_line.party_id,v_line.cost_center_id,v_currency,v_line.debit,v_line.debit,v_line.credit,v_line.credit);
    END LOOP;
  ELSE
    v_amount := (p_payload->>'amount')::numeric; v_shift := (p_payload->>'shift_id')::uuid;
    IF v_amount IS NULL OR v_amount<=0 OR v_amount<>round(v_amount,4) THEN RAISE EXCEPTION 'ACCOUNT_RULE: positive exact amount required'; END IF;
    PERFORM fn_accounting_line(p_tenant,(p_payload->>'cash_account_id')::uuid,NULL,NULL,FALSE);
    PERFORM fn_accounting_line(p_tenant,(p_payload->>'counter_account_id')::uuid,(p_payload->>'party_id')::uuid,(p_payload->>'cost_center_id')::uuid,TRUE);
    IF NOT EXISTS(SELECT 1 FROM accounts a WHERE a.tenant_id=p_tenant AND a.id=(p_payload->>'cash_account_id')::uuid AND a.account_type='ASSET'
      AND NOT EXISTS(SELECT 1 FROM tenant_accounting_settings s WHERE s.tenant_id=p_tenant AND a.id IN(s.customers_control_account_id,s.suppliers_control_account_id))) THEN
      RAISE EXCEPTION 'ACCOUNT_RULE: cash or bank asset account required';
    END IF;
    IF (p_payload->>'cash_account_id')=(p_payload->>'counter_account_id') THEN RAISE EXCEPTION 'ACCOUNT_RULE: distinct accounts required'; END IF;
    IF v_shift IS NOT NULL THEN
      PERFORM 1 FROM pos_shifts WHERE tenant_id=p_tenant AND id=v_shift AND branch_id=v_branch AND status='OPEN'
        AND cash_account_id=(p_payload->>'cash_account_id')::uuid FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'SHIFT_CLOSED: matching open branch shift required'; END IF;
    ELSIF p_payload->>'voucher_type'='PETTY_CASH' OR EXISTS(SELECT 1 FROM pos_shifts WHERE tenant_id=p_tenant AND cash_account_id=(p_payload->>'cash_account_id')::uuid)
      OR EXISTS(SELECT 1 FROM tenant_accounting_settings WHERE tenant_id=p_tenant AND default_cash_account_id=(p_payload->>'cash_account_id')::uuid) THEN
      RAISE EXCEPTION 'ACCOUNT_RULE: a drawer voucher requires a matching shift';
    END IF;
    IF v_old.document_id IS NULL THEN
      INSERT INTO vouchers(id,tenant_id,branch_id,fiscal_year_id,voucher_type,voucher_no,voucher_date,reference_no,cash_account_id,counter_account_id,party_id,cost_center_id,shift_id,currency_id,amount_original,amount_base,description,created_by,device_info)
        VALUES(p_id,p_tenant,v_branch,v_fy,(p_payload->>'voucher_type')::voucher_type_enum,fn_next_no(p_tenant,v_fy,'VOUCHER_'||(p_payload->>'voucher_type')),v_date,p_payload->>'reference_no',
          (p_payload->>'cash_account_id')::uuid,(p_payload->>'counter_account_id')::uuid,(p_payload->>'party_id')::uuid,(p_payload->>'cost_center_id')::uuid,v_shift,v_currency,v_amount,v_amount,p_payload->>'description',p_user,p_device);
    ELSE
      -- Preserve document type/year/number: changing date to another year needs a new draft.
      IF EXISTS(SELECT 1 FROM vouchers WHERE tenant_id=p_tenant AND id=p_id AND (fiscal_year_id<>v_fy OR voucher_type::text<>p_payload->>'voucher_type')) THEN
        RAISE EXCEPTION 'ACCOUNT_RULE: voucher type and fiscal year are immutable';
      END IF;
      UPDATE vouchers SET voucher_date=v_date,reference_no=p_payload->>'reference_no',cash_account_id=(p_payload->>'cash_account_id')::uuid,counter_account_id=(p_payload->>'counter_account_id')::uuid,
        party_id=(p_payload->>'party_id')::uuid,cost_center_id=(p_payload->>'cost_center_id')::uuid,shift_id=v_shift,amount_original=v_amount,amount_base=v_amount,description=p_payload->>'description'
        WHERE tenant_id=p_tenant AND id=p_id;
    END IF;
  END IF;
  INSERT INTO accounting_document_versions VALUES(p_tenant,p_id,p_kind,1,v_hash)
    ON CONFLICT(tenant_id,document_id) DO UPDATE SET revision=accounting_document_versions.revision+1,payload_hash=EXCLUDED.payload_hash;
  INSERT INTO audit_logs(tenant_id,user_id,action,table_name,record_id,device_info,new_json)
    VALUES(p_tenant,p_user,'SAVE_DRAFT',CASE WHEN p_kind='JOURNAL' THEN 'journal_entries' ELSE 'vouchers' END,p_id,p_device,p_payload);
  RETURN p_id;
END $$;

CREATE OR REPLACE FUNCTION post_accounting_document(p_tenant UUID,p_id UUID,p_kind TEXT,p_user UUID,p_revision INT,p_device VARCHAR DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_branch UUID; v_result UUID; v_line RECORD; v_voucher vouchers%ROWTYPE; v_revision INT;
BEGIN
  v_branch:=fn_accounting_operator(p_tenant,p_user,'POST');
  PERFORM pg_advisory_xact_lock(hashtextextended(p_tenant::text||p_id::text,0));
  SELECT revision INTO v_revision FROM accounting_document_versions WHERE tenant_id=p_tenant AND document_id=p_id AND kind=p_kind FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: document'; END IF;
  IF p_revision IS DISTINCT FROM v_revision THEN RAISE EXCEPTION 'DRAFT_CONFLICT: reload before posting'; END IF;
  IF p_kind='JOURNAL' THEN
    PERFORM 1 FROM journal_entries WHERE tenant_id=p_tenant AND id=p_id AND branch_id=v_branch AND source_type='MANUAL' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: journal'; END IF;
    FOR v_line IN SELECT * FROM journal_lines WHERE tenant_id=p_tenant AND journal_entry_id=p_id LOOP
      PERFORM fn_accounting_line(p_tenant,v_line.account_id,v_line.party_id,v_line.cost_center_id,TRUE);
    END LOOP;
    PERFORM post_journal_entry(p_tenant,p_id,p_user,p_device); RETURN p_id;
  ELSIF p_kind='VOUCHER' THEN
    SELECT * INTO v_voucher FROM vouchers WHERE tenant_id=p_tenant AND id=p_id AND branch_id=v_branch FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: voucher'; END IF;
    PERFORM fn_accounting_line(p_tenant,v_voucher.cash_account_id,NULL,NULL,FALSE);
    PERFORM fn_accounting_line(p_tenant,v_voucher.counter_account_id,v_voucher.party_id,v_voucher.cost_center_id,TRUE);
    v_result:=post_voucher(p_tenant,p_id,p_user,p_device); RETURN v_result;
  END IF;
  RAISE EXCEPTION 'ACCOUNT_RULE: invalid kind';
END $$;

CREATE OR REPLACE FUNCTION reverse_manual_journal(p_tenant UUID,p_id UUID,p_user UUID,p_reason TEXT,p_date DATE,p_device VARCHAR DEFAULT NULL)
RETURNS UUID LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_branch UUID; v_original journal_entries%ROWTYPE; v_existing journal_entries%ROWTYPE; v_id UUID; v_fy UUID;
BEGIN
  v_branch:=fn_accounting_operator(p_tenant,p_user,'REVERSE');
  IF p_reason IS NULL OR length(btrim(p_reason))=0 THEN RAISE EXCEPTION 'REVERSAL_INVALID: reason required'; END IF;
  SELECT * INTO v_original FROM journal_entries WHERE tenant_id=p_tenant AND id=p_id AND branch_id=v_branch AND source_type='MANUAL' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'NOT_FOUND: manual journal'; END IF;
  IF v_original.status<>'POSTED' OR p_date<v_original.entry_date THEN RAISE EXCEPTION 'REVERSAL_INVALID: posted journal and current reversal date required'; END IF;
  SELECT * INTO v_existing FROM journal_entries WHERE tenant_id=p_tenant AND reverses_entry_id=p_id;
  IF FOUND THEN
    IF v_existing.entry_date=p_date AND v_existing.description=p_reason THEN RETURN v_existing.id; END IF;
    RAISE EXCEPTION 'REVERSAL_INVALID: already reversed';
  END IF;
  v_fy:=fn_fiscal_year_for(p_tenant,p_date);
  IF v_fy IS NULL THEN RAISE EXCEPTION 'ACCOUNTING_VIOLATION: open reversal fiscal year required'; END IF;
  INSERT INTO journal_entries(tenant_id,branch_id,fiscal_year_id,entry_date,source_type,source_id,description,reverses_entry_id,created_by,device_info)
    VALUES(p_tenant,v_branch,v_fy,p_date,'MANUAL_REVERSAL',p_id,p_reason,p_id,p_user,p_device) RETURNING id INTO v_id;
  INSERT INTO journal_lines(tenant_id,journal_entry_id,account_id,cost_center_id,party_id,currency_id,exchange_rate,debit_original,credit_original,debit_base,credit_base,line_description)
    SELECT tenant_id,v_id,account_id,cost_center_id,party_id,currency_id,exchange_rate,credit_original,debit_original,credit_base,debit_base,line_description
    FROM journal_lines WHERE tenant_id=p_tenant AND journal_entry_id=p_id;
  -- Reversal authority does not imply posting authority. The guarded transition checks mirror/balance/period.
  UPDATE journal_entries SET status='POSTED',posted_at=now(),posted_by=p_user WHERE tenant_id=p_tenant AND id=v_id;
  INSERT INTO audit_logs(tenant_id,user_id,action,table_name,record_id,device_info,new_json)
    VALUES(p_tenant,p_user,'REVERSE','journal_entries',p_id,p_device,jsonb_build_object('reversal_journal_entry_id',v_id,'reason',p_reason));
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION fn_accounting_operator(UUID,UUID,TEXT),fn_accounting_line(UUID,UUID,UUID,UUID,BOOLEAN),save_accounting_draft(UUID,UUID,TEXT,JSONB,UUID,INT,VARCHAR),post_accounting_document(UUID,UUID,TEXT,UUID,INT,VARCHAR),reverse_manual_journal(UUID,UUID,UUID,TEXT,DATE,VARCHAR) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION save_accounting_draft(UUID,UUID,TEXT,JSONB,UUID,INT,VARCHAR),post_accounting_document(UUID,UUID,TEXT,UUID,INT,VARCHAR),reverse_manual_journal(UUID,UUID,UUID,TEXT,DATE,VARCHAR) TO erp_app;
COMMIT;
