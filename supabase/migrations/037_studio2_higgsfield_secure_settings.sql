-- 037_studio2_higgsfield_secure_settings.sql
-- Server-only key/value storage for sensitive Studio 2.0 integration state.

BEGIN;

CREATE TABLE IF NOT EXISTS public.studio2_secure_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by TEXT
);

ALTER TABLE public.studio2_secure_settings ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'studio2_secure_settings'
      AND policyname = 'Allow service role manage Studio 2 secure settings'
  ) THEN
    CREATE POLICY "Allow service role manage Studio 2 secure settings"
      ON public.studio2_secure_settings
      FOR ALL
      USING (auth.role() = 'service_role')
      WITH CHECK (auth.role() = 'service_role');
  END IF;
END $$;

COMMENT ON TABLE public.studio2_secure_settings IS
  'Server-only Studio 2.0 integration settings. RLS blocks anon/client access; service role writes refreshed credentials.';

COMMIT;
