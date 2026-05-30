-- 039_sales_tracker_rows_manychat.sql
-- Store the ManyChat chat link (and the stable subscriber id parsed from it)
-- on each mirrored sales row. Setters paste this link in the sales tracker; the
-- subscriber id is what lets us attribute a sale's revenue to the exact ad the
-- buyer came through, instead of a fragile name match.

ALTER TABLE sales_tracker_rows
  ADD COLUMN IF NOT EXISTS manychat_link text,
  ADD COLUMN IF NOT EXISTS manychat_subscriber_id text;

CREATE INDEX IF NOT EXISTS idx_sales_tracker_rows_manychat_subscriber
  ON sales_tracker_rows (manychat_subscriber_id);
