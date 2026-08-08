# Truth Layer, Brick 7 — Creative Truth

**Built 8 August 2026. Branch `truthlayer-brick7`. Migrations 095, 096, 097.**

---

## What this brick was for

"What does this ad actually say" was answerable for still images and unanswerable
for video. The still path OCRs the image and stores the words; the video path
stored nothing, because the only frame it ever looked at was the cover thumbnail
and that frame is almost always blank.

That hole was proven by hand twice, on 31 July and 2 August. It mattered because
Jake's entire test fleet and Tyson's LOADED are videos, so for those ads the
system's honest answer was "no copy" when the truth was "nobody had looked". An
AI reading that record would have concluded the ads were wordless, or — worse,
and this is the mistake of 1 July 2026 — would have reported the **caption** as
the ad's copy.

Brick 7 closes it, keeps it closed automatically, and puts the creative bench on
the certified menu.

---

## The two findings that changed the design

Both were discovered by pointing the pipeline at a real ad rather than by
reasoning about it, and both are the reason this brick works at all.

### 1. The Graph API hides `source` from a user token, silently

`GET /{video_id}?fields=source` with a creator's **user** token returns:

```json
{"id": "1568382338182019"}
```

Not an error. Not a permission message. The object comes back and the field is
simply gone. Ask for `source,picture,permalink_url,length` and you get every
field except `source`.

That single behaviour explains a standing data gap nobody had diagnosed: **all
215 video ads in `ad_creative_image` carry `media_status = 'no_source'`** (Jake
122, Tyson 93), every one of them with a thumbnail and a `video_id` and none of
them with a stored video. The media sync asked the only way it knew and believed
the answer.

A **page** token, obtained from `/me/accounts` with the same user token, returns
the source:

```json
{"source": "https://scontent.../o1/v/t2/f2/m366/AQNWoLy3M_ycU71chWJKGzzQj...",
 "length": "16.75", "permalink_url": "/reel/1568382338182019/"}
```

So the resolver tries page tokens first and keeps the user token as a fallback,
rather than trusting either one. This is recorded per row (`via`), because "the
user token cannot see source" is the finding, not a footnote.

### 2. A video ad's words are not only its audio

The first ad the pipeline was pointed at was LOADED, Tyson's 6x winner. Groq
answered:

```
transcription failed: groq 400: {"error":{"message":"no audio track found in file","type":"invalid_request_error"}}
```

LOADED is **silent b-roll**. Everything it says is printed on the frames. An
audio-only pipeline would have filed the single most valuable ad on the bench as
a transcription failure and left "what does LOADED say" unanswered — the same
hole this brick exists to close, one level down.

The fix uses Meta's own `/{video_id}/thumbnails` edge, which returns
full-resolution frames sampled across the whole video (nineteen of them for a
seventeen-second ad). Six evenly spaced frames go to one vision call in time
order. For LOADED that recovered exactly the language a human read off the ad on
31 July.

So the store holds **both halves, separately labelled and separately graded**,
and a row is `ok` when either one is known. Silence is recorded as silence
(`audio_status = 'no_audio'`), which is a fact about the ad, not a failure to
read it.

---

## Part A — what was built

### The store

`ad_creative_transcripts`, one row per `ad_id`, additive, archive-never-delete.

| column | what it holds |
|---|---|
| `transcript_text` | the words SPOKEN in the video |
| `on_screen_text` | the words PRINTED on it, from frames across its whole length |
| `audio_status` | `ok` / `no_audio` / `failed` |
| `on_screen_status` | `ok` / `no_text` / `failed` |
| `status` | `ok` when either half is known, else `failed` |
| `failure_reason` | written, kept even on an `ok` row when one half failed |
| `duration_s`, `frames_read`, `language`, `model`, `on_screen_model`, `attempts` | how the read was done |

A missing row means never attempted. A `failed` row means we tried and could
not, with the reason. Those are different facts and the pipeline never collapses
them.

### The pipeline

`src/lib/ads-tracker/creative-transcript.ts`.

- Resolves the video rendition (page token, then user token), downloads it under
  a hard size cap, transcribes the audio, and separately OCRs six sampled frames.
- **Per-step timeouts**: resolve 15s, download 45s, each model call 90s. Each
  timeout names its own step in the stored failure reason.
- **Per-ad isolation** (warehouse hard law 14): ads are settled independently, so
  one video that will not resolve costs exactly itself.
- **Honest failure surface**: every outcome becomes a stored row. Nothing is
  silently skipped, so a video we cannot read counts against coverage rather than
  vanishing from the denominator.
