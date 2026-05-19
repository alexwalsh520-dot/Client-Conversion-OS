-- 033_testimonial_leads.sql
-- Lead capture from the public /testimonials page. The /testimonials
-- page is the only public-facing CCOS surface that accepts user input.
-- Admins view + manage submissions at /testimonials/leads.

BEGIN;

CREATE TABLE IF NOT EXISTS public.testimonial_leads (
  id BIGSERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  -- Optional message field on the public form. Helps pre-qualify leads.
  message TEXT,
  -- Lifecycle: new -> contacted -> dismissed. No further states for MVP.
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'contacted', 'dismissed')),
  -- Captured for rate limiting + abuse forensics. Not shown in admin UI by default.
  ip_address TEXT,
  user_agent TEXT,
  -- When admin marked it contacted/dismissed, for ordering + audit
  status_changed_at TIMESTAMPTZ,
  status_changed_by TEXT,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_testimonial_leads_submitted_at
  ON public.testimonial_leads (submitted_at DESC);

CREATE INDEX IF NOT EXISTS idx_testimonial_leads_status
  ON public.testimonial_leads (status, submitted_at DESC);

-- For rate-limiting lookups: count submissions per IP in a recent window
CREATE INDEX IF NOT EXISTS idx_testimonial_leads_ip_recent
  ON public.testimonial_leads (ip_address, submitted_at DESC);

COMMENT ON TABLE public.testimonial_leads IS
  'Public-facing form submissions from /testimonials. The only CCOS table written to by unauthenticated requests.';

COMMENT ON COLUMN public.testimonial_leads.ip_address IS
  'Captured for rate-limiting (max 3 submissions per IP per hour) and abuse tracking. Not shown to admins by default.';

-- Row Level Security: anon reads NOT permitted (lead data is sensitive).
-- All access flows through service-role-using API routes that enforce
-- admin auth for read/update/delete.
ALTER TABLE public.testimonial_leads ENABLE ROW LEVEL SECURITY;
-- No SELECT policy = no anon access. Service role bypasses RLS.

COMMIT;
