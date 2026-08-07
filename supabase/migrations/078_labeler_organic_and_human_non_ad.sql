-- 078_labeler_organic_and_human_non_ad.sql
-- TRUTH LAYER, Brick 4: FIX THE TRUTH AT THE SOURCE, not only at the door.
--
-- Brick 2 made coverage HONEST: the receipt admits what is unclassified.
-- Brick 4 makes coverage IMPROVE. This migration is the half of that which
-- belongs to the labeler, and it closes the two gaps recorded on 2026-07-31
-- as cmo_open_loops id loop-adsv2-labeler-organic-partd.
--
-- PART C, the organic flag. A sale whose keyword is a MARKED ORGANIC keyword
-- for that creator is an organic sale. Today the labeler leaves is_organic
-- FALSE on every one of them, and only Brick 2's belt-and-suspenders rule in
-- door_coverage_block keeps them out of ad ROAS. That rule was not redundant;
-- it was the only thing working. After this migration the SOURCE agrees with
-- the door, so anything that reads the facts directly (and not everything goes
-- through the door) gets the same answer.
--
-- PART D, human-confirmed non-ad. A row in adsv2_sale_resolutions with
-- keyword_normalized IS NULL is a person saying "I looked at this thread; it is
-- not an ad sale". That is a RESOLUTION, and the labeler has been throwing it
-- away: it only ever read resolutions that carried a keyword. Eight sales Alex
-- reviewed by hand on 2026-07-31, worth 15,098.00 USD, have been sitting in the
-- awaiting-review queue ever since, being re-reviewed by every reader who looks
-- at the gap. After this migration they leave the queue on the next label run.
--
-- WHAT THIS IS NOT. The labeler is a stamping machine, not a decision machine.
-- Everything here applies either a SIGNED rule (organic_keywords v1, through
-- the registry) or a recorded HUMAN decision. Nothing here judges anything.
--
-- Additive. Idempotent: running it twice stamps the same rows to the same
-- values and reports zero further changes.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- 1. blank_reason gains ONE value: 'human_confirmed_non_ad'.
--
-- It is deliberately its own reason rather than reusing 'misc_chat' or
-- 'no_keyword_ever'. Those two are what the MACHINE concluded from the record.
-- This one is what a PERSON concluded from looking at the actual thread, and a
-- reader who cannot tell those apart cannot tell a gap that has been closed
-- from a gap that has merely been guessed at.
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE public.adsv2_sale_facts
  DROP CONSTRAINT IF EXISTS adsv2_sale_facts_blank_reason_check;

ALTER TABLE public.adsv2_sale_facts
  ADD CONSTRAINT adsv2_sale_facts_blank_reason_check
  CHECK (
    blank_reason IS NULL
    OR blank_reason = ANY (ARRAY[
      'misc_chat',
      'organic_dm',
      'keyword_after_booking',
      'no_utm_on_booking_link',
      'no_keyword_ever',
      'unknown',
      'former_creator_ad',
      -- Brick 4, part D. A person opened the thread and said it is not an ad.
      'human_confirmed_non_ad'
    ])
  );

COMMENT ON COLUMN public.adsv2_sale_facts.blank_reason IS
  'Why this sale carries no ad, written when the row was stamped. human_confirmed_non_ad is the only value that means a PERSON looked; every other value is what the machine concluded from the record.';

