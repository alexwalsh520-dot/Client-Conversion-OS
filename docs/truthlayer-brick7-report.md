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
- **Per-step timeouts**: resolve 15s, download 90s, each model call 90s. Each
  timeout names its own step in the stored failure reason. (Download started at
  45s and was raised after it failed Jake's two largest videos, one of them a
  $1,882 ad.)
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
transcript phase is bounded (10 videos, 100s) and wrapped so a transcription
problem can never cost the OCR backfill its run. The budget is checked BETWEEN
ads, so the worst case is the budget plus one slowest ad (a 90s download and a
90s model call), which lands inside the 300s function ceiling with room for the
two OCR phases above it.

### Transcriber choice, stated plainly

The brief named faster-whisper, as proven in the ad-library-research skill. The
production path here uses **Whisper large-v3 served by Groq**, through the
repo's existing `src/lib/transcribe.ts`, for one hard reason: the cron that keeps
transcripts current runs on Vercel serverless, which cannot run faster-whisper
(Python + CTranslate2). It is the same model family at a larger size, already
keyed and already proven in this repo on reel audio. Using two transcribers would
also mean the same ad reading differently depending on which path ran, which is
exactly the kind of thing a truth layer should not do. The model is recorded per
row either way.

Sixteen of Jake's videos DID exceed the 24MB upload ceiling, and the rescue for
those kept the same model rather than reaching for a second one: strip the audio
locally with ffmpeg, then send that. Details under **The oversized-video rescue**
below. faster-whisper (1.2.1) is verified present locally and remains available,
but it was not needed and using it would have meant two transcribers in one
store.

---

## Backfill coverage

The whole standing fleet, both creators, **paused ads included** — the bench is
where LOADED and STRENGTH wait, and a paused winner nobody can read is a winner
nobody can relaunch.

| | Tyson | Jake | Total |
|---|---:|---:|---:|
| video ads read | 93 | 122 | **215** |
| words known (`status = ok`) | 89 | 121 | **210** |
| no words recovered | 4 | 1 | **5** |
| spoken words stored | 69 | 116 | **185** |
| genuinely silent / no usable speech | 24 | 6 | **30** |
| audio still unread | 0 | 0 | **0** |
| printed on-screen words stored | 77 | 104 | **181** |
| frames read, no printed words | 16 | 18 | **34** |
| frames unread | 0 | 0 | **0** |

**210 of 215 video ads now have their words.** The other five are counted, not
hidden — see below.

### Copy coverage by spend, through the door

Over each creator's trailing 90 days (the question's default window):

| | ads | spend | known | **coverage by spend** | by ad count |
|---|---:|---:|---:|---:|---:|
| **Jake** | 70 | $5,439.52 | 69 | **100%** | 98.6% |
| — video | 41 | $5,346.43 | 41 | **100%** | |
| — still | 29 | $93.09 | 28 | 97.6% | |
| **Tyson** | 168 | $48,659.49 | 161 | **98.9%** | 95.8% |
| — video | 3 | $2,569.84 | 3 | **100%** | |
| — still | 165 | $46,089.65 | 158 | 98.8% | |

Test (b) asked for Jake above 90%, since his ads were proven video-only with
empty OCR on 31 July. He is at **100% by spend, and 100% across his 41 video
ads.**

The eight ads that remain unknown are all **stills whose image genuinely carries
no printed words** — the biggest is Tyson's TRIM at $497.02, a photo ad
(`is_video = false`, classified, image fetched and read, OCR empty) whose message
lives entirely in its caption. The answer names every one of them with its spend
and its reason, and reports the caption separately rather than counting it as the
creative's own words.

### Every failure, named

Five ads yielded no words at all. All five have a stored row with a written
reason; none was skipped.

| creator | ad | lifetime spend | duration | why |
|---|---|---:|---:|---|
| tyson | 52530111394864 (FRESH) | $188.90 | 15.0s | 3 words of audio, under the floor; 6 frames carried no printed words |
| tyson | 6771829430660 | $0.00 | 15.0s | same |
| tyson | 6771850930260 | $0.00 | 15.0s | same |
| tyson | 6771851110060 | $0.00 | 15.0s | same |
| jake | 120240874510100185 | $0.00 | 22.4s | no audio track; 6 frames carried no printed words |

Four of the five never spent a cent. All five are wordless b-roll: they say
nothing out loud and print nothing on screen. That is a **finding about the ads**,
recorded as one, and it is different from a failure to read them — which is why
`audio_status` and `on_screen_status` are graded separately.

### The oversized-video rescue

