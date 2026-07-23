-- ─────────────────────────────────────────────────────────────────────────
-- P0.3 — statement timeouts on EVERY query. The app talks to Postgres through
-- PostgREST as service_role, which had NO statement_timeout, so an app query
-- could run unbounded (a contributor to the 7/23 timeout storm). The other
-- API roles already had timeouts (anon 3s, authenticated 8s, authenticator 8s).
-- This bounds service_role too. Background jobs need a little more headroom than
-- the interactive 8s, hence 20s; the v2 serving path is a single 3ms index read
-- well under it. lock_timeout and idle-in-transaction caps prevent zombie
-- "idle in transaction" backends from pinning connections.
-- ─────────────────────────────────────────────────────────────────────────

alter role service_role set statement_timeout = '20s';
alter role service_role set lock_timeout = '10s';
alter role service_role set idle_in_transaction_session_timeout = '15s';
