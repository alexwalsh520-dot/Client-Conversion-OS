-- Super Doc lead Instagram fields
-- Stores CSV Instagram data so Slack activity alerts can include it.

ALTER TABLE super_doc_leads
  ADD COLUMN IF NOT EXISTS instagram_handle text,
  ADD COLUMN IF NOT EXISTS instagram_url text;

CREATE INDEX IF NOT EXISTS idx_super_doc_leads_instagram_handle
  ON super_doc_leads(instagram_handle);
