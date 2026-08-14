-- ─────────────────────────────────────────────────────────────────────────
-- 109 — PHASE 4: the cursor for the ManyChat identity backfill
--
-- The backfill asks ManyChat's subscriber getInfo for every keyword sender that
-- has no Instagram link yet, and stores the (manychat_id, ig_id, ig_username)
-- pairing that comes back. That pairing is HARD evidence: it is the platform's
-- own record of who the subscriber is, not a name guess.
--
-- This table is the cursor. One row per subscriber ATTEMPTED, written whatever
-- the outcome, so that:
--   a) a subscriber is never fetched twice, across any number of interrupted runs
--   b) a run that stops on a rate limit resumes exactly where it left off
--   c) every failure is on the record rather than lost, with the reason
--
-- It deliberately stores the outcome even when the answer is "no Instagram id on
-- this subscriber", because that is a real answer and re-asking it forever would
-- be a waste of somebody's rate limit.
--
-- WHY THE PAIRING MATTERS. Roughly a third of keyword senders can currently be
-- tied to a readable Instagram thread (2,605 of 7,846 on 2026-08-14). The rest
-- sent a magic word and then vanish into a wall between ManyChat's ids and
-- Instagram's. Every pairing recovered here turns one of those into a person
-- whose conversation can actually be read.
--
-- Reversible: drop table warehouse.manychat_identity_backfill;
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists warehouse.manychat_identity_backfill (
  manychat_id      text primary key,
  client_key       text not null,
  outcome          text not null check (outcome in ('paired', 'no_ig_on_record', 'not_found', 'no_key', 'error')),
  ig_id            text,
  ig_username      text,
  http_status      int,
  error            text,
  queued_link      boolean not null default false,
  attempted_at     timestamptz not null default now()
);

create index if not exists manychat_identity_backfill_outcome_idx
  on warehouse.manychat_identity_backfill (outcome);
create index if not exists manychat_identity_backfill_client_idx
  on warehouse.manychat_identity_backfill (client_key);

comment on table warehouse.manychat_identity_backfill is
  'THE CURSOR for the ManyChat identity backfill (Semantic Layer consolidation Phase 4, 2026-08-14). One row per subscriber ASKED about, written whatever came back, so no subscriber is ever asked twice and an interrupted run resumes exactly where it stopped. outcome: paired = ManyChat gave an ig_id; no_ig_on_record = the subscriber exists but carries no Instagram id; not_found = ManyChat does not know the subscriber; no_key = no API key for that creator; error = anything else, with the reason in error. Not a source of truth about people: the pairing itself goes to registry_person_link_queue and then to registry_persons through the normal link path, so the usual conflict rules apply and nothing here overwrites an existing link.';

comment on column warehouse.manychat_identity_backfill.queued_link is
  'True once the pairing has been handed to registry_person_link_queue. Kept separate from outcome so a pairing that was found but failed to queue is visible rather than silently counted as done.';

grant select, insert, update, delete on warehouse.manychat_identity_backfill to service_role;
grant select on warehouse.manychat_identity_backfill to ai_marketing_readonly;
revoke all on warehouse.manychat_identity_backfill from anon, authenticated;
