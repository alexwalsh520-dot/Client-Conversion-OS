-- 097_registry_creative_truth.sql
-- TRUTH LAYER, Brick 7: the CREATIVE FIELD LAW, signed.
--
-- This brick's two questions both stand on one rule that has, until now, lived
-- only in prose and in the memory of the day it was learned (1 July 2026):
--
--   NEVER CHARACTERISE AN AD FROM A PROXY FIELD.
--
-- The rule has cost real money twice. Once when primary_text — the caption
-- ABOVE the creative — was read as the words printed ON it, so a set of ads was
-- judged on copy none of them displayed. Once when a video ad's thumbnail OCR
-- came back empty and that emptiness was read as "this ad has no copy", when in
-- fact the ad's whole message was on frames nobody had looked at.
--
-- Signing it makes it enforceable rather than remembered. Every field a
-- creative answer may report is named here, with what it IS and what it is NOT,
-- and ad_copy cites this definition on every answer it gives.
--
-- creative_bench v1 is signed alongside it because the bench question needs one
-- thing written down that was previously judgement: what makes a paused ad
-- PROVEN rather than merely paused.
--
-- Additive and idempotent: one INSERT ... ON CONFLICT DO NOTHING. No schema
-- change, no existing row touched, nothing dropped.

BEGIN;

DO $$
DECLARE
  v_signer TEXT := 'alex_walsh';
  v_signed_at DATE := DATE '2026-08-08';
BEGIN

  INSERT INTO public.registry_definitions
    (name, version, statement, details, signed_by, signed_at, status)
  VALUES

  ('creative_truth', 1,
   'What an ad SAYS is read from the field that actually holds it, and each field is labelled as itself. on_image_text is the words printed on a STILL image, read by OCR; it is empty for a video ad and that emptiness is never evidence the ad has no copy. primary_text is the CAPTION above the creative; it is never reported as the words on the image and never as the words in the video. For a VIDEO ad the copy is the video: transcript_text is what is SPOKEN in it, and on_screen_text is what is PRINTED on it, read from frames sampled across the whole video rather than from the cover thumbnail, which is usually blank. A video with no audio track has no spoken words, which is a FACT about the ad and not a failure to read it, and such an ad is fully known when its printed words are known. An ad''s content counts as KNOWN when the field appropriate to its own creative type carries words, never when a proxy field does.',
   '{
      "fields": {
        "on_image_text":   {"store": "ad_creative_copy.on_image_text",        "is": "words printed on a STILL image", "is_not": ["the caption", "anything about a video"]},
        "primary_text":    {"store": "ad_creative_copy.primary_text",          "is": "the caption ABOVE the creative", "is_not": ["the words on the image", "the words in the video"]},
        "transcript_text": {"store": "ad_creative_transcripts.transcript_text","is": "the words SPOKEN in a video ad", "is_not": ["the caption", "the printed on-screen text"]},
        "on_screen_text":  {"store": "ad_creative_transcripts.on_screen_text", "is": "the words PRINTED on a video ad, from frames sampled across its whole length", "is_not": ["the caption", "the cover thumbnail alone"]}
      },
      "known_rule": "a still is known when on_image_text carries words; a video is known when transcript_text or on_screen_text carries words",
      "silent_video_rule": "audio_status no_audio is a fact about the ad, not a gap in the record",
      "learned_on": "2026-07-01 (caption read as on-image copy), 2026-07-31 and 2026-08-02 (empty video OCR read as no copy)"
    }'::jsonb,
   v_signer, v_signed_at, 'signed'),

  ('creative_bench', 1,
   'The creative bench is the standing inventory of what can be put in market. It has three shelves and one alarm. LIVE: ads currently delivering, carried with the same 72-hour fatigue measurement the kill/scale read uses, never a second one. PAUSED PROVEN: an ad that is not delivering now and that cleared a collected ROI of 2x or better in some prior window where it also cleared the signed evidence floor of $100 spend in that window. Paused and proven are different things: an ad that never cleared the line is not bench, it is history. PRODUCED NEVER LAUNCHED: a finished creative asset in the production stores that no launched ad''s stored copy matches. BENCH THINNESS: a live ad at or above the KPI line with nothing proven or produced waiting behind it, which is the condition under which a tiring winner has to be killed rather than replaced. The bench states facts and cites the signed decision tree; it returns no verdict of its own.',
   '{
      "paused_proven_min_collected_roi": 2,
      "paused_proven_evidence_floor_source": "verdict_floors_kill_tree",
      "shelves": ["live", "paused_proven", "produced_never_launched"],
      "thinness_rule": "a live ad at or above the KPI line with an empty bench behind it is flagged",
      "verdict_free": true,
      "signed_tree_cited": "verdict_floors_kill_tree"
    }'::jsonb,
   v_signer, v_signed_at, 'signed')

  ON CONFLICT (name, version) DO NOTHING;

END $$;

COMMIT;
