-- ─────────────────────────────────────────────────────────────────────────
-- 104 — close the back door around the boundary
--
-- Found by testing migration 102 against the live API instead of trusting it.
--
-- Locking the eleven moved tables away from the browser key was not enough.
-- Three older views in public read those same tables and were NOT
-- security_invoker, so they ran with their owner's rights and handed the data
-- back to anon regardless:
--
--   registry_definitions_current   200, the signed definitions
--   registry_entity_alias_index    200, staff and creator aliases
--
-- anon is the publishable key that ships inside the browser bundle. A view that
-- runs with owner rights is a way around every grant this build is drawing, so
-- both halves are closed here: the views become security_invoker and carry no
-- rights of their own, and anon and authenticated lose the grant.
--
-- Every reader of all three is server side and uses service_role (the question
-- door, and scripts/seed-registries.mjs), so nothing that worked stops working.
-- Re-tested after applying: all three now answer 401 to the browser key.
--
-- Reversible:
--   alter view public.<name> set (security_invoker = false);
--   grant select on public.<name> to anon, authenticated;
-- ─────────────────────────────────────────────────────────────────────────

alter view public.registry_definitions_current set (security_invoker = true);
alter view public.registry_entity_alias_index set (security_invoker = true);
alter view public.registry_keyword_active_collisions set (security_invoker = true);

revoke all on public.registry_definitions_current from anon, authenticated;
revoke all on public.registry_entity_alias_index from anon, authenticated;
revoke all on public.registry_keyword_active_collisions from anon, authenticated;

comment on view public.registry_definitions_current is
  'The current signed definition of every term, one row per name at its highest version. Reads warehouse.registry_definitions since the Phase 1 move on 2026-08-10. security_invoker and service_role only: it used to run with owner rights and was readable with the browser key, which migration 104 closed.';
comment on view public.registry_entity_alias_index is
  'Every alias of every registered entity, flattened to one row per alias. Reads warehouse.registry_entities since the Phase 1 move on 2026-08-10. security_invoker and service_role only: it used to run with owner rights and was readable with the browser key, which migration 104 closed.';
comment on view public.registry_keyword_active_collisions is
  'Any keyword that is live in more than one place at once, which the all-time uniqueness law forbids. Reads warehouse.registry_keywords since the Phase 1 move on 2026-08-10. security_invoker and service_role only: it used to run with owner rights and was readable with the browser key, which migration 104 closed.';
