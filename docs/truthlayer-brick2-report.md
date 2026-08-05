# Truth Layer, Brick 2: Answer Receipts + Door Plumbing

**Built 2026-08-05. Migration 075. Branch `truthlayer-brick2`.**

Brick 1 gave the door registries to resolve names against. Brick 2 makes the door's ANSWER carry its own proof.

The concrete failure this kills: an AI reported "100% attribution coverage" because its hand-written query silently excluded 26 unassigned wins worth $31,395. After this brick, every money answer states its own coverage in four signed buckets, and the awaiting-review gap is impossible to leave out.

**Zero new questions.** The locked list is still the same twelve. No template's numbers changed.

---

## The finding that shaped the whole brick

While hand-verifying the coverage numbers I found this, and it changed the design:

> **Every single awaiting-review win in the database carries `client_key = NULL`.**
> All 46 of them. Not most: all.

That is correct behaviour. Nobody has looked at those rows yet, so the engine refuses to guess whose they are. But it means the obvious implementation of a coverage block, filtering `client_key = 'tyson'`, would find **zero** awaiting-review wins and report **100% coverage, every single time**.

I would have rebuilt the exact bug this brick exists to prevent, inside the fix meant to prevent it.

So `door_coverage_block` does this instead: the classified buckets are scoped to the creators asked about, and **the awaiting-review bucket always includes the client-less pool**. Those wins have no creator precisely because they are unclassified, and they are the gap the reader needs to see. The answer's note says so in plain words rather than leaving anyone to work it out.

Live, right now, for Tyson's trailing 14 days: **85% of wins and 86.1% of cash classified**, not 100%.

---

## What changed

### Migration 075 (`supabase/migrations/075_door_receipts.sql`)

Additive and idempotent. Applied to `bostjayrguulwaltnbgt`.

| Object | What it is |
|---|---|
| `door_miss_log` | One row per refused question. The certification backlog. RLS on, no anon policies. |
| `door_ask_log` | One row per ask that named a real question, answered or not. The usage record. |
| `door_freshness_thresholds` | When a source counts as stale. 12 seeded rows, `ON CONFLICT DO NOTHING` so a tuned value is never stamped back. |
| `door_coverage_block(clients, from, to)` | The ONE implementation of the four signed buckets. `SECURITY DEFINER`, `STABLE`, single pass. |
| `door_miss_backlog(limit)` | Refused questions grouped and counted, most-asked first. |
| `adsv2_sale_facts_win_day_idx` | Partial index on `(sale_et_day) WHERE is_win`, for the coverage scan. |

Thresholds are stored in a table and deliberately **not** signed definitions. A signed definition is a promise about meaning; a threshold is a setting about cron cadence. Conflating the two would cheapen the registry, and it means ops can tune one without a deploy.

### Bucket priority

Rows can satisfy more than one rule, so priority is fixed and explicit:

1. **awaiting_review** — nobody has looked; the honest gap
2. **organic** — `is_organic`, OR the keyword is in `registry_keywords` for that client
3. **ad** — a keyword, and not organic
4. **misc_chat** — no keyword, and the team's own `callType` label

Organic is tested **before** ad on purpose: a marked organic keyword whose `is_organic` flag is not set would otherwise count as an ad sale and enter ad ROAS, which `organic_keywords v1` forbids. That is not hypothetical (see findings below).

A win that fits no rule at all falls into `awaiting_review` rather than being dropped. Coverage may understate itself; it may never overstate itself.

### Code

| File | Change |
|---|---|
| `types.ts` | `AnswerReceipt`, `CoverageBlock`, `StaleSource`, `AnswerExclusion`, `ReceiptDeclaration`, `AliasTrail`. `DoorAnswer` gains `receipt`. Every existing field keeps its name and meaning. |
| `receipts.ts` (new) | Coverage read, caveat auto-rules, staleness, roster read, assembly. |
| `params.ts` | `resolveEntity` / `resolveEntityOrThrow` via `registry_resolve_entity`, per-ask cache. `requireAccount` / `requireClient` are now async and resolve aliases. |
| `service.ts` | Caller identity, both logs, receipt assembly, `describeMisses`. |
| `registry.ts` | All 12 questions declare `receipt`. All 8 param call sites awaited. |
| `utari-adapter.ts`, `api/mcp/utari`, `api/questions`, `accuracy/checks.ts` | Caller tags: `utari`, `app`, `accuracy`. |
| `api/questions` | `GET ?misses=1` returns the backlog. |

