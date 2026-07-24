# Ads v2 — Fix round 3 + Piece 2 report

Every item below was built to the original Ads v2 laws (store-only serving,
precomputed snapshots, ET-native, money in cents, one definitions registry that
powers both hovers and the gear panel, no request-path compute, count people not
paperwork, plain language, no em dashes). New standing law honored: any commit
that changed a computation updated that entry's plain-English sentence in the
same commit (Registry Currency).

Tri-state header sorting from the parallel session was pulled in via rebase and
left untouched (the `cycleSort` default -> asc -> desc -> default cycle).

Verification was done against the live database and in a real browser through the
public share route (which is unauthenticated), plus the unit + coverage tests
and a full typecheck. All 40 ads-v2 unit tests pass; `tsc --noEmit` is clean.

---

## PART A — fixes

### A1. DMed dates on bookings (was 0 of 55 wired)

Booking -> subscriber is resolved by HARD KEY only, in priority order: (a) the
appointment's own `raw_payload.manychat_user_id`, (b) the stored ManyChat<->GHL
bridge (`manychat_contact_links`), (c) the Foundation identity graph
(`person_context`, hard links only, never name-linked), (d) a bridged sale
paste. Then `dm_et_day` = the person's earliest `dm_keyword` event for the ad's
keyword (ANY date, not window-limited), else their earliest at all. Set-based SQL
(`adsv2_stamp_booking_links`), run in the facts pass and backfilled over all
history. Never name matching.

Populated counts for last-30-day bookings (not organic, not awaiting):

| client | bookings | with DMed date BEFORE | AFTER |
| --- | --- | --- | --- |
| tyson | 67 | 16 (23.9%) | 35 (52.2%) |
| jake  | 0 (no sales calendar connected yet) | 0 | 0 |

Majority now populate. Every dash is a genuine no-hard-key case: of 79 booking
rows, 47 resolve to a subscriber and ALL 47 have an all-time DM event, so a dash
means the booking could not be tied to a ManyChat identity by any hard key (the
real attribution ceiling, not a missing join). The popup confirmed it live, e.g.
Chase Young DMed 7/19, and one un-resolvable person shows "-".

### A2. Show rate rebuilt cohort-true

Root cause confirmed: the old cell used `taken_people` (distinct people with a
TAKEN sale in the window, a different cohort) while the popup listed the window's
BOOKED people, so carryover people made the cell claim more showed than the
popup listed. Rebuilt so the cell and popup are the SAME booked-in-window cohort,
aggregated per person (a taken call outranks an upcoming reschedule):
`showed_people` = people BOOKED in the window (not upcoming) with a hard-key
linked taken record; denominator = booked minus upcoming.

The exact broken case, re-tested against live data (last 30 days, Tyson). The old
sale-cohort numerator produced impossible show rates; the new booked-cohort
numerator never exceeds the denominator:

| keyword | booked | due | OLD numerator / % | NEW numerator / % |
| --- | --- | --- | --- | --- |
| gym | 8 | 8 | 9 / 113% (BUG) | 0 / 0% |
| strength | 6 | 6 | 7 / 117% (BUG) | 2 / 33% |
| good | 6 | 6 | 9 / 150% (BUG) | 0 / 0% |
| base | 1 | 1 | 2 / 200% (BUG) | 0 / 0% |
| healthy | 1 | 1 | 2 / 200% (BUG) | 0 / 0% |
| fit | 28 | 27 | 21 / 78% | 7 / 26% |

Every new value is <= 100%. (The new numbers are honestly lower because a
"showed" now requires a hard-key linked taken record; a booked call with no
provable taken record is "no outcome yet", never a show.)

Cell/popup parity, verified live in the browser on the STRENGTH show-rate hover:
header read **"2 of 4 showed  ·  50%"**, exactly matching the cell's 50.0%, with
2 Showed + 2 "No outcome yet" + 0 Upcoming. "No outcome yet" is never counted as
a show.

Parity assertion (leaves vs an independent per-person recompute
`adsv2_showrate_cohort`): **0 mismatches**. Unit tests: cohort status logic +
the cell==popup identity. Nightly self-check gate `showRateParityViolations = 0`.