Sixteen of Jake's videos are 25-47MB, over the 24MB ceiling the transcription API
accepts. Their printed words read fine, so the ads were never *unknown* — but one
group of them carries **$1,164.75 of spend**, and "we know what it shows and not
what it says" is a real gap.

The video is the problem; the audio is not. Stripping the audio track turns a
46.9MB file into 1.60MB, which uploads without complaint:

```
120249900300020185: 46.9MB video -> 1.60MB audio
  rescued: 635 spoken words
...
rescue complete: 16 rescued, 0 still unread
```

All sixteen were recovered with the **same model** as the rest of the store, so
no ad carries text from a different transcriber than its neighbours. Those rows
record how they were reached:
`whisper-large-v3 (audio extracted locally: the video exceeded the upload ceiling)`.

This is `scripts/rescue-oversized-transcripts.mts`, a LOCAL rescue, not a pipeline
change: it needs ffmpeg, which a Vercel serverless cron cannot run. **The
production path still fails an oversized video honestly** (`audio_status =
'failed'`, reason written) rather than pretending. If oversized videos become
common rather than occasional, the durable fix is server-side audio extraction,
and that is a separate piece of work.

### One more thing the first pass taught

The first backfill left nineteen of Jake's ads with their printed words captured
and their spoken words lost to a download timeout — `status = 'ok'`, and a real
gap. The work list judged completeness on the row's overall status, so those
nineteen would have stayed half-known forever.

`findVideoAdsNeedingTranscript` now re-queues a **half-read** ad: `no_audio` and
`no_text` are finished (they are facts about the ad), only `failed` is unfinished.
All twenty half-read ads were recovered on the next pass.

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

Nineteen tests, all passing, run against the live database. Verbatim:

```
✔ (c) a still ad never reports its caption as the words on the image (0.821542ms)
✔ (c) a video ad never reports its caption as spoken or as printed words (0.192625ms)
✔ (c) a video ad never gets an on-image block, however full its caption is (0.115042ms)
✔ a video with neither spoken nor printed words is NOT known, however full its caption (0.152833ms)
✔ a still whose image carries no words is not known, and says the caption is separate (0.089875ms)
✔ a video ad that has never been read says so, rather than reading as wordless (0.09125ms)
✔ an ad of unknown creative type refuses to let any field answer for it (0.466667ms)
✔ a silent video reports its silence as a fact about the ad (0.101167ms)
✔ an unclassified ad with an empty image read says the video trap is still open (0.102ms)
✔ (a) GOLDEN: LOADED's stored creative read carries the hand-verified servicemen callout (384.786042ms)
✔ (a) the door itself returns LOADED's words, labelled, through ad_copy (2083.90125ms)
✔ (b) jake's copy coverage by spend clears 90%, or names every miss (1952.629333ms)
✔ (b) jake's video ads specifically are known, not just his stills (1702.429292ms)
✔ (d) creative_bench shelves LOADED and STRENGTH as paused-proven with real prior windows (4433.62475ms)
✔ (d) bench thinness fires only when the shelf behind a live winner is empty (7876.837417ms)
✔ (d) creative_bench returns FACTS only: no verdict, no recommendation (4455.073167ms)
✔ (e) a video that cannot be resolved writes a failed row and never throws (2897.001375ms)
✔ (f) the locked list is nineteen questions, and the two new ones are on it (0.87475ms)
✔ (f) an unknown creative question is refused in writing, not improvised (1.989166ms)
ℹ tests 19
ℹ pass 19
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 26366.746833
```

**(a)** The fixture phrase was human-verified. LOADED was read by hand on 31 July
and its on-screen callout recorded as the "5 servicemen stuck at the same body"
family. The stored read, from the ad's own frames on 8 August:

> I'm looking for / 5 servicemen / stuck at the same body for 6-18 months who
> want to crush their fitness standards. / - You don't need more info, you need a
> system / - Daily 1:1 check-ins so you actually stay consistent this time / -
> Built around duty days, rotating shifts, and kids / - All in one app so you
> just open it and follow the plan / DM me for details on 1 of the 5 spots.

The test asserts two distinct phrases from that text, in the store AND through
the door.

**(b)** Jake clears the bar at 100% by spend. The assertion is written so a
failure explains itself: it prints every still-unknown ad with its spend and its
reason, sorted by spend, rather than just going red.

**(c)** Nine constructed fixtures, no database. Every text is a distinct sentinel
string, so a field plumbed into the wrong block fails on the VALUE, not on a
label that happens to read plausibly. They cover both directions of the 1 July
mistake and the 31 July one.