### Caveat auto-rules

Derived, never authored per call. A template cannot talk its way out of a caveat and cannot invent one.

1. Window ends within 14 days → quote `sales_lag v1`, say the window understates itself
2. Any source past its threshold → name it
3. Answer covers a non-USD ad account (jake) → quote `pricing_currency v1`
4. A former creator named → quote `former_creators v1`
5. Roster came from the fallback list → say so
6. Any awaiting-review wins → quote `coverage v1` and state the gap in dollars

---

## Test output, verbatim

### Door suite — 56 tests (35 pre-existing, all unmodified, plus 21 new)

```
ℹ tests 56
ℹ suites 0
ℹ pass 56
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 320.128875
```

The 21 new ones:

```
✔ every answer carries a receipt, and a money answer's coverage block sums exactly
✔ the gap is stated as a caveat, not just left sitting in a number
✔ a question that touches no sale row carries no coverage block, and says nothing about coverage
✔ a creator asked for by any declared alias is answered, and the receipt shows the hop
✔ a name already canonical is not reported as an alias that was resolved
✔ a former creator is refused BY NAME once the registry has identified them
✔ a name the registry has never heard of is still refused, never repaired by guessing
✔ a refused question is written to the miss log, with the caller
✔ an answered question is written to the ask log
✔ a logging failure never costs the caller their answer or their refusal
✔ the caller defaults to unknown rather than to a guess
✔ a source past its threshold is named in the receipt and in the caveats
✔ a source inside its threshold is not flagged
✔ a window ending inside the sales lag carries the understatement caveat
✔ asking about jake carries the AUD conversion note, because his ad account bills in AUD
✔ a standing note stays on note AND appears in the caveats, so no caller loses a field
✔ every question declares a receipt, and every money question can produce coverage
✔ a money answer is REFUSED rather than shipped when its coverage cannot be read
✔ the roster comes from the registry when the caller does not supply one
✔ a registry the door cannot read falls back, and the answer SAYS it fell back
✔ describeDoor now reports each question's version
```

### Golden fixture — against the REAL database, not a fake

```
✔ GOLDEN: the coverage block reproduces the hand-verified 2026-07-18 to 2026-07-31 tyson window (500.155125ms)
✔ GOLDEN: the unassigned win is counted even though the question named one creator (318.247375ms)
✔ GOLDEN: the 4 LOCKED organic sales show up across 2026-06-24 to 2026-07-31 (1186.704083ms)
✔ GOLDEN: the four buckets sum exactly to the totals, across several real windows (2346.502416ms)
✔ GOLDEN: every declared alias resolves to one canonical creator, against the real registry (1958.320833ms)
ℹ tests 5
ℹ pass 5
ℹ fail 0
```

These live in their own file (`coverage.golden.test.ts`) because every other test in the folder runs against a constructed database, which is right for pinning behaviour and **useless for pinning numbers**: a fake that returns what the code expects proves only that the code agrees with itself. The golden file skips loudly when credentials are absent, so it can never pass by not running.

The hand-verified fixture, computed in SQL before the test existed:

| bucket | wins | cash (cents) |
|---|---|---|
| ad | 17 | 2,509,500 |
| organic | 1 | 220,000 |
| misc_chat | 0 | 0 |
| awaiting_review | 1 | 199,900 |
| **total** | **19** | **2,929,400** |

Classified: 94.7% of wins, 93.2% of cash.

### Full repo suite

```
ℹ tests 216
ℹ pass 215
ℹ fail 1
ℹ skipped 0
```

The single failure is **pre-existing and unrelated**: `ads-tracker-export.html inline app compiles (browser-equivalent Babel parse)`. I verified it fails identically on a clean worktree of `origin/main` at `806f02d` with none of my changes present. It is the shared-file hazard already noted for `public/ads-tracker-export.html`. I did not touch that file and did not fix it, since it is outside this brick.

---

## One full receipt, pasted whole

Real answer, real data, `metric_value` for Tyson's saved trailing 14-day window, asked as `tyson_sonnek` to exercise alias resolution.