Registry sentences for **show rate** (cohort meaning, never passes 100%) and
**calls taken** (period meaning, counted by call day, can differ from the
show-rate group) were updated in the same commit as the computation.

### A3. Selection scopes lower levels

With campaigns selected, the ad-set level shows only their ad sets and the ad
level only their ads; ad-set selection scopes the ad level; clearing restores the
full view. The scoped TOTAL is computed over the displayed rows.

Verified live: selecting the SCALING campaign then opening the ad-set level
showed only SCALING's 3 ad sets, and the TOTAL row read **$1,736 / 134,574
impressions / 1,193 clicks** — exactly the SCALING campaign row from the
campaign level. At the ad level the same selection showed only SCALING's ads with
the same total.

Permanent consistency assertion: `checkParentChildSums` verifies, for every
snapshot, that the sum of a campaign's ad sets equals the campaign and the sum of
an ad set's ads equals the ad set, for every additive metric. Nightly gate
`parentChildViolations = 0`. Unit test covers it too.

### A4. Date format month/day, no year, no leading zeros

`fmtMD` splits the stored ET-day STRING (never a Date object), so it is
viewer-timezone-proof. Verified live in the show-rate popup: DMed 7/19, Booked
7/21, Call 7/22. Applied to DMed, Booked, and Call in all call-metric popups.

### A5. Column colors at every level in the base state

Root cause: the row-type selectors (`tr.ad-row td`, `tr.total-row td`) set a
neutral text color at higher specificity than a plain `.pos`/`.neg`, swallowing
the green/red on ad-set, ad, and total rows. Added table-scoped rules that match
that specificity and win. Verified live mouse-untouched: CPM, CTR, and CPC show
red (neg) at the campaign, ad-set, ad, AND total rows. Hover still changes only
the cell background, ported from v1.

### A6. Settings gear size

Replaced the small emoji with an 18px line-icon gear (matching the sidebar's
18px lucide Settings glyph) in a 34px square with radius 8px — the sidebar's
rendered size and comfortable hit area, styled naturally in the header.

### A7. Name column full-text auto-fit

Every level defaults to the full name, auto-fit to the longest visible name
(canvas-measured, capped at a sane max). Dragging the handle pins a width per
level; double-clicking the handle resets that level to auto-fit; auto-fit re-runs
on level/filter change unless manually resized. Removed the old fixed 340px cap
that truncated long names.

---

## PART B — public share link

- `/p/ads-v2/<token>` renders the exact Ads v2 tab for the token's client with no
  account dropdown, the gear opening only "How your numbers work", and no CCOS
  chrome. Verified live: Tyson-only data, no sidebar, no dropdown, identical
  table/levels/sorting/hovers/popups/colors.
- Tamper-proof: the client is derived SOLELY from the token; a request with
  `?account=jake` still returned Tyson data (`account: tyson`). The client is
  fail-closed to a served creator key.
- The Sidebar already returns null for `/p/`; `p/ads-v2` was added to the proxy
  matcher and to AccessGate's public list. `X-Robots-Tag: noindex, nofollow`
  header present, plus `Cache-Control: no-store`; simple per-token rate limit;
  explicit maxDuration.
- Operator management in the v2 gear (Share links tab): per client, current link
  with copy, Rotate (revoke + mint, confirmed) and Revoke, via an auth-gated
  `/api/ads-v2/share-link`. The owner never touches tokens by hand.
- Served from the same snapshot read path as the authed tab.

---

## PART C — video ad previews from our own storage

- Data layer, one hard rule: Meta's video source URLs expire, so we never store
  or serve the URL. `runMediaSync` resolves each video ad's creative -> video id
  -> video source, downloads the high-res thumbnail AND the playable video file
  into our own storage (chunk-streamed with a per-file size cap, a per-run
  wall-clock budget, and a per-run total-bytes budget), and records the stored
  urls on `ad_creative_image`. Active video ads are backfilled first, then
  newest; already-stored ads are skipped; coverage is logged per run. Wired into
  the sync AFTER precompute, fully isolated. (Runs in production where the
  creator Meta token is present; it never touches the request path.)
