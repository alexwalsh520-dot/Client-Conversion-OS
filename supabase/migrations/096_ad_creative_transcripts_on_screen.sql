-- ─────────────────────────────────────────────────────────────────────────
-- BRICK 7, PART A (continued): A VIDEO AD'S WORDS ARE NOT ONLY ITS AUDIO.
--
-- Migration 095 built the transcript store on the assumption a video ad's copy
-- is what is SPOKEN in it. The first real ad it was pointed at disproved that
-- in one call. Tyson's LOADED (ad 52581821002664, video 1568382338182019, the
-- 6x winner paused on 24 July) is a SILENT B-ROLL video: Groq returned
-- "no audio track found in file". Its copy — "I'm looking for 5 servicemen
-- stuck at the same body for 6-18 months..." — is printed ON THE FRAMES.
--
-- Under 095 alone that ad would have been recorded as a transcription failure,
-- and "what does LOADED say" would still have no answer. That is the SAME hole
-- this brick exists to close, one level down, and it is the same law that
-- catches it: never characterise an ad from a proxy field. The audio is not the
-- ad any more than the caption was.
--
-- So a video ad now carries BOTH, in their own columns, with their own status:
--   transcript_text   the SPOKEN words          (empty when the video is silent)
--   on_screen_text    the words PRINTED on the frames, read from frames sampled
--                     across the whole video via Meta's own thumbnails edge —
--                     never from the single cover thumbnail, which is usually
--                     blank and is why video OCR read empty before this brick.
--
-- The row's overall status is 'ok' when EITHER is known, because either one
-- means we can say what the ad says. When neither is, the row stays 'failed'
-- with both reasons written down and keeps counting against coverage.
-- ─────────────────────────────────────────────────────────────────────────

alter table ad_creative_transcripts add column if not exists on_screen_text text;
alter table ad_creative_transcripts add column if not exists frames_read integer;
alter table ad_creative_transcripts add column if not exists on_screen_model text;

-- The two halves, graded separately, so a partial read is never reported as a
-- whole one and "silent video" is never confused with "we could not read it".
--   audio:     ok | no_audio | failed
--   on_screen: ok | no_text  | failed
alter table ad_creative_transcripts add column if not exists audio_status text;
alter table ad_creative_transcripts add column if not exists on_screen_status text;

alter table ad_creative_transcripts
  drop constraint if exists ad_creative_transcripts_audio_status_check;
alter table ad_creative_transcripts
  add constraint ad_creative_transcripts_audio_status_check
  check (audio_status is null or audio_status in ('ok', 'no_audio', 'failed'));

alter table ad_creative_transcripts
  drop constraint if exists ad_creative_transcripts_on_screen_status_check;
alter table ad_creative_transcripts
  add constraint ad_creative_transcripts_on_screen_status_check
  check (on_screen_status is null or on_screen_status in ('ok', 'no_text', 'failed'));

comment on column ad_creative_transcripts.on_screen_text is
  'The words PRINTED on the video, read from frames sampled across its whole length (Meta''s thumbnails edge), deduplicated in time order. For a silent b-roll ad this IS the ad''s copy. Never the cover thumbnail alone: that frame is usually blank, which is exactly why video ads read as having no words before Brick 7.';
comment on column ad_creative_transcripts.audio_status is
  'ok = spoken words stored. no_audio = the video genuinely has no audio track, which is a FACT about the ad, not a failure to read it. failed = we tried and could not.';
comment on column ad_creative_transcripts.on_screen_status is
  'ok = printed words stored. no_text = frames were read and carried no printed words. failed = the frames could not be fetched or read.';
