-- 010_mozi_stripe_products.sql
-- Stripe product/price catalog + role classification for Mozi cohort math.
-- Each row = one Stripe price with a role saying how to treat it:
--   new_sale    → first purchase from a new client (counts toward new-client cohort)
--   renewal     → rebill / extension on existing client
--   upsell      → extra product sold to existing client (counted inside first-30-day GP if within cohort window)
--   downsell    → discounted alternate (counted like new_sale unless overridden)
--   ignore      → balance adjustments, test rows, tiny $6 items, DND/old
--
-- Pulled from live Stripe via scripts/mozi-sync-products.mjs.

CREATE TABLE IF NOT EXISTS mozi_stripe_products (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  influencer      text NOT NULL CHECK (influencer IN ('keith', 'tyson', 'zoeEmily')),
  stripe_account  text NOT NULL,
  price_id        text UNIQUE NOT NULL,
  product_id      text,
  product_name    text,
  unit_amount     int,                    -- cents, NULL if custom pricing
  currency        text DEFAULT 'usd',
  interval        text,                   -- one-time, day, week, month, year
  active          boolean DEFAULT true,
  role            text CHECK (role IN ('new_sale','renewal','upsell','downsell','ignore')),
  role_source     text DEFAULT 'draft',   -- 'draft' = auto-classified, 'manual' = user-confirmed
  notes           text,
  synced_at       timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mozi_stripe_products_influencer ON mozi_stripe_products (influencer);
CREATE INDEX IF NOT EXISTS idx_mozi_stripe_products_role       ON mozi_stripe_products (role);
