-- 026_lucy_hubbard_client_keys.sql
-- Allow Lucy Hubbard in Mozi finance tables.

ALTER TABLE mozi_stripe_charges
  DROP CONSTRAINT IF EXISTS mozi_stripe_charges_influencer_check;

ALTER TABLE mozi_stripe_charges
  ADD CONSTRAINT mozi_stripe_charges_influencer_check
  CHECK (influencer IN ('keith', 'tyson', 'lucy')) NOT VALID;

ALTER TABLE mozi_stripe_products
  DROP CONSTRAINT IF EXISTS mozi_stripe_products_influencer_check;

ALTER TABLE mozi_stripe_products
  ADD CONSTRAINT mozi_stripe_products_influencer_check
  CHECK (influencer IN ('keith', 'tyson', 'lucy')) NOT VALID;