```json
{
  "contract_version": 2,
  "question_key": "metric_value",
  "question_version": 1,
  "asked_at": "2026-08-05T06:10:15.868Z",
  "caller": "mcp",
  "params_as_resolved": {
    "client": "tyson",
    "date_from": "2026-07-23",
    "date_to": "2026-08-05",
    "status": "all",
    "scope": "total",
    "metrics": ["spend", "messages", "booked", "newClients", "collected", "collectedRoi"]
  },
  "aliases_resolved": [
    { "given": "tyson_sonnek", "resolved_to": "tyson" }
  ],
  "window": { "from": "2026-07-23", "to": "2026-08-05", "kind": "saved_window" },
  "data_version": 331,
  "freshness": [
    {
      "source": "warehouse.answers",
      "last_written_at": "2026-08-05T05:26:02.446+00:00",
      "note": "the newest saved window answer at the version the tab is serving"
    }
  ],
  "stale": [],
  "coverage": {
    "window_wins_total": 20,
    "window_cash_usd_cents_total": 2879400,
    "buckets": {
      "ad": { "wins": 16, "cash_usd_cents": 2259500 },
      "organic": { "wins": 1, "cash_usd_cents": 220000 },
      "misc_chat": { "wins": 0, "cash_usd_cents": 0 },
      "awaiting_review": { "wins": 3, "cash_usd_cents": 399900 }
    },
    "classified_pct_wins": 85,
    "classified_pct_cash": 86.1,
    "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 3 of the 3 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 1 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read."
  },
  "exclusions": [
    {
      "what": "anything outside the saved window, or outside the status asked for",
      "count": 0,
      "why": "this question returns a saved answer verbatim. It excludes nothing WITHIN its window; the window and the status are the whole of its scope."
    }
  ],
  "caveats": [
    "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
    "This window ends 2026-08-05, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
    "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
    "3 wins worth 3999.00 USD in this window are still awaiting review, so 85% of wins and 86.1% of cash are classified. This answer is not a claim of full coverage."
  ],
  "certainty": "machine_certain",
  "definitions_cited": [
    { "registry": "warehouse.definitions", "name": "spend" },
    { "registry": "warehouse.definitions", "name": "messages" },
    { "registry": "warehouse.definitions", "name": "booked" },
    { "registry": "warehouse.definitions", "name": "newClients" },
    { "registry": "warehouse.definitions", "name": "collected" },
    { "registry": "warehouse.definitions", "name": "collectedRoi" },
    { "registry": "registry_definitions", "name": "sales_lag", "version": 1 },
    { "registry": "registry_definitions", "name": "coverage", "version": 1 }
  ]
}
```

That last caveat is the whole brick in one line. The old failure mode was an answer that said 100%. This one says 85%, in dollars, without being asked.

---

## Honest findings

### 1. `is_organic` is FALSE on every organic-keyword win

All 5 organic wins in the database (4 Tyson LOCKED plus 1 more) have `is_organic = false`. The registry keyword list is doing **100% of the organic classification work**.

Without the belt-and-suspenders rule the spec asked for, all 5 would have counted as ad sales and entered ad ROAS, which `organic_keywords v1` explicitly forbids. The belt-and-suspenders rule was not redundant; it was the only thing working.

Worth someone checking whether commit `b054582` ("classify marked organic-keyword sales as organic") is setting the flag where it was meant to. **I did not touch it** (the labeler is out of scope for this brick).

### 2. The client-scoped organic rule is right, and I nearly got it wrong

`ready` appears **twice** in `registry_keywords`:

- `ready` / **tyson** / type `ad` / retired / used 2026-04-12 to 2026-06-17
- `ready` / **jake** / type `organic` / active / from 2026-07-24

There is one Tyson win on 2026-06-12 with keyword `ready` ($1,200, `method=link_dm`, `evidence_key=subscriber_id`). It sits squarely inside Tyson's ad run, six weeks before Jake's organic use began. It is a genuine **Tyson ad sale**.

My first hand-count used a flat keyword list and classified it organic, which was wrong: it would have stripped $1,200 out of ad ROAS. The client-scoped rule the spec specified gets it right. I corrected my own fixture rather than the code.