**(d)** LOADED and STRENGTH are both on the paused-proven shelf with real ROI,
real spend, real windows and a real reason they stopped. Thinness is asserted
*conditionally* — flagged only when the shelf is empty — because Tyson's bench is
23 deep and a flag there would be a false alarm. A third test proves the answer
carries no verdict field and no prescription while still citing the signed tree.

**(e)** Two synthetic ads with unresolvable video ids. The first proves a failure
is RECORDED rather than raised; the second proves the run carries on afterwards,
which is the property warehouse law 14 actually asks for. The two fixture rows
are removed afterwards — they are test artefacts, not facts about the business,
and nothing real is ever deleted from this table.

**(f)** Full suite: **320 tests, 318 pass, 2 fail**, and both failures are the
pre-existing ones documented below. Every Brick 7 test passes. Production build
compiles (`✓ Compiled successfully in 19.6s`).

---

## Honest findings and limits

### Whisper echoed its own prompt back and called it an ad

Four of Tyson's video ads came back with the transcript:

```
Spoken words only.
```

That is a fragment of the anti-hallucination prompt `src/lib/transcribe.ts`
sends to Groq: *"Instagram fitness reel. Spoken words only."* Whisper echoes its
prompt back over silent audio. Stored unchecked, four ads would have carried
that sentence as their copy, and it would have looked like a real read.

The eight-word speech floor caught all four. A guard was added on top of it,
because a longer prompt would echo back longer, clear the floor, and read as
genuine speech: an echo is never the ad's words, at any length.

### All 215 video ads have `media_status = 'no_source'`, and now we know why

Documented above: the Graph API omits `source` for a user token without erroring.
This brick does not fix `media-sync.ts` — that is outside its scope and belongs
with whoever owns durable video storage — but the cause is now known and the fix
is one line: resolve through a page token. Nothing in Brick 7 depends on the
stored copies; it resolves the rendition itself at read time.

### What the produced-never-launched match can and cannot prove

An asset counts as launched when a launched ad's stored copy matches its opening
text (normalised, first 60 characters). `no_match_found` is strong evidence an
asset was never run, **not proof**: an ad launched with rewritten copy would not
match. The answer says this in the response itself rather than only here.

The Tyson pool that memory records as "70 creatives ready" is in the database as
the `Tyson 100-Ad Sprint` factory project, 70 completed items, all with assets —
and most of them **were** launched. That corrects a standing assumption worth
correcting.

