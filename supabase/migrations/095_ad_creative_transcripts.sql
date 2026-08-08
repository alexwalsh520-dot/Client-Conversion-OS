-- ─────────────────────────────────────────────────────────────────────────
-- TRUTH LAYER BRICK 7 — CREATIVE TRUTH, PART A: what a VIDEO ad actually says.
--
-- The hole this closes was proven twice, by hand, on 31 July and 2 August 2026:
-- a video ad's spoken and on-screen words exist NOWHERE queryable in this
-- system. ad_creative_copy.on_image_text is an OCR read of a STILL image; for a
-- video ad it is empty, because a thumbnail frame is not the ad. Jake's whole
-- test fleet and Tyson's LOADED are videos, so "what does this ad say" was
-- answerable for stills only, and the CMO was reading captions and calling them
-- copy.
--
-- THE LAW THIS TABLE EXISTS TO KEEP (1 July 2026): never characterise an ad from
-- a proxy field. primary_text is the caption ABOVE the creative, not the words
-- ON it. A video's copy is the VIDEO. So the transcript gets its own store, its
-- own column, and its own label, and no query has to decide which field to
-- pretend with.
--
-- ADDITIVE AND ARCHIVE-NEVER-DELETE. One row per ad, keyed by ad_id exactly as
-- ad_creative_copy is. A video that cannot be fetched or transcribed gets a row
-- with status 'failed' and a written reason: an honest failure surface, counted
-- in the report, never a silent skip. Nothing here is ever deleted; a re-read
-- overwrites the row it owns and bumps attempts.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists ad_creative_transcripts (
  ad_id            text primary key,
  client_key       text,
  video_id         text,
  -- Where the audio came from. 'meta_video' is the only source today: the ad's
  -- own video rendition, resolved through the Graph API. Named rather than
  -- assumed so a second source (a stored copy, an uploaded file) can never be
  -- mistaken for the ad's real video later.
  source           text not null default 'meta_video',
  transcript_text  text,
  duration_s       numeric,
  language         text,
  transcribed_at   timestamptz,
  -- The transcriber that produced this text, verbatim. Two rows produced by two
  -- models are two different reads of the same ad, and a reader is entitled to
  -- know which one they are looking at.
  model            text,
  -- ok | failed | pending. 'ok' means real words were stored. 'failed' means we
  -- tried and could not, with the reason written down. 'pending' means claimed
  -- but not yet finished.
  status           text not null default 'pending',
  failure_reason   text,
  attempts         integer not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

alter table ad_creative_transcripts
  drop constraint if exists ad_creative_transcripts_status_check;
alter table ad_creative_transcripts
  add constraint ad_creative_transcripts_status_check
  check (status in ('ok', 'failed', 'pending'));

-- The two reads this table serves: "everything for one creator" (the coverage
-- answer) and "what still needs doing" (the pipeline's work list).
create index if not exists ad_creative_transcripts_client_idx
  on ad_creative_transcripts (client_key);
create index if not exists ad_creative_transcripts_status_idx
  on ad_creative_transcripts (status, client_key);

comment on table ad_creative_transcripts is
  'Brick 7. What a VIDEO ad actually says, transcribed from the ad''s own video. One row per ad_id. A video that could not be fetched or transcribed keeps a failed row with a written reason rather than disappearing from the count.';
comment on column ad_creative_transcripts.transcript_text is
  'The SPOKEN words of the ad''s video. This is the ad''s content. It is never the caption (that is ad_creative_copy.primary_text) and never a thumbnail OCR (that is ad_creative_copy.on_image_text, which is empty for video ads).';
comment on column ad_creative_transcripts.status is
  'ok = real words stored. failed = tried and could not, reason in failure_reason. pending = claimed, not finished. A missing row means never attempted, which is a different fact from failed.';
