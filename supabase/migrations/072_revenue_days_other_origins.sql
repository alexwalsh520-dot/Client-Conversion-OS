-- ─────────────────────────────────────────────────────────────────────────
-- Attribution coverage learns the remaining human-written origins.
--
-- Signed direction (Alex, 2026-08-04): every dollar has a home - ads keyword,
-- organic keyword, or a human-written call type. The coverage numerator so far
-- counted only ads + organic + Miscellaneous Chat; sales the team logged as
-- "Follow up", "Outbound Call", or "Closer Cold Call" have a recorded origin
-- too and belong in the covered share. Blank call types and the defaults that
-- state no origin ("Strategy Session", "Onboarding Call") stay uncovered
-- unless a keyword claims them - that gap is what the daily attribution ping
-- chases to zero.
--
-- Postgres cannot change an OUT column list in-place, so drop + recreate.
-- ─────────────────────────────────────────────────────────────────────────

drop function if exists adsv2_revenue_days(text[], date, date);

create function adsv2_revenue_days(
  p_clients text[], p_from date, p_to date
)
returns table (
  et_day date,
  organic_scoped_cents bigint,
  ads_all_cents bigint,
  organic_all_cents bigint,
  misc_chat_all_cents bigint,
  other_origin_all_cents bigint,
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
      (lower(coalesce(call_type,'')) in ('follow up','outbound call','closer cold call')
        and not (keyword_normalized is not null and keyword_normalized <> ''
                 and not awaiting_review)) as is_other_origin,
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
      coalesce(sum(cents) filter (where is_other_origin), 0)::bigint as other_origin_all_cents,
      coalesce(sum(cents), 0)::bigint as tracker_all_cents
    from cat group by d
  )
  select gd::date as et_day,
    coalesce(a.organic_scoped_cents, 0),
    coalesce(a.ads_all_cents, 0),
    coalesce(a.organic_all_cents, 0),
    coalesce(a.misc_chat_all_cents, 0),
    coalesce(a.other_origin_all_cents, 0),
    coalesce(a.tracker_all_cents, 0)
  from generate_series(p_from, p_to, interval '1 day') gd
  left join agg a on a.d = gd::date
  order by gd;
$$;
