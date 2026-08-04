-- ─────────────────────────────────────────────────────────────────────────
-- Revenue category cards for the Ads v2 Metrics board: Organic revenue,
-- Miscellaneous Chats revenue, and Attribution coverage.
--
-- The tracker's callType column ("Miscellaneous Chat", "Strategy Session", ...)
-- is a human-written origin label the facts store never carried. Stamp it on
-- every sale fact so the compute path keeps reading facts only, never raw
-- tables. Backfill from sales_tracker_rows for rows already in the store; the
-- hourly facts rebuild stamps it going forward.
--
-- Category rules (mutually exclusive, in this order):
--   ads      = keyword attributed (keyword present, not organic, not awaiting)
--   organic  = is_organic
--   misc     = tracker callType 'Miscellaneous Chat' and NOT attributed at all
--   untracked = everything else
-- The tracker has no creator column, so misc and the coverage denominator are
-- whole-tracker numbers; only organic can be scoped to the selected account.
-- ─────────────────────────────────────────────────────────────────────────

alter table adsv2_sale_facts add column if not exists call_type text;

update adsv2_sale_facts f
set call_type = nullif(trim(s.raw_payload->>'callType'), '')
from sales_tracker_rows s
where s.sheet_row_key = f.sale_key
  and f.call_type is distinct from nullif(trim(s.raw_payload->>'callType'), '');

-- Per-ET-day revenue by category over the window. Every day in the range is
-- returned (zeros included) so it merges 1:1 with adsv2_window_days.
create or replace function adsv2_revenue_days(
  p_clients text[], p_from date, p_to date
)
returns table (
  et_day date,
  organic_scoped_cents bigint,
  ads_all_cents bigint,
  organic_all_cents bigint,
  misc_chat_all_cents bigint,
  tracker_all_cents bigint
)
language sql stable as $$
  with cat as (
    select sale_et_day as d,
      collected_usd_cents as cents,
      (keyword_normalized is not null and keyword_normalized <> ''
        and not is_organic and not awaiting_review) as is_ads,
      is_organic,
      (lower(coalesce(call_type,'')) = 'miscellaneous chat'
        and not (keyword_normalized is not null and keyword_normalized <> ''
                 and not awaiting_review)) as is_misc,
      (client_key = any(p_clients)) as in_scope
    from adsv2_sale_facts
    where sale_et_day >= p_from and sale_et_day <= p_to
  ),
  agg as (
    select d,
      coalesce(sum(cents) filter (where is_organic and in_scope), 0)::bigint as organic_scoped_cents,
      coalesce(sum(cents) filter (where is_ads), 0)::bigint as ads_all_cents,
      coalesce(sum(cents) filter (where is_organic), 0)::bigint as organic_all_cents,
      coalesce(sum(cents) filter (where is_misc), 0)::bigint as misc_chat_all_cents,
      coalesce(sum(cents), 0)::bigint as tracker_all_cents
    from cat group by d
  )
  select gd::date as et_day,
    coalesce(a.organic_scoped_cents, 0),
    coalesce(a.ads_all_cents, 0),
    coalesce(a.organic_all_cents, 0),
    coalesce(a.misc_chat_all_cents, 0),
    coalesce(a.tracker_all_cents, 0)
  from generate_series(p_from, p_to, interval '1 day') gd
  left join agg a on a.d = gd::date
  order by gd;
$$;
