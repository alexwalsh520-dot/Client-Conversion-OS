-- 036_nutrition_onboarding_notes.sql
-- Per-client free-text notes from the onboarding specialist intended
-- for whoever generates that client's nutrition meal plan.
--
-- Background: onboarding specialists previously DM'd these notes in a
-- shared Slack channel (#nutritiontalk), which made them impossible to
-- track historically — by the time the plan author got to a client a
-- few days later, the note had scrolled off. Moving the notes into
-- CCOS attaches them to the client row, persists indefinitely, and
-- pipes them into the Claude.ai plan prompt automatically.
--
-- Lives in the Nutrition v2 panel between the intake form display
-- and the "Generate the plan in Claude.ai" macro editor. Edited
-- inline; cleared with the delete button.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS nutrition_onboarding_notes TEXT,
  ADD COLUMN IF NOT EXISTS nutrition_onboarding_notes_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS nutrition_onboarding_notes_updated_by TEXT;

COMMENT ON COLUMN public.clients.nutrition_onboarding_notes IS
  'Free-text notes from the onboarding specialist for the nutrition plan author. Surfaces in the nutrition v2 panel between intake form and macro editor, and is injected into the Claude.ai meal plan prompt. Set/edited at any time, not just at plan-generation.';

COMMENT ON COLUMN public.clients.nutrition_onboarding_notes_updated_by IS
  'Email of the user who last saved the onboarding notes. Surfaces in the UI so plan authors know who wrote the note.';

COMMIT;
