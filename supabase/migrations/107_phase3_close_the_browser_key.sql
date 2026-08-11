-- ─────────────────────────────────────────────────────────────────────────
-- 107 — PHASE 3, second half: take the copies of reality away from the browser key
--
-- Kept separate from the move on purpose. Migration 106 ran in the few seconds
-- between the repointed code going live and the webhooks writing again, so it did
-- the move and nothing else. Changing who can read what is not work to bundle
-- into a window that tight.
--
-- Safe because nothing reads these with the browser key. All 87 files that
-- reference any of the twelve were checked: not one imports the browser client
-- and not one sits in a client component. Every reader is server side on
-- service_role.
--
-- Also closes one more instance of the back door migration 104 first found.
-- public.sale_attribution is not security_invoker, so it ran with its owner's
-- rights and served ads_keyword_events joined to sales_tracker_rows to anon no
-- matter what the underlying tables allowed. No application code reads it at all,
-- and it was the only object in this set carrying no label, which is fixed here.
--
-- Reversible:
--   grant select on public.<name> to anon, authenticated;
--   alter view public.sale_attribution set (security_invoker = false);
-- ─────────────────────────────────────────────────────────────────────────

do $$
declare
  t text;
  tables text[] := array[
    'ads_keyword_events','dm_conversation_messages','ghl_appointments','sales_tracker_rows',
    'manychat_origin_checks','manychat_tag_events','instagram_lead_links','fx_rates',
    'fathom_calls','fathom_call_links','creator_content','creator_account_snapshots'
  ];
begin
  foreach t in array tables loop
    execute format('revoke all on warehouse.%I from anon, authenticated', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end
$$;

alter view public.sale_attribution set (security_invoker = true);
revoke all on public.sale_attribution from anon, authenticated;

comment on view public.sale_attribution is
  'Sales tracker rows joined to the keyword events that explain them. Reads warehouse.sales_tracker_rows and warehouse.ads_keyword_events since the Phase 3 move on 2026-08-11. No application code reads this view. security_invoker and service_role only: it used to run with owner rights and was readable with the browser key, which migration 107 closed.';
