-- 035_check_ins_rename_q3_lifestyle.sql
-- Rename q3_adherence → q3_lifestyle as the question pivoted from
-- "How well did you stick to your program over the last 2 weeks?"
-- to "How well did you manage nutrition and sleep in the last 7 days?"
-- when the form moved to a weekly cadence.
--
-- No data loss — pure ALTER COLUMN RENAME. Existing rows (if any)
-- keep their values; the column just has a more honest name.

BEGIN;

ALTER TABLE public.client_check_ins
  RENAME COLUMN q3_adherence TO q3_lifestyle;

COMMENT ON COLUMN public.client_check_ins.q3_lifestyle IS
  'Q3 response (1-10): "How well did you manage nutrition and sleep in the last 7 days?" Renamed from q3_adherence when the form pivoted from program-adherence to nutrition+sleep.';

COMMIT;