- The table uses stored thumbnails only (the leaves function surfaces the durable
  thumbnail + a video flag + the stored video url). The video file loads only on
  play.
- Hovercard: stays open while the pointer is over the ad name OR the card, with a
  250ms grace between them; clicking the name pins it and reveals a play button;
  Escape or a click outside closes it; inline playback with standard controls; an
  uncached video shows the thumbnail plus a "video not cached yet" note.
- Verified live: the card opens on name hover with the stored thumbnail + ad
  name; the payload carries `hasVideo` + the stored `videoUrl` (play button) or
  null (the not-cached note) per ad. No placeholder emoji in ad rows.

---

## PART D — Metrics section (v1, minus three changes)

- Ported v1's two-column card board with smooth inline-SVG line charts (gradient
  fill, hover readout), an Add/remove modal, an Edit mode, and drag-to-rearrange.
  Order persists per browser and is saved ONCE on drop.
- Three content changes: Cost per DM is OVERALL only (no by-keyword toggle),
  verified live ("$9.06 — Overall spend behind one DM"); CAC has no broken "$50"
  element; Potential ROAS is not in the build (a coverage test asserts it is
  absent).
- Charts come from the snapshot by design: the snapshot build now also stores a
  per-ET-day series (`adsv2_window_days`) in `metrics_payload` on the SAME
  snapshot row at the SAME data_version. The client lazily fetches it after the
  table paints and only paints it when its data_version matches the table's.
  Nothing computes from raw tables at request time.
- Card <-> table agreement (one example): the **Ad spend** card read **$2,698**,
  exactly the table's TOTAL Ad spend for the same window.
- Add-metric selection states corrected: SELECTED = darker fill + gold accent
  border + a visible checkmark; unselected = neutral subtle outline; hover
  distinct. Verified live (selected border `rgb(169,130,63)` + check svg;
  unselected neutral outline + "+").
- Every card has a registry entry (sentence + source + computation) in
  `cards.ts`; it renders in the gear "How your numbers work" panel and as a card
  hover, and a coverage test checks every card. The board renders read-only in
  the share-link view too (verified: 8 cards with numbers + charts).

---

## PART E — "How this app protects itself"

A third gear section pairs each protection with a LIVE status from the app's real
records; a protection is listed only when a machine-checked proof sits beside it,
and a check that has not run is omitted, never faked. After the new self-check
gates ran their first pass, all eight protections are live and green with nothing
omitted:

```
[OK] computed_once     -> Last built under an hour ago
[OK] nightly_recheck   -> All checks passed under an hour ago
[OK] cell_popup_parity -> Matched everywhere under an hour ago
[OK] parent_child_sum  -> Sums held under an hour ago
[OK] alerts_not_hiding -> 0 open flags
[OK] scheduled_syncs   -> funnel under an hour ago, budgets under an hour ago
[OK] et_native         -> 0 mismatched spend rows
[OK] bounded_jobs      -> Slowest recent job 36s
omitted: []
```

It renders read-only in the share-link view too (verified live). No new checking
machinery was built beyond the parity and parent-child assertions ordered in
Part A.

---

## Self-check gates (nightly), run live with the new code

```
etDay 2026-07-24
  showRateParityViolations: 0
  parentChildViolations:    0
  unmarkedSpendRows:        0
  invariantViolations:      0
  cronViolations:           0
  keywordlessBookingsLast7: 11   (info: a capture gap to fix at source)
```

## Migrations
- 061 — booking hard-key links (dm_et_day + taken) + cohort-true leaves + parity RPC
- 062 — metrics day series (`adsv2_window_days` + `metrics_payload`)
- 063 — durable video media columns + leaves surfacing the stored video

## Registry coverage
- `definitions.test.ts` — every displayed column has a registry entry.
- `cards.test.ts` — every metric card has a sentence + source + computation, ids
  unique, all defaults present, Potential ROAS absent.