Side note: this means `keyword_uniqueness v1` ("all-time-unique across ALL clients") is not literally true of the registry's historical rows. The uniqueness law was armed on 8/2 for **new** keywords; `ready` and `locked` both predate it under multiple clients. Not a bug, but the law and the data disagree about the past, and a future certified answer that assumes global uniqueness would be wrong.

### 3. misc_chat is structurally 0, and test (e) could not pass as written

The spec's test (e) expected `misc_chat > 0` for Tyson 6/24 to 7/31. It cannot be, against real data.

Every misc-chat win with no keyword is **also** `awaiting_review = true`, and the spec's own priority rule says awaiting-review wins the overlap. So `misc_chat` is 0 everywhere and the overlap is nonzero:

| window | awaiting_review wins | of which already labeled Miscellaneous Chat |
|---|---|---|
| tyson 6/24 to 7/31 | 22 | 6 |
| all wins, all time | 46 | 18 |

I implemented the spec's rule (it is the conservative one: it understates coverage rather than flattering it) and **report the overlap count on every answer** instead. The test asserts the overlap is surfaced rather than asserting an impossible number. Per the brief, I did not touch the labeler. When labeler part D lands, those 18 rows move to misc_chat and coverage will rise.

### 4. A real defect the tests caught in my own code

My first version of the fire-and-forget logging attached only a `.catch()` to the insert promise. But `db.from(table).insert(row)` can throw **synchronously**, before any promise exists, and a `.catch()` never runs in that case. A logging failure would have broken the caller's answer, violating the exact law I had just written.

Fixed with a `try`/`catch` around the call itself, and pinned by the test `a logging failure never costs the caller their answer or their refusal`.

### 5. A caveat that fired when it did not apply

The first end-to-end receipt carried Jake's AUD conversion note on a **Tyson-only** question, because I had scoped the rule to the whole active roster rather than to whom the answer actually covers.

A caveat that fires when it does not apply trains the reader to skip caveats, which costs more than the caveat was ever worth. Fixed: the service now computes the creators an answer actually covers once, and both the coverage scope and the caveat rules read that. Verified live: fires for `jake` and `all`, not for `tyson`.

### 6. The audited "40 tyson ad wins" is now 41

Brick 1's 8/2 audit recorded 40 Tyson-classified ad wins since 6/24. It is now **41** (plus 4 organic), because a sale landed between then and now. Expected drift, not a discrepancy. The golden fixture uses a different, tighter window (7/18 to 7/31) and was hand-verified fresh on 2026-08-05.

### 7. Things I could not verify

- **`data_version` trust depends on the sync double-fire.** The receipt reports `data_version` faithfully, but `/api/cron/ads-v2-sync` still runs twice every :25 and the loser dies on a duplicate key. Wasteful rather than corrupting, but a receipt that stamps a version is only as trustworthy as the version. That is Brick 4's trust pack, deliberately not fixed here.
- **Latency under the accuracy check's load.** A money answer now costs one extra RPC (`door_coverage_block`); roster, thresholds and signed definitions are cached for 60 seconds so a burst of asks pays for them once. The accuracy check asks the door 72 times per run and previously took 76 seconds. I did not re-run a full accuracy pass against production to measure the new total, so the added cost there is reasoned rather than measured.
- **`sales_tracker_rows` and `dm_conversation_messages` thresholds** are seeded but never compared, because `question_door_freshness()` does not report those two sources. Harmless and ready if they are added.
- **The `.insert` behaviour of the real Supabase client under RLS** was verified live for both logs (rows written and read back), then my synthetic verification rows were deleted so they do not pollute the real backlog.

---

## Deliberately not in this brick

No new questions (Brick 3 = `kill_scale_read` + `health_check`). No skill or enforcement changes (Brick 8). No identity bridge (Brick 5). No sync double-fire fix (Brick 4). No labeler changes.

## Verification note on the join

The spec asked for `door_coverage_block` to join `sales_tracker_rows` for `callType`. It reads the **stamped** `adsv2_sale_facts.call_type` column instead, because that column already exists and Law 4 says read the stamped facts rather than recompute from raw.

I checked the two agree before relying on it: across all 123 wins, **121 match exactly**, 0 fail to join, and the 2 differences are `NULL` versus empty string. Neither is `'Miscellaneous Chat'`, so the bucketing is identical and the join would have cost a scan for nothing.
