-- ─────────────────────────────────────────────────────────────────────────
-- 101 — MAKE THE WAREHOUSE ROOM ADDRESSABLE
--
-- Law 7 of this build: the app's database client has to be able to reach the
-- warehouse schema, or no writer can ever be pointed at it and the moves in
-- Phases 1 to 3 cannot happen. Before this migration the API layer in front of
-- the database served only `public, graphql_public`, and asking it for a
-- warehouse table came back:
--
--   406  PGRST106  Invalid schema: warehouse
--        hint: Only the following schemas are exposed: public, graphql_public
--
-- The Supabase dashboard has a field for this, but PostgREST also reads its own
-- configuration out of the database from settings on the `authenticator` role,
-- which is a documented mechanism and one a migration can use. This sets it
-- there so the change lives with the rest of the schema history instead of only
-- in a dashboard nobody can diff.
--
-- After this migration the same request comes back:
--
--   401  42501  permission denied for schema warehouse
--
-- which is the correct answer and the safe one: the schema is now addressable,
-- and the app's public browser key still cannot read a single row from it,
-- because nothing in warehouse grants anything to anon.
--
-- Reversible in two lines:
--   alter role authenticator reset pgrst.db_schemas;
--   notify pgrst, 'reload config';
-- ─────────────────────────────────────────────────────────────────────────

alter role authenticator set pgrst.db_schemas = 'public, graphql_public, warehouse';

notify pgrst, 'reload config';
notify pgrst, 'reload schema';
