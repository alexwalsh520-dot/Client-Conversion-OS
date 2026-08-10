-- ─────────────────────────────────────────────────────────────────────────
-- 103 — the boundary credential can actually see what arrived
--
-- A gap found by verifying migration 102 rather than trusting it.
--
-- Migration 100 set default privileges so that ai_marketing_readonly would pick
-- up new warehouse tables without another migration. That was half right.
-- ALTER DEFAULT PRIVILEGES only reaches tables CREATED in a schema afterwards. A
-- table MOVED in with SET SCHEMA carries its old grant list with it, so all
-- eleven tables that arrived in Phase 1 landed invisible to the boundary
-- credential.
--
-- Every later phase that moves tables must run this same grant again. The daily
-- accuracy check planned for Phase 5 should watch for exactly this: a table in
-- warehouse that the boundary credential cannot read.
-- ─────────────────────────────────────────────────────────────────────────

grant select on all tables in schema warehouse to ai_marketing_readonly;

revoke insert, update, delete, truncate, references, trigger
  on all tables in schema warehouse from ai_marketing_readonly;
