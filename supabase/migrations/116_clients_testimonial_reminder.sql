-- 116_clients_testimonial_reminder.sql
-- Idempotency stamp for the Trustpilot testimonial-reminder Slack DM.
--
-- Every day the /api/cron/testimonial-reminders cron scans for active
-- clients past the 21-day mark whose coach hasn't been pinged yet, and
-- DMs the coach the client's name + the Trustpilot review link. Once
-- the DM lands successfully, this column is stamped so the reminder
-- never fires again for that client — MAS wanted a one-time nudge, not
-- an ongoing drip.
--
-- NULL means the reminder hasn't fired yet.
-- Non-NULL means it went out on that timestamp.

BEGIN;

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS testimonial_reminder_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN public.clients.testimonial_reminder_sent_at IS
  'When we DM''d the coach to prompt collecting a Trustpilot testimonial for this client (fired ~3 weeks into the program). NULL = reminder not yet sent.';

COMMIT;