-- ─────────────────────────────────────────────────────────────────────────
-- 2. THE LABELER, with parts C and D.
--
-- Parts A and B are UNCHANGED, character for character, from the deployed
-- function. They are reproduced here rather than left implicit because this
-- function had no migration file at all: it lived only in the database, which
-- meant the repo could not tell you what the labeler did. That is fixed here.
--
-- Order matters and is deliberate:
--   A  former-creator label      machine, from the event record
--   B  single-keyword stamp      machine, from the event record
--   C1 human resolution WITH a keyword    person outranks machine
--   C2 organic flag              signed rule, applied to whatever now carries
--                                a marked organic keyword
--   D  human resolution with NO keyword   person outranks machine
--
-- C1 and D both run after B on purpose: a recorded human decision outranks a
-- machine stamp, which is the same law that has governed C1 since it shipped.
-- Where D overrides a keyword a machine had stamped, it says so in
-- evidence_detail rather than quietly erasing it.
-- ─────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.adsv2_label_sale_origins(
  p_from            DATE,
  p_to              DATE,
  p_active_clients  TEXT[]
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET statement_timeout TO '30s'
AS $function$
declare
  v_labeled  integer := 0;
  v_stamped  integer := 0;
  v_resolved integer := 0;
  v_organic  integer := 0;
  v_nonad    integer := 0;
begin
  -- A) former-creator label (unchanged)
  with cand as (
    select f.id,
      (select e.client_key from ads_keyword_events e
        where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
        order by e.event_at desc limit 1) as former_creator,
      (select e.keyword_normalized from ads_keyword_events e
        where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
        order by e.event_at desc limit 1) as kw
    from adsv2_sale_facts f
    where f.sale_et_day between p_from and p_to
      and f.blank_reason = 'unknown'
      and f.subscriber_id is not null
      and exists (select 1 from ads_keyword_events e
                   where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day)
      and not exists (select 1 from ads_keyword_events e
                   where e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
                     and e.client_key = any(p_active_clients))
  ), upd as (
    update adsv2_sale_facts f
       set blank_reason = 'former_creator_ad',
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('former_creator', c.former_creator, 'keyword', c.kw,
                                   'labeled_by', 'adsv2_label_sale_origins')
      from cand c
     where c.id = f.id
    returning 1
  )
  select count(*)::integer into v_labeled from upd;

  -- B) windowless single-keyword stamp (unchanged)
  with cand as (
    select f.id,
           min(e.keyword_normalized) as kw,
           min(e.client_key) as ck,
           min(e.event_at) as first_event
    from adsv2_sale_facts f
    join ads_keyword_events e
      on e.subscriber_id = f.subscriber_id and e.event_at::date <= f.sale_et_day
    where f.sale_et_day between p_from and p_to
      and f.blank_reason = 'unknown'
      and f.subscriber_id is not null
      and not exists (select 1 from ads_keyword_events e2
                       where e2.subscriber_id = f.subscriber_id
                         and e2.event_at::date <= f.sale_et_day
                         and (e2.client_key is null or not (e2.client_key = any(p_active_clients))))
    group by f.id
    having count(distinct e.keyword_normalized) = 1
       and count(distinct e.client_key) = 1
  ), upd as (
    update adsv2_sale_facts f
       set evidence_key = 'subscriber_single_presale_keyword',
           keyword_normalized = c.kw,
           client_key = c.ck,
           blank_reason = null,
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('subscriber', f.subscriber_id, 'keyword', c.kw,
                                   'first_keyword_at', c.first_event,
                                   'stamped_by', 'adsv2_label_sale_origins')
      from cand c
     where c.id = f.id
       and not exists (select 1 from organic_keywords o
                        where o.keyword_normalized = c.kw and o.client_key = c.ck)
    returning 1
  )
  select count(*)::integer into v_stamped from upd;

  -- C1) human resolutions WITH a keyword: a person decided, and that outranks
  --     everything. A resolved sale is also, by definition, no longer awaiting
  --     review. (Unchanged.)
  with upd as (
    update adsv2_sale_facts f
       set evidence_key = 'human_resolution',
           keyword_normalized = r.keyword_normalized,
           client_key = r.client_key,
           blank_reason = null,
           awaiting_review = false,
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('keyword', r.keyword_normalized, 'decided_by', r.resolved_by,
                                   'resolution_note', r.note, 'resolved_at', r.created_at)
      from adsv2_sale_resolutions r
     where r.sale_key = f.sale_key
       and f.sale_et_day between p_from and p_to
       and r.keyword_normalized is not null
       and (f.evidence_key is distinct from 'human_resolution' or f.awaiting_review)
    returning 1
  )
  select count(*)::integer into v_resolved from upd;

  -- ── C2) PART C, NEW. THE ORGANIC FLAG. ─────────────────────────────────
  --
  -- organic_keywords v1 (signed): "Organic keywords are a marked list. Organic
  -- sales never enter ad ROAS." A sale carrying a marked organic keyword for
  -- ITS OWN creator is an organic sale, however that keyword got onto the row:
  -- machine stamp, human resolution or the original attribution pass.
  --
  -- THE SCOPE IS PER CLIENT, and that is not a detail. `ready` is a marked
  -- ORGANIC keyword for jake and was a retired AD keyword for tyson. A flat
  -- keyword list would flip Tyson's 2026-06-12 `ready` sale to organic and
  -- strip 1,200.00 USD out of ad ROAS six weeks before Jake's organic use even
  -- began. registry_keywords is read with BOTH keys, always.
  --
  -- registry_keywords is the canonical list (Brick 1); organic_keywords is the
  -- older table it was seeded from. This reads the registry, so a keyword the
  -- owner marks there takes effect without a second write anywhere.
  with upd as (
    update adsv2_sale_facts f
       set is_organic = true,
           method = 'organic',
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('organic_keyword', f.keyword_normalized,
                                   'organic_rule', 'organic_keywords v1 via registry_keywords',
                                   'flagged_by', 'adsv2_label_sale_origins')
     where f.sale_et_day between p_from and p_to
       and f.keyword_normalized is not null
       and f.client_key is not null
       and (f.is_organic = false or f.method is distinct from 'organic')
       and exists (select 1 from registry_keywords k
                    where k.type = 'organic'
                      and k.keyword_normalized = f.keyword_normalized
                      and k.client_key         = f.client_key)
    returning 1
  )
  select count(*)::integer into v_organic from upd;

  -- ── D) PART D, NEW. HUMAN-CONFIRMED NON-AD. ────────────────────────────
  --
  -- A resolution row with keyword_normalized IS NULL is a person saying "I
  -- opened this thread and there is no ad in it". Before this, the labeler
  -- skipped those rows entirely, so the reviewed sale stayed marked awaiting
  -- review forever and every later reader re-reviewed work that was already
  -- done. A resolution that changes nothing teaches people that resolving
  -- changes nothing.
  --
  -- The keyword stays NULL because that is the finding. The client comes from
  -- the RESOLUTION row, because the person who looked is the one who knows
  -- whose sale it is; the engine still refuses to guess it.
  --
  -- Where this overrides a keyword a machine had stamped, the old keyword is
  -- recorded in evidence_detail. A human decision outranks a machine stamp,
  -- which has been the law since C1 shipped, but it is never allowed to erase
  -- the evidence it overruled.
  with upd as (
    update adsv2_sale_facts f
       set evidence_key   = 'human_resolution',
           keyword_normalized = null,
           client_key     = r.client_key,
           blank_reason   = 'human_confirmed_non_ad',
           awaiting_review = false,
           is_organic     = false,
           evidence_detail = coalesce(f.evidence_detail, '{}'::jsonb)
             || jsonb_build_object('decided_by', r.resolved_by,
                                   'resolution_note', r.note,
                                   'resolved_at', r.created_at,
                                   'confirmed_non_ad', true,
                                   'resolved_by_part', 'D')
             || case when f.keyword_normalized is not null
                     then jsonb_build_object('overrode_machine_keyword', f.keyword_normalized)
                     else '{}'::jsonb end
      from adsv2_sale_resolutions r
     where r.sale_key = f.sale_key
       and f.sale_et_day between p_from and p_to
       and r.keyword_normalized is null
       -- Idempotence: a row already in the confirmed state is left alone, so a
       -- second run reports zero rather than rewriting the same values.
       and (f.blank_reason is distinct from 'human_confirmed_non_ad'
            or f.awaiting_review
            or f.keyword_normalized is not null
            or f.evidence_key is distinct from 'human_resolution')
    returning 1
  )
  select count(*)::integer into v_nonad from upd;

  return v_labeled + v_stamped + v_resolved + v_organic + v_nonad;
end
$function$;

COMMENT ON FUNCTION public.adsv2_label_sale_origins(DATE, DATE, TEXT[]) IS
  'TRUTH LAYER Brick 4. Stamps sale origins from the event record, the signed organic keyword list and recorded human resolutions. Part C flags marked organic keywords per client so the source agrees with door_coverage_block; part D closes out resolutions that say "I looked, this is not an ad sale" so reviewed rows leave the awaiting-review queue. Applies signed rules and human decisions only; it judges nothing.';

COMMIT;
