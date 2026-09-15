-- Sheet cells under a week column often read like "5/5 workouts" or
-- "0/7 workout" — real counts hidden in text. Adding columns so we can
-- store completed/assigned separately from the percentage and display
-- "5/5" instead of "100%".

ALTER TABLE public.everfit_v3_weekly_reports
  ADD COLUMN IF NOT EXISTS workouts_completed INTEGER,
  ADD COLUMN IF NOT EXISTS workouts_assigned  INTEGER;