- Whisper hallucinates canned filler ("Thanks for watching.") over silence, so a
  transcript under an eight-word floor is kept for inspection but never graded as
  the ad's words.
- The frame-OCR prompt is the same shape as the still-image OCR: transcribe only,
  never describe, an empty answer beats a guess, and a self-reported confidence
  under 70 is dropped to empty.

### Kept current on the EXISTING cron

`/api/ads/creative-copy/backfill-all` (schedule `20 */2 * * *`) gained a third
phase alongside its OCR and caption phases. **No new cron was added.** The
transcript phase is bounded (10 videos, 120s) and wrapped so a transcription
problem can never cost the OCR backfill its run.

### Transcriber choice, stated plainly

The brief named faster-whisper, as proven in the ad-library-research skill. The
production path here uses **Whisper large-v3 served by Groq**, through the
repo's existing `src/lib/transcribe.ts`, for one hard reason: the cron that keeps
transcripts current runs on Vercel serverless, which cannot run faster-whisper
(Python + CTranslate2). It is the same model family at a larger size, already
keyed and already proven in this repo on reel audio. Using two transcribers would
also mean the same ad reading differently depending on which path ran, which is
exactly the kind of thing a truth layer should not do. The model is recorded per
row either way. faster-whisper (1.2.1, verified present locally) remains the
rescue path for a video over Groq's 24MB ceiling; no ad has hit it.

---

## Backfill coverage

*(filled in below after the run)*

---

## Part B — the locked list, 17 → 19

Neither question changes a number any earlier question returns.

### 24. `ad_copy(client, [ad_id | keyword], [window])`

Everything an ad says, from the field that actually holds it. Every block states
what it **is** and what it **is not**:

| label | source field | is not |
|---|---|---|
| `words_on_the_image` | `ad_creative_copy.on_image_text` | not the caption; never present for a video |
| `words_spoken_in_the_video` | `ad_creative_transcripts.transcript_text` | not the caption, not the printed text |
| `words_printed_on_the_video` | `ad_creative_transcripts.on_screen_text` | not the caption, not the cover thumbnail alone |
| `caption_above_the_creative` | `ad_creative_copy.primary_text` | **not** the words on the image, **not** the words in the video |

`content_known` is true only when the field appropriate to that ad's own creative
type carries words. A full caption never makes a wordless video count as known.

Batch mode (no `ad_id`/`keyword`) returns **copy coverage by spend** for the whole
creator, split by creative type, with every unknown ad named and its spend and
its reason. Coverage is by spend because an unknown ad running at $200/day is a
different problem from an unknown ad that spent four dollars in June. An empty
denominator reads 100%, never 0%, paired with the volume line.

### 25. `creative_bench(client, [window], [lookback_days])`

Three shelves and one alarm:

- **live** — delivering now, each with the **same 72-hour fatigue measurement
  `kill_scale_read` applies**. That measurement was extracted from `kill-scale.ts`
  and exported (`fatigueWindows`, `fatigueBetween`, `measureFatigue`); both
  questions now call one implementation. Two would eventually disagree, and then
  the owner would have two fatigue readings for one ad and no way to choose.
- **paused_proven** — not delivering, but cleared the signed ROI line in a window
  where it also cleared the signed evidence floor. Each carries its prior window,
  **what stopped it** (and at which level — an ad paused at campaign level did not
  lose an argument about its own performance), and the inputs the signed tree
  would want. Where the system does not record one, the item says
  `UNRECORDED` rather than defaulting it — `fresh_creative_tested` being the
  standing example.
- **produced_never_launched** — finished assets in the production stores compared
  against the stored copy of every launched ad, with the matching method and its
  limits written into the answer.
- **bench_thinness** — a live ad at or above the KPI line with nothing waiting
  behind it.

It is **verdict-free by signature**: it names `verdict_floors_kill_tree` and
returns no verdict field and no prescription. A test scans the serialized answer
to prove it.

### Signed definitions (migration 097)

- **`creative_truth` v1** — the field law, with each field's store, what it is,
  and what it is not; the known-rule; and the silent-video rule. Cited on every
  `ad_copy` answer.
- **`creative_bench` v1** — what makes a paused ad PROVEN rather than merely
  paused, the three shelves, the thinness rule, and `verdict_free: true`.

Every threshold both questions apply is read from `registry_definitions` at
answer time. None is written in code, and a missing one produces
`cannot_answer` naming what must be signed.

---

## Tests

*(verbatim output below)*

---

## Honest findings and limits

*(below)*

---

## Not in this brick

No person/bridge work (Brick 5), no funnel questions (Brick 6), no workers
(Brick 9), no new creative generated, no Meta writes, no new cron.