Creative that exists only as files outside this system (for example
`Agency/Tyson/03_AD_COPY_AND_DOCS/100_ad_pool_copy_2026-06-22.md`, which is on
the owner's laptop and not in any store this door can read) is invisible to
`creative_bench`. It is named as an unknown in the answer rather than counted as
an empty shelf.

### The keyword grain

Spend comes from `adsv2_window_leaves`, the same certified aggregation the Ads v2
tab paints from, whose grain is (client, keyword) with `ad_id` being the most
recent ad that carried that keyword. Windowing it differently is allowed;
reimplementing it is not. So an ad that never carried a keyword has no spend row
here, and where one keyword ran as several ads their spend rolls up under the
most recent. This is stated in the answer's exclusions.

### Pre-existing test failures on `origin/main`

Verified by checking out clean `origin/main` into a separate worktree and running
the suite there: **301 tests, 299 pass, 2 fail**, both before this brick exists:

1. `ads-tracker-export.html inline app compiles (browser-equivalent Babel parse)`
   — the known standing failure.
2. `GOLDEN LIVE: the budget map reconciles, and anything that does not is
   REPORTED` — `52595863807264 paced at 67.2% of its dial, outside Meta's flex,
   and was not reported as a mismatch`. This is live-data drift in a Brick 3
   golden, unrelated to creative truth, and it is **not** the single known
   failure the brief anticipated. Flagging it rather than absorbing it.

### The locked-list count, and the other two bricks in flight

Bricks 5, 6 and 7 were built concurrently. Brick 4 established the convention
that a later brick updates the one count assertion in earlier goldens; this brick
followed it and set both to **19**. Whichever of Bricks 5 and 6 lands after this
one will have to bump the same two lines again and re-run. That is a rebase
chore, not a disagreement.

---

---

## One full `ad_copy` answer, pasted whole

`ad_copy(client: tyson, ad_id: 52581821002664)` — LOADED. Captured from the live
door with `scripts/brick7-capture.mts` and pasted byte for byte.

Read the two things side by side. `words_printed_on_the_video` is what the ad
actually shows a viewer: a fifteen-word callout to five servicemen. `caption` is
a four-hundred-word veteran's story that shares almost no language with it.
Before this brick, an AI asked what LOADED said had only the caption to reach
for, and would have answered with the wrong text and full confidence.

```json
{
  "question_key": "ad_copy",
  "question": "Everything one ad says, taken from the field that actually holds it: for a still, the words on the image; for a video, the words spoken in it and the words printed on it; and for either, the caption above it, labelled as the caption and never as the creative's own copy. Asked for a whole creator instead, it returns how much of that creator's spend runs on ads whose content is known, and names every ad where it is not.",
  "params": {
    "client": "tyson",
    "ad_id": "52581821002664",
    "keyword": null,
    "date_from": "2026-05-10",
    "date_to": "2026-08-07"
  },
  "answers": {
    "client": "tyson",
    "looked_up_by": "ad_id",
    "window": {
      "from": "2026-05-10",
      "to": "2026-08-07"
    },
    "found": 1,
    "ads": [
      {
        "ad_id": "52581821002664",
        "keyword": "loaded",
        "ad_name_verbatim": "LOADED",
        "client": "tyson",
        "delivery_state": "not_active",
        "creative_type": "video",
        "spend_usd_cents": 232386,
        "content_known": true,
        "what_the_ad_says": [
          {
            "label": "words_spoken_in_the_video",
            "is_not": "NOT the caption and NOT the printed on-screen text.",
            "text": null,
            "source_field": "ad_creative_transcripts.transcript_text"
          },
          {
            "label": "words_printed_on_the_video",
            "is_not": "NOT the caption and NOT the cover thumbnail alone. Read from frames sampled across the whole video, which is why it finds copy the thumbnail OCR never could.",
            "text": "I'm looking for / 5 servicemen / stuck at the same body for 6-18 months who want to crush their fitness standards. / - You don't need more info, you need a system / - Daily 1:1 check-ins so you actually stay consistent this time / - Built around duty days, rotating shifts, and kids / - All in one app so you just open it and follow the plan / DM me for details on 1 of the 5 spots.",
            "source_field": "ad_creative_transcripts.on_screen_text"
          }
        ],
        "caption": {
          "label": "caption_above_the_creative",
          "is_not": "NOT the words on the image and NOT the words in the video. This is the primary text that sits above the creative in the feed.",
          "text": "5 VETERANS WANTED: GET YOUR WARRIOR BODY BACK\n\nI'm looking for 5 veterans who are done lying to themselves.\n\nNot for guys who blame \"busy seasons\" while their gut grows bigger every month.\n\nAs a Marine about to transition myself, I see what happens. You lose your structure. Your accountability. Your brothers who kept you sharp.\n\nAnd your body becomes proof of your surrender.\n\nYou know that feeling when you catch yourself in a mirror?\n\nWhen you remember what you used to be capable of?\n\nWhen you realize you've become everything you swore you'd never become?\n\nThat warrior is still in there. Buried under excuses and broken promises to yourself.\n\nThis isn't some civilian fitness program. This is a system built for men who understand discipline but lost their enforcement.\n\nReady to stop the self-betrayal? Click the link to learn more.\n\nMy clients don't just get their bodies back. They get their self-respect back.\n\nMy client Mark was lying awake at 3am hating how soft he'd gotten since leaving the Army. Then he got his warrior body back fast. No more shame when he looked in the mirror.\n\nAnother veteran client Dave felt like a fraud when people called him \"hero\" while his body was falling apart. Then he rebuilt his strength without the gym taking over his life. His kids respect him again like they used to.\n\nMy client Tony missed the brotherhood and discipline so much he was drinking every night to numb it. Then he found his purpose again without starting over from zero. No more empty feeling inside.\n\nThe system works because you already know how to execute under pressure. You just need someone to apply that pressure again.\n\nIf you're dealing with:\n\n• Avoiding mirrors because you hate what you see\n\n• A body that would embarrass your former self\n\n• Lying to yourself about \"getting back to it\"\n\n• Knowing you're capable of more but doing nothing\n\n...and you're ready to end the cycle of self-deception, click the link to learn more.\n\nYou'll get a complete battle plan for your nutrition, training, and daily accountability.\n\nThis isn't for everyone. If you want to keep making excuses, keep scrolling.\n\nBut if you're ready to become the man you used to respect, click the link to learn more.",
          "source_field": "ad_creative_copy.primary_text"
        },
        "video_read": {
          "audio_status": "no_audio",
          "on_screen_status": "ok",
          "duration_s": 16.75,
          "frames_read": 6,
          "transcribed_at": "2026-08-08T09:40:36.982+00:00",
          "models": {
            "spoken": "whisper-large-v3",
            "printed": "claude-sonnet-4-6"
          },
          "note": "This video has no audio track. That is a fact about the ad, not a gap in the record: it says nothing out loud and everything it says is printed on it."
        },
        "not_known_because": null
      }
    ],
    "field_law": "Each block above says what it IS and what it is NOT. The caption is returned separately from what the creative itself says, always, because reading the caption as the on-image copy is a mistake this system has already made once and paid for."
  },
  "definitions_quoted": [],
  "as_of": [
    {
      "source": "ad_creative_copy",
      "last_written_at": "2026-08-07T16:20:52.663849+00:00",
      "note": "When this creator's newest still-image OCR and caption were stored."
    },
    {
      "source": "ad_creative_transcripts",
      "last_written_at": "2026-08-08T10:41:02.934+00:00",
      "note": "When this creator's newest video read was stored. Video reads are kept current by the two-hourly creative cron."
    }
  ],
  "sources": [
    "ad_creative_copy",
    "ad_creative_transcripts",
    "ad_creative_image",
    "ads_meta_insights_daily"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "ad_copy",
    "question_version": 1,
    "asked_at": "2026-08-08T10:43:58.045Z",
    "caller": "report",
    "params_as_resolved": {
      "client": "tyson",
      "ad_id": "52581821002664",
      "keyword": null,
      "date_from": "2026-05-10",
      "date_to": "2026-08-07"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-05-10",
      "to": "2026-08-07",
      "kind": "explicit_range"
    },
    "data_version": null,
    "freshness": [
      {
        "source": "ad_creative_copy",
        "last_written_at": "2026-08-07T16:20:52.663849+00:00",
        "note": "When this creator's newest still-image OCR and caption were stored."
      },
      {
        "source": "ad_creative_transcripts",
        "last_written_at": "2026-08-08T10:41:02.934+00:00",
        "note": "When this creator's newest video read was stored. Video reads are kept current by the two-hourly creative cron."
      }
    ],
    "stale": [],
    "coverage": null,
    "exclusions": [
      {
        "what": "ads that carried no keyword in the window",
        "count": 0,
        "why": "spend is read through the same certified keyword-grain aggregation the Ads v2 tab paints from, so an ad that never carried a keyword has no spend row here to report against."
      },
      {
        "what": "what an ad's images or video SHOW, as opposed to what they SAY",
        "count": 0,
        "why": "this question reports words only. Nothing here describes a person, a setting or a visual style, because a vision model asked to describe an ad will compose copy that appears nowhere in the account."
      }
    ],
    "caveats": [],
    "certainty": "machine_certain",
    "definitions_cited": [
      {
        "registry": "registry_definitions",
        "name": "creative_truth",
        "version": 1
      }
    ]
  }
}
```

---

## One full `creative_bench` answer, pasted whole

`creative_bench(client: jake)`. Captured the same way, pasted byte for byte.

Jake is the instructive case rather than the flattering one. His bench is **2
deep** against **26 live ads**: one paused-proven ad and one produced asset with
no launched match. Tyson's, for contrast, is 23 deep. Nothing is flagged for
thinness because the shelf is not empty — but 2 behind 26 is the number worth
looking at, and until this question existed it was not written down anywhere.

```json
{
  "question_key": "creative_bench",
  "question": "One creator's creative bench: what is live now with its fatigue measurement, which proven ads are sitting paused with their best prior window and what stopped them, which finished assets have been produced but never launched, and whether any live winner has an empty shelf behind it. Facts only; it names the signed decision tree and gives no verdict.",
  "params": {
    "client": "jake",
    "date_from": "2026-07-25",
    "date_to": "2026-08-07",
    "lookback_days": 180
  },
  "answers": {
    "client": "jake",
    "live_window": {
      "from": "2026-07-25",
      "to": "2026-08-07"
    },
    "lookback_window": {
      "from": "2026-02-09",
      "to": "2026-08-07"
    },
    "units": "Money is in USD CENTS. Collected ROI is a multiple.",
    "thresholds_applied": {
      "from": "registry_definitions, at answer time",
      "paused_proven_min_collected_roi": 2,
      "kpi_line_min_collected_roi": 2,
      "evidence_floor_usd_cents": 10000,
      "creative_bench_version": 1
    },
    "live": [
      {
        "ad_id": "120249900300020185",
        "keyword": "badge",
        "ad_name_verbatim": "BADGE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 67553,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 57,
        "booked": 5,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-08",
        "days_live": 12,
        "content_known": true,
        "creative_type": "video",
        "fatigue": {
          "cost_per_result_rising": true,
          "ctr_falling": false,
          "sustained_hours": 72,
          "cost_per_dm_before_usd_cents": 1146,
          "cost_per_dm_now_usd_cents": 1758,
          "link_ctr_before": 0.00252,
          "link_ctr_now": 0.00272
        },
        "fatigue_note": "Measured over the last 72 hours against the 72 before them, per touch_floor_72h v1. The same measurement kill_scale_read applies, read from the same implementation."
      },
      {
        "ad_id": "120249893866080185",
        "keyword": "primed",
        "ad_name_verbatim": "PRIMED",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 2022,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 3,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-07",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900218780185",
        "keyword": "prep",
        "ad_name_verbatim": "PREP",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 620,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-06",
        "days_live": 10,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900236500185",
        "keyword": "intake",
        "ad_name_verbatim": "INTAKE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 615,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-07",
        "days_live": 11,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900283690185",
        "keyword": "watch",
        "ad_name_verbatim": "WATCH",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 610,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 1,
        "booked": 1,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-06",
        "days_live": 10,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900191110185",
        "keyword": "hardy",
        "ad_name_verbatim": "HARDY",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 562,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-07",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893859390185",
        "keyword": "hill",
        "ad_name_verbatim": "HILL",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 415,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-07",
        "days_live": 10,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900227140185",
        "keyword": "entry",
        "ad_name_verbatim": "ENTRY",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 350,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-06",
        "days_live": 10,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893885520185",
        "keyword": "trek",
        "ad_name_verbatim": "TREK",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 302,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-07",
        "days_live": 10,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900214780185",
        "keyword": "pass",
        "ad_name_verbatim": "PASS",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 264,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-05",
        "days_live": 9,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900202540185",
        "keyword": "shuttle",
        "ad_name_verbatim": "SHUTTLE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 235,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-03",
        "days_live": 7,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893866920185",
        "keyword": "plate",
        "ad_name_verbatim": "PLATE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 225,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-07",
        "days_live": 10,
        "content_known": false,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893879300185",
        "keyword": "loop",
        "ad_name_verbatim": "LOOP",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 220,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-07",
        "days_live": 10,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893883840185",
        "keyword": "hike",
        "ad_name_verbatim": "HIKE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 213,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-07",
        "days_live": 10,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900244180185",
        "keyword": "duty",
        "ad_name_verbatim": "DUTY",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 192,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-07",
        "days_live": 11,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893856430185",
        "keyword": "lap",
        "ad_name_verbatim": "LAP",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 163,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-08",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893871100185",
        "keyword": "field",
        "ad_name_verbatim": "FIELD",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 132,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-08",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893883070185",
        "keyword": "jog",
        "ad_name_verbatim": "JOG",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 102,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-08",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900191990185",
        "keyword": "grade",
        "ad_name_verbatim": "GRADE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 101,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-08",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900192800185",
        "keyword": "tier",
        "ad_name_verbatim": "TIER",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 87,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-07",
        "days_live": 10,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900257720185",
        "keyword": "guard",
        "ad_name_verbatim": "GUARD",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 83,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-07",
        "days_live": 11,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900272780185",
        "keyword": "serve",
        "ad_name_verbatim": "SERVE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 65,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-07-30",
        "days_live": 3,
        "content_known": true,
        "creative_type": "video",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893882270185",
        "keyword": "sure",
        "ad_name_verbatim": "SURE",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 50,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 3,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-08",
        "days_live": 12,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900194830185",
        "keyword": "circuit",
        "ad_name_verbatim": "CIRCUIT",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 46,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-08",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249900196940185",
        "keyword": "session",
        "ad_name_verbatim": "SESSION",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 36,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-07",
        "days_live": 10,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      },
      {
        "ad_id": "120249893868060185",
        "keyword": "bench",
        "ad_name_verbatim": "BENCH",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "active",
        "spend_usd_cents": 35,
        "collected_usd_cents": 0,
        "collected_roi": 0,
        "dms": 0,
        "booked": 0,
        "closes": 0,
        "first_active_day": "2026-07-29",
        "last_active_day": "2026-08-08",
        "days_live": 11,
        "content_known": true,
        "creative_type": "still",
        "fatigue": null,
        "fatigue_note": "Not measurable: one half of the 72-hour comparison had no DMs or no impressions. That is a different fact from 'not fatiguing' and is never reported as it."
      }
    ],
    "live_count": 26,
    "paused_proven": [
      {
        "ad_id": "120249900208850185",
        "keyword": "proven",
        "ad_name_verbatim": "PROVEN",
        "adset_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_name_verbatim": "Jake - TESTING",
        "delivery_state": "not_active",
        "spend_usd_cents": 15415,
        "collected_usd_cents": 120000,
        "collected_roi": 7.78,
        "dms": 26,
        "booked": 3,
        "closes": 1,
        "first_active_day": "2026-07-28",
        "last_active_day": "2026-08-08",
        "days_live": 12,
        "content_known": true,
        "creative_type": "video",
        "best_prior_window": {
          "from": "2026-02-09",
          "to": "2026-08-07",
          "basis": "The whole lookback window. For an ad that is no longer delivering this is its entire run inside that window, which is what 'what it did when it ran' means. Spend and cash use the same window on both sides, per roi_window v1."
        },
        "why_it_stopped": "Paused at the AD level. Its last spending day was 2026-08-08.",
        "signed_tree_inputs": {
          "cited_definition": "verdict_floors_kill_tree v1, through ruleset zakk_v1",
          "cleared_kpi_line_before": true,
          "kpi_line_min_collected_roi": 2,
          "evidence_floor_usd_cents": 10000,
          "fatigue": {
            "cost_per_result_rising": false,
            "ctr_falling": true,
            "sustained_hours": 72,
            "cost_per_dm_before_usd_cents": 592,
            "cost_per_dm_now_usd_cents": 573,
            "link_ctr_before": 0.00592,
            "link_ctr_now": 0.00592
          },
          "fatigue_note": "Measured, though the ad is not currently delivering.",
          "fresh_creative_tested": "UNRECORDED. Nothing in this system records whether fresh creative has been tried on this ad. It is left unrecorded rather than defaulted, because in the signed tree this is the input that decides which branch an ad of this shape lands on."
        }
      }
    ],
    "paused_proven_count": 1,
    "produced_never_launched": {
      "items": [
        {
          "factory_item_id": "aa326c16-17fc-487f-8d8f-7fdb95a45e25",
          "project": "Jake - First Responder Ads (25)",
          "label": "FR13",
          "bucket": "direct_cta",
          "style": null,
          "created_at": "2026-07-26T13:42:32.225668+00:00",
          "launched": "no_match_found",
          "copy_opening": "I'm looking for 5 people who have talked about joining police / fire / EMS for years and are sick of hearing themselves say \"next year.\"\n\n- "
        }
      ],
      "count": 1,
      "could_not_match": 33,
      "matched_to_a_launched_ad": 8,
      "projects_read": [
        "Jake - Ad Backgrounds",
        "Jake - First Responder Ads (25)",
        "Jake - Lead Magnet Winners (8/4)"
      ],
      "how_this_was_counted": "Every finished asset in this creator's production projects was compared against the stored copy of every launched ad in the lookback. An asset counts as launched only when a launched ad's copy matches its opening text. no_match_found means nothing in the launched record matches it: that is strong evidence it was never run, not proof, because an ad launched with rewritten copy would not match.",
      "what_this_cannot_see": "Creative that exists only as files outside this system. Those are invisible to this door and are named here rather than counted as an empty shelf."
    },
    "bench_thinness": [],
    "bench_depth": 2,
    "what_this_is": "The standing inventory of what can be put in market, stated as facts. Nothing here ranks, rates or recommends. Where the signed decision tree would want an input this system does not record, the item says so instead of defaulting it."
  },
  "definitions_quoted": [
    {
      "key": "spend",
      "label": "Ad spend",
      "meaning": "How much Meta charged to run this ad across the selected days.",
      "source": "Meta, bucketed to Eastern-time days.",
      "format": "usd",
      "is_calculated": false
    },
    {
      "key": "messages",
      "label": "DMs",
      "meaning": "How many different people sent this ad's keyword in a DM.",
      "source": "ManyChat keyword events, counted as distinct people.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "booked",
      "label": "Calls booked",
      "meaning": "How many different people booked a strategy call from this ad's keyword in this window, counted on the day they booked it.",
      "source": "GoHighLevel sales-calendar bookings that carry the keyword, counted as distinct people on the day the booking was made (not the day the call is scheduled for), with reschedules grouped under one person.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "newClients",
      "label": "New clients",
      "meaning": "How many of those calls became a paying client.",
      "source": "The sales tracker wins.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "collected",
      "label": "Collected revenue",
      "meaning": "Cash actually collected from clients tied to this ad's keyword.",
      "source": "The sales tracker, tied to a keyword by hard key only.",
      "format": "usd",
      "is_calculated": false
    },
    {
      "key": "collectedRoi",
      "label": "Collected ROAS",
      "meaning": "The cash collected for every dollar of ad spend, shown as a multiple.",
      "source": "Collected revenue divided by ad spend.",
      "format": "ratio2",
      "is_calculated": true
    }
  ],
  "as_of": [
    {
      "source": "ad_creative_copy",
      "last_written_at": "2026-08-08T08:20:52.568628+00:00",
      "note": "When this creator's newest still-image OCR and caption were stored."
    },
    {
      "source": "ad_creative_transcripts",
      "last_written_at": "2026-08-08T10:42:19.227+00:00",
      "note": "When this creator's newest video read was stored. Video reads are kept current by the two-hourly creative cron."
    }
  ],
  "sources": [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "ad_creative_copy",
    "ad_creative_transcripts",
    "ad_creative_image",
    "factory_items",
    "registry_definitions"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "creative_bench",
    "question_version": 1,
    "asked_at": "2026-08-08T10:44:01.214Z",
    "caller": "report",
    "params_as_resolved": {
      "client": "jake",
      "date_from": "2026-07-25",
      "date_to": "2026-08-07",
      "lookback_days": 180
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-25",
      "to": "2026-08-07",
      "kind": "trailing_decision_window"
    },
    "data_version": 413,
    "freshness": [
      {
        "source": "ad_creative_copy",
        "last_written_at": "2026-08-08T08:20:52.568628+00:00",
        "note": "When this creator's newest still-image OCR and caption were stored."
      },
      {
        "source": "ad_creative_transcripts",
        "last_written_at": "2026-08-08T10:42:19.227+00:00",
        "note": "When this creator's newest video read was stored. Video reads are kept current by the two-hourly creative cron."
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 5,
      "window_cash_usd_cents_total": 539900,
      "buckets": {
        "ad": {
          "wins": 1,
          "cash_usd_cents": 120000
        },
        "organic": {
          "wins": 0,
          "cash_usd_cents": 0
        },
        "misc_chat": {
          "wins": 0,
          "cash_usd_cents": 0
        },
        "awaiting_review": {
          "wins": 4,
          "cash_usd_cents": 419900
        }
      },
      "classified_pct_wins": 20,
      "classified_pct_cash": 22.2,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 4 of the 4 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 2 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read."
    },
    "exclusions": [
      {
        "what": "creative assets that live only as files outside this system",
        "count": 0,
        "why": "the produced shelf reads the production stores in the database. A folder of images on someone's laptop is not visible to this door, and it is named as an unknown rather than counted as an empty shelf."
      },
      {
        "what": "whether fresh creative has already been tested on an ad",
        "count": 0,
        "why": "nothing in this system records it. It is reported as unrecorded per item rather than defaulted, because a default here would quietly decide the branch a reader lands on."
      }
    ],
    "caveats": [
      "This is an inventory, not a decision. The bench states what exists and cites the signed tree those facts feed; the judgement belongs to whoever is reading it, under a ruleset they name.",
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-08-07, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "pricing_currency v1: One price book across creators: 3-month $1,200; 6-month standard $2,400 with frequent $2,200 closes (closer-level flexibility; the tracker is the record). Revenue reports in USD. Jake's ad account bills in AUD; spend converts at the synced fx rate. Non-USD sale rows convert at sale-date fx.",
      "Jake's ad account bills in AUD, so his spend in this answer has been converted to USD at the synced rate, while the sale money was already USD and was never converted.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "4 wins worth 4199.00 USD in this window are still awaiting review, so 20% of wins and 22.2% of cash are classified. This answer is not a claim of full coverage."
    ],
    "certainty": "directional",
    "definitions_cited": [
      {
        "registry": "warehouse.definitions",
        "name": "spend"
      },
      {
        "registry": "warehouse.definitions",
        "name": "collected"
      },
      {
        "registry": "warehouse.definitions",
        "name": "collectedRoi"
      },
      {
        "registry": "warehouse.definitions",
        "name": "messages"
      },
      {
        "registry": "warehouse.definitions",
        "name": "booked"
      },
      {
        "registry": "warehouse.definitions",
        "name": "newClients"
      },
      {
        "registry": "registry_definitions",
        "name": "sales_lag",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "pricing_currency",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "coverage",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "creative_bench",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "verdict_floors_kill_tree",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "structure_rules",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "ruleset_zakk",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "scaling_ladder",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "decision_cadence",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "daily_run_rate",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "touch_floor_72h",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "learning_phase_awareness",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "roi_window",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "unit_economics",
        "version": 1
      }
    ]
  },
  "note": "This is an inventory, not a decision. The bench states what exists and cites the signed tree those facts feed; the judgement belongs to whoever is reading it, under a ruleset they name."
}
```

---

## Not in this brick

No person/bridge work (Brick 5), no funnel questions (Brick 6), no workers
(Brick 9), no new creative generated, no Meta writes, no new cron.
