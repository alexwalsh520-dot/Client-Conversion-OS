-- 027_daily_coacher_tips_nutrition.sql
-- Seed approved tips for the Daily Coacher Nutrition topic.
-- Phase 6, first topic of 14. User reviewed and approved on 2026-05-12.
--
-- Each tip is one piece of guidance the topic-generator weaves into a draft
-- message. applies_to_tags narrows which tips are eligible for a given client
-- based on intake-derived signals (see src/lib/daily-coacher/topics/nutrition.ts
-- → deriveClientTags). Tips with empty applies_to_tags apply to every client.
--
-- Hard rule baked into every tip: NO specific macros, calorie counts, or
-- weight measurements. Verified before seeding.
-- Hard rule baked into every tip: NO em-dashes (U+2014) or en-dashes (U+2013).
-- Verified before seeding (and post-processing strips any that slip through
-- in Claude output anyway).

BEGIN;

INSERT INTO public.tips_library (topic, tip_text, applies_to_tags, weight, approved)
VALUES
  -- Universal tips (apply to all clients)
  (
    'nutrition',
    'Sustainable progress comes from doing the small things consistently, not from doing perfect things sometimes. A "good enough" meal you actually eat beats a perfect meal you skip.',
    '[]'::jsonb, 2, TRUE
  ),
  (
    'nutrition',
    'Building each meal around a protein source first, then adding produce and carbs around it, makes adherence easier without thinking in numbers.',
    '[]'::jsonb, 2, TRUE
  ),
  (
    'nutrition',
    'Filling half the plate with vegetables of any color is the simplest hack for satiety, micronutrients, and volume, without adding much to the calorie load.',
    '[]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'Hydration affects hunger, energy, and recovery more than people realize. A glass of water before each meal and one when waking up is a low-effort habit that compounds.',
    '[]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'The best diet is the one you can imagine still doing in six months. If a strategy feels like punishment, it won''t last, so find one that fits your actual life.',
    '[]'::jsonb, 2, TRUE
  ),
  (
    'nutrition',
    'If weekdays are dialed in but weekends unravel, the issue usually isn''t the food. It''s the lack of a loose plan for those days. Even a "two intentional meals + one freer meal" template stops the spiral.',
    '[]'::jsonb, 2, TRUE
  ),

  -- Tagged to client context
  (
    'nutrition',
    'Eating out often doesn''t have to derail goals. Protein-forward orders, asking for sauces on the side, and skipping the bread basket usually do most of the work.',
    '["eats_out_often"]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'Meal services solve the "what do I cook" problem but can vary in protein density. Adding an extra protein source (eggs, jerky, cottage cheese) to lighter meals keeps things on track.',
    '["uses_meal_service"]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'Snacking isn''t the enemy. Mindless snacking is. Pre-portioning snacks and pairing them with protein turns a craving moment into a small, intentional meal.',
    '["snacker"]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'If cooking isn''t your thing, lean on rotisserie chicken, pre-cooked grains, bagged salads, and Greek yogurt as repeatable building blocks. The goal is reliable execution, not Instagram-worthy meals.',
    '["limited_cooking"]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'The scale moves around for dozens of reasons (sodium, sleep, stress, time of month, even how much fiber you ate yesterday). Watch the weekly average and stop holding daily numbers like a verdict.',
    '["fat_loss"]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'When the goal is fat loss, protein is what protects muscle and keeps you full. Aim to anchor every meal with a strong protein source, even snacks.',
    '["fat_loss"]'::jsonb, 2, TRUE
  ),
  (
    'nutrition',
    'Muscle won''t show up if the body''s running on empty. Eating in a slight surplus, especially around training, gives your body a reason to build.',
    '["muscle_gain"]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'Plant-based eating works for body composition, but it requires more intention with protein. Tofu, tempeh, lentils, edamame, seitan, and Greek-style soy yogurt are your workhorses.',
    '["plant_based"]'::jsonb, 1, TRUE
  ),
  (
    'nutrition',
    'When sleep is short, hunger and cravings spike. That''s biology, not weakness. Front-loading more food earlier in the day usually helps when nights are restless.',
    '["low_sleep"]'::jsonb, 1, TRUE
  );

COMMIT;
