-- 009_mozi_lucy_hubbard_stripe.sql
-- Allow Lucy Hubbard Stripe data to sync into mozi tables

ALTER TABLE mozi_stripe_charges
  DROP CONSTRAINT IF EXISTS mozi_stripe_charges_influencer_check;

ALTER TABLE mozi_stripe_charges
  ADD CONSTRAINT mozi_stripe_charges_influencer_check
  CHECK (influencer IN ('keith', 'tyson', 'lucy'));
