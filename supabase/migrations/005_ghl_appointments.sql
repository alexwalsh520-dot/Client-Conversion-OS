-- GHL Appointments table
-- Stores appointment events received from GoHighLevel workflow webhooks.

CREATE TABLE IF NOT EXISTS ghl_appointments (
  id            BIGSERIAL PRIMARY KEY,
  appointment_id TEXT NOT NULL UNIQUE,
  calendar_id   TEXT,
  calendar_name TEXT,
  contact_id    TEXT,
  contact_name  TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  start_time    TIMESTAMPTZ,
  end_time      TIMESTAMPTZ,
  assigned_user_id TEXT,
  closer_name   TEXT,           -- WILL, BROZ, AUSTIN (derived from assigned_user_id)
  status        TEXT,
  event_type    TEXT,           -- booked, rescheduled, cancelled, noshow, confirmed
  client        TEXT,           -- tyson or keith (derived from calendar_name)
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

-- Index for querying by date range
CREATE INDEX IF NOT EXISTS idx_ghl_appointments_start_time ON ghl_appointments (start_time);

-- Index for filtering by closer
CREATE INDEX IF NOT EXISTS idx_ghl_appointments_closer ON ghl_appointments (closer_name);

-- Index for filtering by client
CREATE INDEX IF NOT EXISTS idx_ghl_appointments_client ON ghl_appointments (client);

-- Composite index for the common query pattern: date + closer
CREATE INDEX IF NOT EXISTS idx_ghl_appointments_start_closer ON ghl_appointments (start_time, closer_name);
