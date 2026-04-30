-- 024_nutrition_intake_forms_medical_supervision.sql
-- Two new questions on the intake form (Cognito → Google Sheet → CCOS):
--   col AA (index 26): "Are you currently working with a registered
--                        dietitian, nutritionist, or other healthcare
--                        provider on a prescribed diet plan or nutrition
--                        therapy for a medical condition?" → Yes/No
--   col AB (index 27): "(If yes) Briefly describe what you're being
--                        treated for and any specific dietary restrictions
--                        or guidelines you've been given." → free text
--
-- The fetcher's hardcoded column map (sheets.ts) had the old `diet_plan_sent`
-- pinned at index 26, so since the form change every sync was silently
-- overwriting `diet_plan_sent` with "Yes"/"No" answers from the dietitian
-- question, dropping the free-text follow-up entirely, and missing the
-- actual `Diet Plan Sent` column which shifted to index 29.
--
-- This migration adds the two new columns. The fetcher remap that follows
-- restores `diet_plan_sent` to its correct sheet column (29 / AD) and the
-- next sync overwrites the corrupted values with correct ones.

BEGIN;

ALTER TABLE public.nutrition_intake_forms
  ADD COLUMN IF NOT EXISTS medical_supervision_yn TEXT,
  ADD COLUMN IF NOT EXISTS medical_supervision_detail TEXT;

COMMENT ON COLUMN public.nutrition_intake_forms.medical_supervision_yn IS
  'Client''s Yes/No answer to: "Are you currently working with a registered dietitian, nutritionist, or other healthcare provider on a prescribed diet plan or nutrition therapy for a medical condition?" Source: Google Sheet column AA.';

COMMENT ON COLUMN public.nutrition_intake_forms.medical_supervision_detail IS
  'When medical_supervision_yn = "Yes", the client''s free-text description of what they''re being treated for and any dietary guidelines from their provider. Critical for coach safety review before generating a meal plan. Source: Google Sheet column AB.';

COMMIT;
