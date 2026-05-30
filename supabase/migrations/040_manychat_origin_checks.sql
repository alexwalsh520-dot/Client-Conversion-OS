-- 040_manychat_origin_checks.sql
-- Ground-truth check for "did this buyer actually come from an ad?"
--
-- When a sale has a ManyChat link pasted but no ad-click event on record, we
-- can't tell from our own data whether the buyer came organically or clicked
-- an ad whose flow failed to report back. ManyChat itself knows: every
-- subscriber profile carries the ad keyword (a custom field / tag) stamped at
-- entry. This table stores the read-only result of asking ManyChat directly,
-- so a sale can be confidently classified as ad-driven (and credited) vs.
-- organic. Raw payload is retained so the classification can be audited.

CREATE TABLE IF NOT EXISTS manychat_origin_checks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_key text NOT NULL,
  subscriber_id text NOT NULL,
  prospect_name text,
  sale_date date,
  is_control boolean NOT NULL DEFAULT false,
  from_ad boolean,
  origin_keyword text,
  tags jsonb,
  custom_fields jsonb,
  raw jsonb,
  api_status integer,
  error text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_key, subscriber_id)
);

CREATE INDEX IF NOT EXISTS idx_manychat_origin_checks_sub
  ON manychat_origin_checks (subscriber_id);

ALTER TABLE manychat_origin_checks ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manychat_origin_checks'
      AND policyname = 'Allow service role manage manychat origin checks'
  ) THEN
    CREATE POLICY "Allow service role manage manychat origin checks"
      ON manychat_origin_checks USING (true) WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'manychat_origin_checks'
      AND policyname = 'Allow anon read manychat origin checks'
  ) THEN
    CREATE POLICY "Allow anon read manychat origin checks"
      ON manychat_origin_checks FOR SELECT USING (true);
  END IF;
END $$;
