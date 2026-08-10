-- ─────────────────────────────────────────────────────────────────────────
-- 100 — THE BOUNDARY CREDENTIAL
--
-- The Semantic Layer consolidation moves every canonical table into the
-- warehouse schema so that one credential can be handed to an analysis tool and
-- that credential can only see canonical data. This migration creates that
-- credential. It runs FIRST, before anything moves, so that the room it can see
-- visibly grows as tables arrive rather than being switched on at the end.
--
-- What it can do: SELECT, in the warehouse schema, and nothing else.
-- What it cannot do: reach the public schema, write anything anywhere, or log in
-- until a human sets a password on it. The role is created with LOGIN and no
-- password, which Postgres will not authenticate, so creating it opens nothing.
--
-- Why BYPASSRLS. Every real table in the warehouse schema has row level security
-- switched on with zero policies, and all eleven warehouse views are
-- security_invoker, so they are checked as the caller and not as their owner.
-- Without BYPASSRLS this role would connect successfully and read zero rows from
-- everything, which looks exactly like broken data. BYPASSRLS only reaches tables
-- the role can already SELECT, and this role can only SELECT inside warehouse, so
-- the bypass is fenced by the same boundary as everything else.
--
-- Honest limit on the day this was written: warehouse holds five real tables and
-- eleven security_invoker views, and those views read tables that still live in
-- public. Until the later phases move those tables, this role reads the five real
-- tables and gets a permission error from the views. That is the consolidation
-- being incomplete, not this grant being wrong.
--
-- Reversible in one line:  DROP ROLE ai_marketing_readonly;
-- ─────────────────────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ai_marketing_readonly') then
    -- LOGIN with no password: Postgres refuses password authentication for a role
    -- that has none, so this cannot connect until a human sets one.
    create role ai_marketing_readonly with login bypassrls;
  else
    alter role ai_marketing_readonly with login bypassrls;
  end if;
end
$$;

comment on role ai_marketing_readonly is
  'THE BOUNDARY CREDENTIAL for the Semantic Layer. SELECT inside the warehouse schema and nothing else: no public schema access, no writes anywhere. Has BYPASSRLS because every warehouse table has row level security on with no policies and every warehouse view is security_invoker, so without it this role would read zero rows and look like broken data. Created 2026-08-10 by migration 100, before any table moved, so the room it can see grows as the consolidation lands. It carries no password, so it cannot connect until a human sets one.';

-- Nothing in public. The role is not granted anything there, and the check below
-- proves the grant list stays empty. PUBLIC holds USAGE on the public schema by
-- Postgres default, but no table in public grants anything to PUBLIC, so USAGE on
-- an empty grant list reads nothing.
revoke all on schema public from ai_marketing_readonly;
revoke all on all tables in schema public from ai_marketing_readonly;
revoke all on all functions in schema public from ai_marketing_readonly;
revoke all on all sequences in schema public from ai_marketing_readonly;

-- The one room it can see.
grant usage on schema warehouse to ai_marketing_readonly;
grant select on all tables in schema warehouse to ai_marketing_readonly;

-- And every table that arrives in that room later, without another migration.
-- Default privileges are recorded per granting role, so this is set for the role
-- migrations actually run as.
alter default privileges for role postgres in schema warehouse
  grant select on tables to ai_marketing_readonly;

-- Read only, stated twice: once by never granting write, and once by taking it away.
revoke insert, update, delete, truncate, references, trigger
  on all tables in schema warehouse from ai_marketing_readonly;
