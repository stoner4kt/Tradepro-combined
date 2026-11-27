-- 0013_public_document_details.sql
ALTER TABLE invoicing.settings ADD COLUMN IF NOT EXISTS business_address text NOT NULL DEFAULT '';
ALTER TABLE invoicing.settings ADD COLUMN IF NOT EXISTS tax_number text NOT NULL DEFAULT '';
ALTER TABLE invoicing.documents ADD COLUMN IF NOT EXISTS expires_at timestamptz;
