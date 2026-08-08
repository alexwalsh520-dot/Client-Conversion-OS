# Truth Layer, Brick 6: The Funnel Pack (+ the Brick 8 remainder)

**Built 2026-08-08. Branch `truthlayer-brick6`, off `origin/main` at `82e9848`.**

Four read-the-business questions that complete the daily and weekly operating
picture, plus the small remaining Brick 8 wiring. The locked list goes **17 to
21**. Every one of the four is a pure read over stores that already existed:
**no migrations were needed and none were written** (090-094 were reserved for
this brick and are left unused, so Bricks 5 and 7 are unaffected).

---

## What shipped

| # | Question | What it answers |
|---|---|---|
| 20 | `creator_funnel(client, window?)` | spend → DMs → booked → taken → shown → closes → cash, with the rate and cost at every stage, against the creator's own prior equal window. Booked and taken always side by side with the gap named. |
| 21 | `portfolio_pace(client\|all)` | calendar month-to-date + prior full month (the LEVEL) alongside the trailing 8-week shape (the TREND). Extrapolation only as a labelled trend line. |
| 22 | `budget_map(client\|all)` | every dial holding money right now, verbatim name and id, reconciled to yesterday's real spend, totals per creator and overall, staleness flagged. |
| 23 | `scale_headroom(client)` | which ad sets earned more budget, how much, and **on what date the raise is allowed**. Never a step for a dial that moved inside 7 days. |

**Brick 8 remainder:** `describe_misses` exposed as an MCP tool; `X-Door-Caller`
header accepted and threaded to receipts and both logs; the `ask_question`
envelope now carries the standing freestyle sentence.

### Files

- **New:** `leaves.ts` (the shared certified leaf read), `creator-funnel.ts`,
  `portfolio-pace.ts`, `budget-map.ts`, `scale-headroom.ts`,
  `brick6.golden.test.ts`.
- **Touched, additively:** `registry.ts` (four entries + imports),
  `kill-scale.ts` (leaf read lifted into `leaves.ts`; one pre-existing defect
  fixed, below), `api/mcp/utari/route.ts` (Brick 8 wiring),
  `brick3.golden.test.ts` and `brick4.golden.test.ts` (the locked-list count,
  17 → 21, which is the one assertion each brick is expected to update).
- **Untouched:** `service.ts`, `types.ts`, `utari-adapter.ts`, `receipts.ts`,
  `verdict-engine.ts`, `rulesets.ts`. Brick 5's and Brick 7's lanes are clear.

---

## The laws this brick had to encode

**The 8/5 booked-vs-taken law.** `booked` counts distinct people booked on a
pinned sales calendar carrying a keyword; `taken` counts distinct people with a
taken-call row in the sales tracker. They are different populations from
different systems, and on Tyson's trailing fortnight taken (27) is more than
double booked (12). `creator_funnel` therefore prints both, always, computes the
gap, and explains it in words. It deliberately does **not** offer taken ÷ booked
as a show rate. That ratio is 2.25 here, and a "show rate" of 225% is what
makes a reader conclude the data is broken. The show rate it does report is the
tab's own cohort-true one: shown ÷ (booked − upcoming).

**The 7/02 level-vs-trend law.** `portfolio_pace`'s `level` block contains only
calendar figures. The extrapolation lives inside `trend`, stamped
`is_level_claim: false`, labelled `TREND LINE, NOT A LEVEL`, and carries a
sentence saying it may never be reported as the level. A test asserts the
extrapolation never appears anywhere inside the level block.

**The 8/8 blends-need-shape law.** Every blended ROI ships attached to the
weekly series that produced it. The live answer shows exactly why: Tyson's July
blend is **3.47x**, and the weekly shape inside it runs **1.69 → 1.73 → 2.68 →
3.93 → 1.59 → 3.65 → 5.28**. The blend hides a 3.3x swing.

**The 8/8 lead-magnet cadence lesson.** `scale_headroom` emits no step for a
dial that moved inside 7 days, however good the ROI. On live data this fires
twice and correctly: FIT (raised 8/07, one day earlier) and Lead Magnet (raised
8/03, five days earlier) both earn a step from the engine and both are withheld,
with the earliest legitimate dates named as 8/14 and 8/10.

**The threshold law (Brick 3).** No number the owner signed is written in this
brick's code. The ladder, the cadence, the ROI floor and the sales-lag p90 are
all read from `registry_definitions` at answer time. `scale_headroom` returns
`cannot_answer` and names what is missing rather than falling back to a default;
a test proves it by withholding `scaling_ladder`.

---

## Tests, verbatim

All 22 Brick 6 tests, including the four that run against the **live database**.

```
✔ (b) creator_funnel prints booked AND taken with the gap stated, when they diverge upward (TIMING)
✔ (b) the per-ad-set shapes diverge in BOTH directions and each is read truthfully (TIMING)
✔ (b) creator_funnel never derives a show rate by dividing taken by booked (TIMING)
✔ (c) portfolio_pace keeps the extrapolation OUT of the level and labels it (TIMING)
✔ (c) portfolio_pace month figures tie to a direct sum of the same leaves (TIMING)
✔ (d) an ad set whose dial moved THREE days ago gets NO step (TIMING)
✔ (d) a flat dial with adequate ROI DOES earn its step, so the gate is not just always-off (TIMING)
✔ (d) FIT respects its registry saturation ceiling and earns nothing above it (TIMING)
✔ (d) every scale_headroom recommendation carries under_ruleset and a basis (TIMING)
✔ (d) scale_headroom refuses rather than guessing when the ladder is unsigned (TIMING)
✔ (d) the ceiling parser reads the registry shape and matches only leading words (TIMING)
✔ budget_map reconciles each dial to yesterday's spend inside Meta's 25% flex (TIMING)
✔ (f) the caller travels from the ask onto the receipt (TIMING)
✔ (f) the MCP route sanitises X-Door-Caller and defaults to utari (TIMING)
✔ the four new questions are on the locked list with real params and sources (TIMING)
✔ each new question refuses a parameter it does not take (TIMING)
✔ every new answer carries a contract-2 receipt (TIMING)
✔ the three money answers carry a coverage block, and budget_map correctly does not (TIMING)
✔ GOLDEN a1: the fit and pro leaves still match the hand-verified 8/8 numbers (TIMING)
✔ GOLDEN a2: budget_map reproduces the hand-verified 8/8 map of $440/day (TIMING)
✔ GOLDEN a3: creator_funnel over the same window reproduces the leaf totals (TIMING)
✔ GOLDEN e1: describe_misses groups and counts the manual 8/8 rows (TIMING)
ℹ tests 22
ℹ suites 0
ℹ pass 22
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7922.079208
```

### (a) The golden fixtures, recomputed at build time

Both fixtures from the brief were recomputed in SQL against live data before any
code existed, and **both matched exactly, with no drift to report.**

Trailing fortnight ending 2026-08-07 (`2026-07-25` → `2026-08-07`), Tyson:

| keyword | spend | DMs | booked | taken | closes | cash |
|---|---|---|---|---|---|---|
| `fit` | $1,661.69 | 115 | 6 | 13 | 8 | $9,899.00 |
| `pro` | $1,367.83 | 68 | 2 | 5 | 3 | $5,599.00 |

The brief quoted `fit` at $1,662 and `pro` at $1,368; those are the same numbers
rounded to the dollar. The fixture stores the exact cents.

Budget map on 2026-08-08, Tyson: FIT **$140**, Revived Winners **$100**, Lead
Magnet **$100**, vet-ICP test **$100** = **$440/day**. Matched exactly.

### (g) Full suite

```
ℹ suites 0
ℹ pass 322
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 54264.0315

✖ failing tests:

test at src/lib/ads-tracker/dashboard-html.test.ts:2:1409
✖ ads-tracker-export.html inline app compiles (browser-equivalent Babel parse) (5.253625ms)
  AssertionError [ERR_ASSERTION]: expected a <script type=text/babel> block in the dashboard HTML
      at TestContext.<anonymous> (/private/tmp/claude-501/-Users-alexwalsh-Documents-All-AI-Assets-Claude-Code-Experiment/2d8676c5-a2a8-425c-9f3e-9fcff7ad073f/scratchpad/brick6/src/lib/ads-tracker/dashboard-html.test.ts:33:10)
      at Test.runInAsyncScope (node:async_hooks:214:14)
      at Test.run (node:internal/test_runner/test:1103:25)
      at Test.start (node:internal/test_runner/test:1000:17)
      at startSubtestAfterBootstrap (node:internal/test_runner/harness:358:17) {
    generatedMessage: false,
    code: 'ERR_ASSERTION',
    actual: false,
    expected: true,
    operator: '==',
    diff: 'simple'
  }
```

**322 pass, 1 fail, 0 skipped.** The single failure is the known pre-existing
`ads-tracker-export.html` export test, which fails identically on clean
`origin/main`.

> **Worth knowing:** the baseline run of this suite skipped **38** tests, because
> every live golden in Bricks 2, 3, 4 and 6 skips without database credentials.
> Supplying them turned all 38 on. That is how the pre-existing defect below was
> found, and it means this run is a materially stronger check than the suite has
> had before.

---

## Findings

### 1. A pre-existing Brick 3 defect, found and fixed

Brick 3's own live golden states the invariant: *"every live dial either paced
inside Meta's roughly 25% daily flex, or it is surfaced as a mismatch. Nothing
may be silently unexplained."* Its budget map only ever pushed two mismatch
kinds (zero spend, and spend with no budget row). **An entity delivering two
thirds of its dial fell through and was reported as if it reconciled.**

On live data this is Tyson's vet-ICP test ad set at **67.2%** of a $100/day dial.

The test had never run in an environment with credentials, so it had never once
been checked against real pacing. Verified pre-existing by running Brick 3's
goldens against a clean `origin/main` worktree with credentials: **the same test
fails there.** Fixed in `kill-scale.ts` by adding `spend_above_daily_flex` /
`spend_below_daily_flex` mismatches. This is a reporting-completeness fix that
the brick's own signed invariant already demanded; **no decision rule changed.**

### 2. A launch-day false alarm in `budget_map`, found and fixed before shipping

The first live run flagged Jake's `SCALING - US - PROVEN (8/8)` as
`zero_delivery`. That ad set was launched on the morning of 8/8; it spent nothing
on 8/7 because on 8/7 it did not exist. Reported as zero delivery it is
indistinguishable from a funded ad set that has stopped working, which is a real
emergency, and an answer that cries wolf on every launch is one the owner learns
to skim. `budget_map` now reads each entity's first budget photo and reports
`too_new_to_reconcile`, unflagged. The two genuine problems (vet-ICP
under-delivering, `TEST - US LAB (8/1)` at zero) remain flagged.

### 3. The FIT ceiling is keyed by NAME, not by id: the one place `structure_rules` cannot be followed

`scaling_ladder` v1 says "respect proven per-ad-set saturation ceilings" and
carries one measured instance: `details.evidence.fit_ceiling_daily_cents` =
14000. **That ceiling is keyed by the word `fit`, not by an `adset_id`**, so
binding it to an entity requires matching the verbatim ad set name,
and `structure_rules` v1 says group by id, never by name.

Handled by making the match as narrow and as loud as possible: the ad set name
must *begin* with the token on a word boundary (`FIT - Warm Audience Stack`
matches; `TEST - Fitness` and `Warm Stack FIT` do not, both asserted in tests),
and every applied ceiling reports the `basis` string saying it was matched on the
name and why.

**Open item for Alex: re-sign the saturation ceiling keyed by `adset_id`.** Until
then this is a name match that announces itself, which beats a ceiling silently
ignored, because ignoring it is how the $140 lesson gets paid for twice.

### 4. `shown` is far below `taken`, and the funnel says so rather than smoothing it

Tyson's fortnight: 12 booked, 27 taken, **3 shown**. `shown` is cohort-scoped to
people booked *in this window* on a pinned calendar, so it can never exceed
`booked`, while `taken` is the tracker's own count and is not so scoped. The
three numbers are three different reads of three different systems and the answer
labels them that way. Not a bug, but a reader who assumes shown ≤ taken means a
show-rate collapse would be wrong; the `counting_note` on every answer says so.

### 5. `budget_map` carries no coverage block, on purpose

Every other question in this brick reports sale cash and therefore carries the
four signed coverage buckets. `budget_map` reports dials and spend and never
touches a sale row, so a coverage block would describe a population it does not
read. Declared `money: false`, and a test asserts the other three do carry one
and that this one does not.

---

## The four answers, whole

Each block below is the **literal JSON the door returned** on 2026-08-08,
captured programmatically and spliced into this document unedited, not
re-typed, not summarised. Money is in USD cents throughout.

### 20. `creator_funnel`: Tyson, 2026-07-25 to 2026-08-07

```json
{
  "question_key": "creator_funnel",
  "question": "The whole funnel for one creator (or all of them together) over a window: spend, DMs, booked calls, calls taken, people shown, closes and cash, with the rate and the cost at every stage, compared against that creator's own previous window of the same length. Booked and taken are always reported side by side with the gap between them explained.",
  "params": {
    "client": "tyson",
    "date_from": "2026-07-25",
    "date_to": "2026-08-07"
  },
  "answers": {
    "account": "tyson",
    "window": {
      "from": "2026-07-25",
      "to": "2026-08-07"
    },
    "baseline_window": {
      "from": "2026-07-10",
      "to": "2026-07-24"
    },
    "units": "Money is in USD CENTS. Stage rates are a share between 0 and 1. Collected ROI is a multiple. pct_change is in percent.",
    "funnel_order": [
      "spend",
      "dms",
      "booked",
      "taken",
      "shown",
      "closes",
      "collected"
    ],
    "per_creator": [
      {
        "client": "tyson",
        "window": {
          "stages": {
            "spend_usd_cents": 579308,
            "dms": 441,
            "booked": 12,
            "taken": 27,
            "shown": 3,
            "closes": 17,
            "collected_usd_cents": 2449500
          },
          "stage_rates": {
            "dm_to_booked": 0.0272,
            "booked_to_shown": 0.25,
            "taken_to_close": 0.6296,
            "link_ctr": 0.00795
          },
          "cost_per_stage_usd_cents": {
            "per_dm": 1314,
            "per_booked_call": 48276,
            "per_taken_call": 21456,
            "per_close": 34077
          },
          "collected_roi": 4.23,
          "booked_vs_taken": {
            "booked": 12,
            "taken": 27,
            "gap": 15,
            "upcoming_not_yet_due": 0,
            "reading": "taken (27) EXCEEDS booked (12) by 15. This is not a counting error. booked is read from pinned sales-calendar bookings carrying a keyword; taken is read from taken-call rows in the sales tracker. A call booked off-calendar, or through a duplicate contact record, is taken here without ever having been booked here. Treat booked as a FLOOR on demand, never as the number of calls that happened.",
            "why_no_single_show_rate": "booked_to_shown is computed the one way the tab computes it: of the people BOOKED in this window and already due (booked minus upcoming), the share with a hard-key-linked taken record. It is deliberately NOT taken divided by booked, because those two counts come from different systems and their ratio can exceed 1, which is meaningless as a show rate."
          }
        },
        "baseline": {
          "stages": {
            "spend_usd_cents": 667362,
            "dms": 627,
            "booked": 26,
            "taken": 35,
            "shown": 5,
            "closes": 15,
            "collected_usd_cents": 2052900
          },
          "stage_rates": {
            "dm_to_booked": 0.0415,
            "booked_to_shown": 0.1923,
            "taken_to_close": 0.4286,
            "link_ctr": 0.00971
          },
          "cost_per_stage_usd_cents": {
            "per_dm": 1064,
            "per_booked_call": 25668,
            "per_taken_call": 19067,
            "per_close": 44491
          },
          "collected_roi": 3.08,
          "booked_vs_taken": {
            "booked": 26,
            "taken": 35,
            "gap": 9,
            "upcoming_not_yet_due": 0,
            "reading": "taken (35) EXCEEDS booked (26) by 9. This is not a counting error. booked is read from pinned sales-calendar bookings carrying a keyword; taken is read from taken-call rows in the sales tracker. A call booked off-calendar, or through a duplicate contact record, is taken here without ever having been booked here. Treat booked as a FLOOR on demand, never as the number of calls that happened.",
            "why_no_single_show_rate": "booked_to_shown is computed the one way the tab computes it: of the people BOOKED in this window and already due (booked minus upcoming), the share with a hard-key-linked taken record. It is deliberately NOT taken divided by booked, because those two counts come from different systems and their ratio can exceed 1, which is meaningless as a show rate."
          }
        },
        "change_vs_baseline": {
          "spend_usd_cents": {
            "absolute": -88054,
            "pct_change": -13.2
          },
          "dms": {
            "absolute": -186,
            "pct_change": -29.7
          },
          "booked": {
            "absolute": -14,
            "pct_change": -53.8
          },
          "taken": {
            "absolute": -8,
            "pct_change": -22.9
          },
          "shown": {
            "absolute": -2,
            "pct_change": -40
          },
          "closes": {
            "absolute": 2,
            "pct_change": 13.3
          },
          "collected_usd_cents": {
            "absolute": 396600,
            "pct_change": 19.3
          },
          "cost_per_dm_usd_cents": {
            "absolute": 250,
            "pct_change": 23.5
          },
          "collected_roi": {
            "absolute": 1.15,
            "pct_change": 37.3
          }
        }
      }
    ],
    "total": {
      "window": {
        "stages": {
          "spend_usd_cents": 579308,
          "dms": 441,
          "booked": 12,
          "taken": 27,
          "shown": 3,
          "closes": 17,
          "collected_usd_cents": 2449500
        },
        "stage_rates": {
          "dm_to_booked": 0.0272,
          "booked_to_shown": 0.25,
          "taken_to_close": 0.6296,
          "link_ctr": 0.00795
        },
        "cost_per_stage_usd_cents": {
          "per_dm": 1314,
          "per_booked_call": 48276,
          "per_taken_call": 21456,
          "per_close": 34077
        },
        "collected_roi": 4.23,
        "booked_vs_taken": {
          "booked": 12,
          "taken": 27,
          "gap": 15,
          "upcoming_not_yet_due": 0,
          "reading": "taken (27) EXCEEDS booked (12) by 15. This is not a counting error. booked is read from pinned sales-calendar bookings carrying a keyword; taken is read from taken-call rows in the sales tracker. A call booked off-calendar, or through a duplicate contact record, is taken here without ever having been booked here. Treat booked as a FLOOR on demand, never as the number of calls that happened.",
          "why_no_single_show_rate": "booked_to_shown is computed the one way the tab computes it: of the people BOOKED in this window and already due (booked minus upcoming), the share with a hard-key-linked taken record. It is deliberately NOT taken divided by booked, because those two counts come from different systems and their ratio can exceed 1, which is meaningless as a show rate."
        }
      },
      "baseline": {
        "stages": {
          "spend_usd_cents": 667362,
          "dms": 627,
          "booked": 26,
          "taken": 35,
          "shown": 5,
          "closes": 15,
          "collected_usd_cents": 2052900
        },
        "stage_rates": {
          "dm_to_booked": 0.0415,
          "booked_to_shown": 0.1923,
          "taken_to_close": 0.4286,
          "link_ctr": 0.00971
        },
        "cost_per_stage_usd_cents": {
          "per_dm": 1064,
          "per_booked_call": 25668,
          "per_taken_call": 19067,
          "per_close": 44491
        },
        "collected_roi": 3.08,
        "booked_vs_taken": {
          "booked": 26,
          "taken": 35,
          "gap": 9,
          "upcoming_not_yet_due": 0,
          "reading": "taken (35) EXCEEDS booked (26) by 9. This is not a counting error. booked is read from pinned sales-calendar bookings carrying a keyword; taken is read from taken-call rows in the sales tracker. A call booked off-calendar, or through a duplicate contact record, is taken here without ever having been booked here. Treat booked as a FLOOR on demand, never as the number of calls that happened.",
          "why_no_single_show_rate": "booked_to_shown is computed the one way the tab computes it: of the people BOOKED in this window and already due (booked minus upcoming), the share with a hard-key-linked taken record. It is deliberately NOT taken divided by booked, because those two counts come from different systems and their ratio can exceed 1, which is meaningless as a show rate."
        }
      },
      "change_vs_baseline": {
        "spend_usd_cents": {
          "absolute": -88054,
          "pct_change": -13.2
        },
        "dms": {
          "absolute": -186,
          "pct_change": -29.7
        },
        "booked": {
          "absolute": -14,
          "pct_change": -53.8
        },
        "taken": {
          "absolute": -8,
          "pct_change": -22.9
        },
        "shown": {
          "absolute": -2,
          "pct_change": -40
        },
        "closes": {
          "absolute": 2,
          "pct_change": 13.3
        },
        "collected_usd_cents": {
          "absolute": 396600,
          "pct_change": 19.3
        },
        "cost_per_dm_usd_cents": {
          "absolute": 250,
          "pct_change": 23.5
        },
        "collected_roi": {
          "absolute": 1.15,
          "pct_change": 37.3
        }
      }
    },
    "baseline_basis": "the 15 days immediately before this window (2026-07-10 to 2026-07-24), which is the same length as the window itself, per roi_window v1. It is this creator's own past, not a benchmark from anyone else.",
    "counting_note": "booked counts DISTINCT PEOPLE with a booking on a pinned sales calendar carrying a keyword. taken counts distinct people with a taken-call row in the sales tracker. shown counts the booked-in-window people already due who have a hard-key-linked taken record. They are three different reads of three different systems: see booked_vs_taken on every funnel for what their gap means."
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
      "key": "costPerMessage",
      "label": "Cost / DM",
      "meaning": "The average ad spend behind one DM.",
      "source": "Ad spend divided by DMs.",
      "format": "usd2",
      "is_calculated": true
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
      "key": "costPerBooked",
      "label": "Cost / booked",
      "meaning": "The average ad spend behind one booked call.",
      "source": "Ad spend divided by calls booked.",
      "format": "usd2",
      "is_calculated": true
    },
    {
      "key": "taken",
      "label": "Calls taken",
      "meaning": "How many strategy calls took place in this window, counted on the day the call happened, including ones booked earlier.",
      "source": "The sales tracker, which only lists calls that took place. Counted by call day, so this can differ from the show-rate group, which counts people booked in this window.",
      "format": "int",
      "is_calculated": false
    },
    {
      "key": "costPerTaken",
      "label": "Cost / call taken",
      "meaning": "The average ad spend behind one call taken.",
      "source": "Ad spend divided by calls taken.",
      "format": "usd2",
      "is_calculated": true
    },
    {
      "key": "showRate",
      "label": "Show rate",
      "meaning": "Of the people who booked a call in this window, the share who actually showed up. Upcoming calls are set aside, not counted for or against it.",
      "source": "People booked in this window who have a matching taken record, divided by people booked in this window minus upcoming. The same people the popup lists, so the cell and the popup always agree. It never passes 100%.",
      "format": "pct",
      "is_calculated": true
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
      "key": "closeRate",
      "label": "Close rate",
      "meaning": "The share of calls taken that became a client.",
      "source": "New clients divided by calls taken.",
      "format": "pct",
      "is_calculated": true
    },
    {
      "key": "msgToCall",
      "label": "DM to call",
      "meaning": "The share of DMs that became a booked call.",
      "source": "Calls booked divided by DMs.",
      "format": "pct",
      "is_calculated": true
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
      "key": "costPerClient",
      "label": "Cost / client",
      "meaning": "The average ad spend behind one new client.",
      "source": "Ad spend divided by new clients.",
      "format": "usd",
      "is_calculated": true
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
      "source": "adsv2_dm_facts",
      "last_written_at": "2026-08-08T09:25:14.834023+00:00",
      "note": "the newest stamped DM fact"
    },
    {
      "source": "adsv2_booking_facts",
      "last_written_at": "2026-08-08T09:25:15.010535+00:00",
      "note": "the newest stamped booking fact"
    },
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-08T09:25:15.212974+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "warehouse.ads",
      "last_written_at": "2026-08-08T09:26:51.98728+00:00",
      "note": "the last hourly refresh of the merged ads table"
    }
  ],
  "sources": [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "registry_entities"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "creator_funnel",
    "question_version": 1,
    "asked_at": "2026-08-08T09:52:57.100Z",
    "caller": "chat",
    "params_as_resolved": {
      "client": "tyson",
      "date_from": "2026-07-25",
      "date_to": "2026-08-07"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-25",
      "to": "2026-08-07",
      "kind": "trailing_funnel_window"
    },
    "data_version": 412,
    "freshness": [
      {
        "source": "adsv2_dm_facts",
        "last_written_at": "2026-08-08T09:25:14.834023+00:00",
        "note": "the newest stamped DM fact"
      },
      {
        "source": "adsv2_booking_facts",
        "last_written_at": "2026-08-08T09:25:15.010535+00:00",
        "note": "the newest stamped booking fact"
      },
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-08T09:25:15.212974+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "warehouse.ads",
        "last_written_at": "2026-08-08T09:26:51.98728+00:00",
        "note": "the last hourly refresh of the merged ads table"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 23,
      "window_cash_usd_cents_total": 3209400,
      "buckets": {
        "ad": {
          "wins": 17,
          "cash_usd_cents": 2449500
        },
        "organic": {
          "wins": 2,
          "cash_usd_cents": 340000
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
      "classified_pct_wins": 82.6,
      "classified_pct_cash": 86.9,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 4 of the 4 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 2 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read."
    },
    "exclusions": [
      {
        "what": "ads carrying no keyword",
        "count": 0,
        "why": "the whole funnel in this system is joined by keyword, so an ad that never carried one has spend but no DMs, calls or cash that can be tied to it. Its spend is real and appears in the Ads v2 tab's own totals; it is not in this funnel."
      },
      {
        "what": "organic keyword traffic and rows still awaiting review",
        "count": 0,
        "why": "organic_keywords v1 forbids marked organic keywords from entering ad ROAS, and an awaiting-review row is one nobody has classified yet. Both are out of every number here, which understates the funnel rather than flattering it. The receipt's coverage block states the awaiting-review gap in wins and dollars."
      }
    ],
    "caveats": [
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-08-07, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "4 wins worth 4199.00 USD in this window are still awaiting review, so 82.6% of wins and 86.9% of cash are classified. This answer is not a claim of full coverage."
    ],
    "certainty": "directional",
    "definitions_cited": [
      {
        "registry": "warehouse.definitions",
        "name": "spend"
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
        "name": "taken"
      },
      {
        "registry": "warehouse.definitions",
        "name": "newClients"
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
        "name": "costPerMessage"
      },
      {
        "registry": "warehouse.definitions",
        "name": "costPerBooked"
      },
      {
        "registry": "warehouse.definitions",
        "name": "costPerTaken"
      },
      {
        "registry": "warehouse.definitions",
        "name": "costPerClient"
      },
      {
        "registry": "warehouse.definitions",
        "name": "showRate"
      },
      {
        "registry": "warehouse.definitions",
        "name": "closeRate"
      },
      {
        "registry": "warehouse.definitions",
        "name": "msgToCall"
      },
      {
        "registry": "registry_definitions",
        "name": "sales_lag",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "coverage",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "roi_window",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "collected_vs_contracted",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "structure_rules",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "win_definition",
        "version": 1
      }
    ]
  }
}
```

### 21. `portfolio_pace`: Tyson

```json
{
  "question_key": "portfolio_pace",
  "question": "Where the money actually stands and which way it is moving: the calendar month to date and the prior full month (the LEVEL), alongside the weekly shape of the trailing eight weeks (the TREND), with spend, cash collected and blended collected ROI per creator and for the whole portfolio. A trailing extrapolation is offered only as a labelled trend line and is never presented as the level.",
  "params": {
    "client": "tyson",
    "trend_weeks": 8,
    "date_from": "2026-08-01",
    "date_to": "2026-08-07"
  },
  "answers": {
    "account": "tyson",
    "as_of_day": "2026-08-07",
    "units": "Money is in USD CENTS. Blended collected ROI is a multiple. Nothing here is annualised.",
    "level_window": {
      "from": "2026-08-01",
      "to": "2026-08-07"
    },
    "prior_month_window": {
      "from": "2026-07-01",
      "to": "2026-07-31"
    },
    "per_creator": [
      {
        "client": "tyson",
        "level": {
          "month_to_date": {
            "from": "2026-08-01",
            "to": "2026-08-07",
            "spend_usd_cents": 314083,
            "collected_usd_cents": 1049900,
            "blended_collected_roi": 3.34,
            "dms": 220,
            "closes": 8,
            "complete": false,
            "days_elapsed": 7,
            "days_in_month": 31,
            "note": "2026-08-01 to 2026-08-07: 7 of 31 days of the calendar month. This is a PARTIAL month and is not comparable to the prior full month without saying so."
          },
          "prior_full_month": {
            "from": "2026-07-01",
            "to": "2026-07-31",
            "spend_usd_cents": 1329544,
            "collected_usd_cents": 4612500,
            "blended_collected_roi": 3.47,
            "dms": 1374,
            "closes": 36,
            "complete": true
          },
          "basis": "level_vs_trend v1: a level claim is a CALENDAR figure. Both numbers here are real calendar periods with no extrapolation of any kind in them."
        },
        "trend": {
          "weekly": [
            {
              "from": "2026-06-13",
              "to": "2026-06-19",
              "spend_usd_cents": 602463,
              "collected_usd_cents": 1020000,
              "blended_collected_roi": 1.69,
              "dms": 457,
              "closes": 10,
              "days": 7,
              "cash_still_landing": false,
              "week_index": -7
            },
            {
              "from": "2026-06-20",
              "to": "2026-06-26",
              "spend_usd_cents": 300028,
              "collected_usd_cents": 520000,
              "blended_collected_roi": 1.73,
              "dms": 168,
              "closes": 3,
              "days": 7,
              "cash_still_landing": false,
              "week_index": -6
            },
            {
              "from": "2026-06-27",
              "to": "2026-07-03",
              "spend_usd_cents": 354939,
              "collected_usd_cents": 950000,
              "blended_collected_roi": 2.68,
              "dms": 317,
              "closes": 8,
              "days": 7,
              "cash_still_landing": false,
              "week_index": -5
            },
            {
              "from": "2026-07-04",
              "to": "2026-07-10",
              "spend_usd_cents": 307582,
              "collected_usd_cents": 1210000,
              "blended_collected_roi": 3.93,
              "dms": 382,
              "closes": 10,
              "days": 7,
              "cash_still_landing": false,
              "week_index": -4
            },
            {
              "from": "2026-07-11",
              "to": "2026-07-17",
              "spend_usd_cents": 315887,
              "collected_usd_cents": 503000,
              "blended_collected_roi": 1.59,
              "dms": 278,
              "closes": 5,
              "days": 7,
              "cash_still_landing": false,
              "week_index": -3
            },
            {
              "from": "2026-07-18",
              "to": "2026-07-24",
              "spend_usd_cents": 303828,
              "collected_usd_cents": 1109900,
              "blended_collected_roi": 3.65,
              "dms": 321,
              "closes": 8,
              "days": 7,
              "cash_still_landing": false,
              "week_index": -2
            },
            {
              "from": "2026-07-25",
              "to": "2026-07-31",
              "spend_usd_cents": 265225,
              "collected_usd_cents": 1399600,
              "blended_collected_roi": 5.28,
              "dms": 221,
              "closes": 9,
              "days": 7,
              "cash_still_landing": true,
              "week_index": -1
            },
            {
              "from": "2026-08-01",
              "to": "2026-08-07",
              "spend_usd_cents": 314083,
              "collected_usd_cents": 1049900,
              "blended_collected_roi": 3.34,
              "dms": 220,
              "closes": 8,
              "days": 7,
              "cash_still_landing": true,
              "week_index": 0
            }
          ],
          "weekly_basis": "8 trailing seven-day buckets ending 2026-08-07, oldest first. Each bucket is a real seven days of data; the last one ends yesterday and is not a calendar week. cash_still_landing marks a bucket that ends inside the signed sales-lag p90 of 13 days: its spend is fully recorded and its cash is not.",
          "trend_line": {
            "is_level_claim": false,
            "label": "TREND LINE, NOT A LEVEL",
            "basis_window": {
              "from": "2026-08-01",
              "to": "2026-08-07"
            },
            "daily_pace_spend_usd_cents": 44869,
            "daily_pace_collected_usd_cents": 149986,
            "if_this_pace_held_for_a_full_month": {
              "spend_usd_cents": 1390939,
              "collected_usd_cents": 4649557
            },
            "what_this_is_not": "This is an extrapolation of the last seven days across a whole month. It is NOT this month's number, it is NOT a forecast, and under level_vs_trend v1 it may never be reported as the level. The level is in the `level` block above, and it is a calendar figure. This line exists to show direction only."
          }
        },
        "blend_warning": "Every blended ROI on this answer is a ratio over a whole period, and a blend can hide its own tail: a fortnight at 3x can contain a final three days at 0.5x. That is why the weekly series ships attached to every blend here and is never omitted. Read the shape before you act on the blend."
      }
    ],
    "total": {
      "level": {
        "month_to_date": {
          "from": "2026-08-01",
          "to": "2026-08-07",
          "spend_usd_cents": 314083,
          "collected_usd_cents": 1049900,
          "blended_collected_roi": 3.34,
          "dms": 220,
          "closes": 8,
          "complete": false,
          "days_elapsed": 7,
          "days_in_month": 31,
          "note": "2026-08-01 to 2026-08-07: 7 of 31 days of the calendar month. This is a PARTIAL month and is not comparable to the prior full month without saying so."
        },
        "prior_full_month": {
          "from": "2026-07-01",
          "to": "2026-07-31",
          "spend_usd_cents": 1329544,
          "collected_usd_cents": 4612500,
          "blended_collected_roi": 3.47,
          "dms": 1374,
          "closes": 36,
          "complete": true
        },
        "basis": "level_vs_trend v1: a level claim is a CALENDAR figure. Both numbers here are real calendar periods with no extrapolation of any kind in them."
      },
      "trend": {
        "weekly": [
          {
            "from": "2026-06-13",
            "to": "2026-06-19",
            "spend_usd_cents": 602463,
            "collected_usd_cents": 1020000,
            "blended_collected_roi": 1.69,
            "dms": 457,
            "closes": 10,
            "days": 7,
            "cash_still_landing": false,
            "week_index": -7
          },
          {
            "from": "2026-06-20",
            "to": "2026-06-26",
            "spend_usd_cents": 300028,
            "collected_usd_cents": 520000,
            "blended_collected_roi": 1.73,
            "dms": 168,
            "closes": 3,
            "days": 7,
            "cash_still_landing": false,
            "week_index": -6
          },
          {
            "from": "2026-06-27",
            "to": "2026-07-03",
            "spend_usd_cents": 354939,
            "collected_usd_cents": 950000,
            "blended_collected_roi": 2.68,
            "dms": 317,
            "closes": 8,
            "days": 7,
            "cash_still_landing": false,
            "week_index": -5
          },
          {
            "from": "2026-07-04",
            "to": "2026-07-10",
            "spend_usd_cents": 307582,
            "collected_usd_cents": 1210000,
            "blended_collected_roi": 3.93,
            "dms": 382,
            "closes": 10,
            "days": 7,
            "cash_still_landing": false,
            "week_index": -4
          },
          {
            "from": "2026-07-11",
            "to": "2026-07-17",
            "spend_usd_cents": 315887,
            "collected_usd_cents": 503000,
            "blended_collected_roi": 1.59,
            "dms": 278,
            "closes": 5,
            "days": 7,
            "cash_still_landing": false,
            "week_index": -3
          },
          {
            "from": "2026-07-18",
            "to": "2026-07-24",
            "spend_usd_cents": 303828,
            "collected_usd_cents": 1109900,
            "blended_collected_roi": 3.65,
            "dms": 321,
            "closes": 8,
            "days": 7,
            "cash_still_landing": false,
            "week_index": -2
          },
          {
            "from": "2026-07-25",
            "to": "2026-07-31",
            "spend_usd_cents": 265225,
            "collected_usd_cents": 1399600,
            "blended_collected_roi": 5.28,
            "dms": 221,
            "closes": 9,
            "days": 7,
            "cash_still_landing": true,
            "week_index": -1
          },
          {
            "from": "2026-08-01",
            "to": "2026-08-07",
            "spend_usd_cents": 314083,
            "collected_usd_cents": 1049900,
            "blended_collected_roi": 3.34,
            "dms": 220,
            "closes": 8,
            "days": 7,
            "cash_still_landing": true,
            "week_index": 0
          }
        ],
        "weekly_basis": "8 trailing seven-day buckets ending 2026-08-07, oldest first. Each bucket is a real seven days of data; the last one ends yesterday and is not a calendar week. cash_still_landing marks a bucket that ends inside the signed sales-lag p90 of 13 days: its spend is fully recorded and its cash is not.",
        "trend_line": {
          "is_level_claim": false,
          "label": "TREND LINE, NOT A LEVEL",
          "basis_window": {
            "from": "2026-08-01",
            "to": "2026-08-07"
          },
          "daily_pace_spend_usd_cents": 44869,
          "daily_pace_collected_usd_cents": 149986,
          "if_this_pace_held_for_a_full_month": {
            "spend_usd_cents": 1390939,
            "collected_usd_cents": 4649557
          },
          "what_this_is_not": "This is an extrapolation of the last seven days across a whole month. It is NOT this month's number, it is NOT a forecast, and under level_vs_trend v1 it may never be reported as the level. The level is in the `level` block above, and it is a calendar figure. This line exists to show direction only."
        }
      },
      "blend_warning": "Every blended ROI on this answer is a ratio over a whole period, and a blend can hide its own tail: a fortnight at 3x can contain a final three days at 0.5x. That is why the weekly series ships attached to every blend here and is never omitted. Read the shape before you act on the blend."
    },
    "the_rule": "level_vs_trend v1: any pace or per-month claim must carry the actual calendar month (month-to-date plus prior month) AND the weekly trend shape. A trailing window alone is never a level claim. This answer is built so that reading it correctly is the path of least resistance: the calendar figures and the trend shape are separate blocks, and the extrapolation is inside the trend block, stamped is_level_claim false.",
    "current_week_caveat": "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger. The newest bucket ends 2026-08-07 and its cash WILL rise after this answer was given: the spend is already recorded and the sales it produced mostly are not. A falling last bar is the expected shape of a healthy account, not evidence of a problem, and on its own it is never a reason to kill anything."
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
      "source": "adsv2_dm_facts",
      "last_written_at": "2026-08-08T09:25:14.834023+00:00",
      "note": "the newest stamped DM fact"
    },
    {
      "source": "adsv2_booking_facts",
      "last_written_at": "2026-08-08T09:25:15.010535+00:00",
      "note": "the newest stamped booking fact"
    },
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-08T09:25:15.212974+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "warehouse.ads",
      "last_written_at": "2026-08-08T09:26:51.98728+00:00",
      "note": "the last hourly refresh of the merged ads table"
    }
  ],
  "sources": [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "registry_definitions",
    "registry_entities"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "portfolio_pace",
    "question_version": 1,
    "asked_at": "2026-08-08T09:52:59.636Z",
    "caller": "chat",
    "params_as_resolved": {
      "client": "tyson",
      "trend_weeks": 8,
      "date_from": "2026-08-01",
      "date_to": "2026-08-07"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-08-01",
      "to": "2026-08-07",
      "kind": "calendar_month_to_date"
    },
    "data_version": 412,
    "freshness": [
      {
        "source": "adsv2_dm_facts",
        "last_written_at": "2026-08-08T09:25:14.834023+00:00",
        "note": "the newest stamped DM fact"
      },
      {
        "source": "adsv2_booking_facts",
        "last_written_at": "2026-08-08T09:25:15.010535+00:00",
        "note": "the newest stamped booking fact"
      },
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-08T09:25:15.212974+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "warehouse.ads",
        "last_written_at": "2026-08-08T09:26:51.98728+00:00",
        "note": "the last hourly refresh of the merged ads table"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 13,
      "window_cash_usd_cents_total": 1589800,
      "buckets": {
        "ad": {
          "wins": 8,
          "cash_usd_cents": 1049900
        },
        "organic": {
          "wins": 1,
          "cash_usd_cents": 120000
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
      "classified_pct_wins": 69.2,
      "classified_pct_cash": 73.6,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 4 of the 4 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 2 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read."
    },
    "exclusions": [
      {
        "what": "organic keyword traffic and rows still awaiting review",
        "count": 0,
        "why": "organic_keywords v1 keeps marked organic keywords out of ad ROAS, and an awaiting-review row is one nobody has classified yet. Both are out of every figure here, which understates cash rather than flattering it. The coverage block states the awaiting-review gap for the month-to-date window."
      },
      {
        "what": "the current, incomplete week and the current, incomplete month",
        "count": 0,
        "why": "both are reported as partial ON PURPOSE and are labelled `complete: false`. They are never annualised, never grossed up, and never compared like-for-like against a full period without that label being attached."
      }
    ],
    "caveats": [
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-08-07, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "4 wins worth 4199.00 USD in this window are still awaiting review, so 69.2% of wins and 73.6% of cash are classified. This answer is not a claim of full coverage."
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
        "name": "newClients"
      },
      {
        "registry": "registry_definitions",
        "name": "sales_lag",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "coverage",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "level_vs_trend",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "roi_window",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "collected_vs_contracted",
        "version": 1
      }
    ]
  }
}
```

### 22. `budget_map`: all creators

```json
{
  "question_key": "budget_map",
  "question": "Every entity currently holding a daily budget for one creator (or all of them): its verbatim Meta name, its id, whether the dial sits on the ad set or the campaign, the dollars per day, and its delivery status, reconciled against what it actually spent yesterday. Totals per creator and overall. Read from the most recent stored budget photo, whose age is reported and flagged when stale.",
  "params": {
    "client": "all",
    "date_from": "2026-08-07",
    "date_to": "2026-08-07"
  },
  "answers": {
    "account": "all",
    "as_of_day": "2026-08-07",
    "units": "Money is in USD CENTS. daily_native_cents is in the ad account's own billing currency, named by billing_currency. pace_pct_of_dial is a percentage.",
    "entities": [
      {
        "client": "tyson",
        "level": "adset",
        "entity_id": "52589686189864",
        "entity_name_verbatim": "FIT - Warm Audience Stack (relaunch 7/21)",
        "campaign_id": "52570597860064",
        "daily_usd_cents": 14000,
        "daily_native_cents": 14000,
        "billing_currency": "USD",
        "lifetime_usd_cents": null,
        "effective_status": "ACTIVE",
        "yesterday_spend_usd_cents": 15773,
        "pace_pct_of_dial": 112.7,
        "reconciliation": "ok",
        "flagged": false,
        "photo_day": "2026-08-08",
        "first_photo_day": "2026-07-23",
        "photo_taken_at": "2026-08-08T09:25:10.37+00:00",
        "photo_age_hours": 0.5,
        "stale": false
      },
      {
        "client": "jake",
        "level": "adset",
        "entity_id": "120249890728010185",
        "entity_name_verbatim": "TEST - US - 50 (7/27)",
        "campaign_id": "120249890662080185",
        "daily_usd_cents": 12109,
        "daily_native_cents": 17200,
        "billing_currency": "AUD",
        "lifetime_usd_cents": null,
        "effective_status": "ACTIVE",
        "yesterday_spend_usd_cents": 12345,
        "pace_pct_of_dial": 101.9,
        "reconciliation": "ok",
        "flagged": false,
        "photo_day": "2026-08-08",
        "first_photo_day": "2026-07-28",
        "photo_taken_at": "2026-08-08T09:25:11.4+00:00",
        "photo_age_hours": 0.5,
        "stale": false
      },
      {
        "client": "tyson",
        "level": "adset",
        "entity_id": "52575879187864",
        "entity_name_verbatim": "TEST · Lead Magnet · 50 (6/24)",
        "campaign_id": "52564462555664",
        "daily_usd_cents": 10000,
        "daily_native_cents": 10000,
        "billing_currency": "USD",
        "lifetime_usd_cents": null,
        "effective_status": "ACTIVE",
        "yesterday_spend_usd_cents": 8843,
        "pace_pct_of_dial": 88.4,
        "reconciliation": "ok",
        "flagged": false,
        "photo_day": "2026-08-08",
        "first_photo_day": "2026-07-23",
        "photo_taken_at": "2026-08-08T09:25:10.37+00:00",
        "photo_age_hours": 0.5,
        "stale": false
      },
      {
        "client": "tyson",
        "level": "adset",
        "entity_id": "52581820968064",
        "entity_name_verbatim": "7/1 - SCALE - Revived Winners",
        "campaign_id": "52570597860064",
        "daily_usd_cents": 10000,
        "daily_native_cents": 10000,
        "billing_currency": "USD",
        "lifetime_usd_cents": null,
        "effective_status": "ACTIVE",
        "yesterday_spend_usd_cents": 8824,
        "pace_pct_of_dial": 88.2,
        "reconciliation": "ok",
        "flagged": false,
        "photo_day": "2026-08-08",
        "first_photo_day": "2026-07-23",
        "photo_taken_at": "2026-08-08T09:25:10.37+00:00",
        "photo_age_hours": 0.5,
        "stale": false
      },
      {
        "client": "tyson",
        "level": "adset",
        "entity_id": "52595863807264",
        "entity_name_verbatim": "TEST · Direct CTA · 10 (vet ICP 8/7)",
        "campaign_id": "52564462555664",
        "daily_usd_cents": 10000,
        "daily_native_cents": 10000,
        "billing_currency": "USD",
        "lifetime_usd_cents": null,
        "effective_status": "ACTIVE",
        "yesterday_spend_usd_cents": 6717,
        "pace_pct_of_dial": 67.2,
        "reconciliation": "under_delivering",
        "flagged": true,
        "photo_day": "2026-08-08",
        "first_photo_day": "2026-08-07",
        "photo_taken_at": "2026-08-08T09:25:10.37+00:00",
        "photo_age_hours": 0.5,
        "stale": false
      },
      {
        "client": "jake",
        "level": "adset",
        "entity_id": "120250191763420185",
        "entity_name_verbatim": "SCALING - US - PROVEN (8/8)",
        "campaign_id": "120250189749130185",
        "daily_usd_cents": 4989,
        "daily_native_cents": 7086,
        "billing_currency": "AUD",
        "lifetime_usd_cents": null,
        "effective_status": "ACTIVE",
        "yesterday_spend_usd_cents": 0,
        "pace_pct_of_dial": 0,
        "reconciliation": "too_new_to_reconcile",
        "flagged": false,
        "photo_day": "2026-08-08",
        "first_photo_day": "2026-08-08",
        "photo_taken_at": "2026-08-08T09:25:11.4+00:00",
        "photo_age_hours": 0.5,
        "stale": false
      },
      {
        "client": "jake",
        "level": "adset",
        "entity_id": "120250003126390185",
        "entity_name_verbatim": "TEST - US LAB (8/1)",
        "campaign_id": "120249890662080185",
        "daily_usd_cents": 3520,
        "daily_native_cents": 5000,
        "billing_currency": "AUD",
        "lifetime_usd_cents": null,
        "effective_status": "ACTIVE",
        "yesterday_spend_usd_cents": 0,
        "pace_pct_of_dial": 0,
        "reconciliation": "zero_delivery",
        "flagged": true,
        "photo_day": "2026-08-08",
        "first_photo_day": "2026-08-01",
        "photo_taken_at": "2026-08-08T09:25:11.4+00:00",
        "photo_age_hours": 0.5,
        "stale": false
      }
    ],
    "per_creator": [
      {
        "client": "tyson",
        "photo_day": "2026-08-08",
        "entity_count": 4,
        "total_daily_usd_cents": 44000,
        "yesterday_spend_usd_cents": 40157,
        "flagged_count": 1,
        "no_photo": null
      },
      {
        "client": "jake",
        "photo_day": "2026-08-08",
        "entity_count": 3,
        "total_daily_usd_cents": 20618,
        "yesterday_spend_usd_cents": 12345,
        "flagged_count": 1,
        "no_photo": null
      }
    ],
    "total_daily_usd_cents": 64618,
    "total_yesterday_spend_usd_cents": 52502,
    "entity_count": 7,
    "flagged": [
      {
        "entity_id": "52595863807264",
        "entity_name_verbatim": "TEST · Direct CTA · 10 (vet ICP 8/7)",
        "reconciliation": "under_delivering",
        "daily_usd_cents": 10000,
        "yesterday_spend_usd_cents": 6717,
        "pace_pct_of_dial": 67.2
      },
      {
        "entity_id": "120250003126390185",
        "entity_name_verbatim": "TEST - US LAB (8/1)",
        "reconciliation": "zero_delivery",
        "daily_usd_cents": 3520,
        "yesterday_spend_usd_cents": 0,
        "pace_pct_of_dial": 0
      }
    ],
    "reconciliation_rule": "Yesterday (2026-08-07) each dial is compared with what that entity actually spent. Meta may deliver up to 25% above a daily budget on any one day and balance it across the week, so anything from 75% to 125% of the dial reads as ok. Above that band is over_daily_flex, below it is under_delivering, and no spend at all against a live dial is zero_delivery. An entity whose first budget photo is later than 2026-08-07 reads as too_new_to_reconcile and is NOT flagged: it did not exist on the day being reconciled, so it could not have spent, and reporting a launch as a delivery failure is how a monitoring answer teaches its reader to skim. That 25% is Meta's documented platform behaviour, NOT an owner-signed threshold; nothing here was decided by this system.",
    "staleness": {
      "threshold_hours": 26,
      "threshold_source": "door_freshness_thresholds, so ops can tune it without a deploy",
      "stale_entity_count": 0,
      "note": "Every dial here comes from a photo inside its freshness threshold."
    },
    "entities_excluded_for_status": 1,
    "what_this_is_not": "This is the most recent STORED budget photo, not a live read of Meta. It cannot see a change made in Ads Manager since the photo was taken, and it cannot see an entity that is stuck in review burning nothing. health_check answers that question, live from the Meta API, and is the one to ask before acting on a dial."
  },
  "definitions_quoted": [
    {
      "key": "budget",
      "label": "Daily budget",
      "meaning": "The daily budget set in Meta at that time. Ad sets hold budgets in ABO; campaigns only when CBO; ads never do.",
      "source": "Meta budget settings, saved once per Eastern-time day.",
      "format": "budget",
      "is_calculated": false
    },
    {
      "key": "spend",
      "label": "Ad spend",
      "meaning": "How much Meta charged to run this ad across the selected days.",
      "source": "Meta, bucketed to Eastern-time days.",
      "format": "usd",
      "is_calculated": false
    }
  ],
  "as_of": [
    {
      "source": "adsv2_budget_snapshots",
      "last_written_at": "2026-08-08T09:25:11.4+00:00",
      "note": "the last daily budget photo"
    },
    {
      "source": "warehouse.ads",
      "last_written_at": "2026-08-08T09:26:51.98728+00:00",
      "note": "the last hourly refresh of the merged ads table"
    }
  ],
  "sources": [
    "adsv2_budget_snapshots",
    "ads_meta_insights_daily",
    "registry_entities"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "budget_map",
    "question_version": 1,
    "asked_at": "2026-08-08T09:53:02.029Z",
    "caller": "chat",
    "params_as_resolved": {
      "client": "all",
      "date_from": "2026-08-07",
      "date_to": "2026-08-07"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-08-07",
      "to": "2026-08-07",
      "kind": "budget_photo_day"
    },
    "data_version": 412,
    "freshness": [
      {
        "source": "adsv2_budget_snapshots",
        "last_written_at": "2026-08-08T09:25:11.4+00:00",
        "note": "the last daily budget photo"
      },
      {
        "source": "warehouse.ads",
        "last_written_at": "2026-08-08T09:26:51.98728+00:00",
        "note": "the last hourly refresh of the merged ads table"
      }
    ],
    "stale": [],
    "coverage": null,
    "exclusions": [
      {
        "what": "entities that hold no budget of their own",
        "count": 0,
        "why": "an ad set inside a campaign-budget (CBO) campaign has no dial to report; the campaign holds it and appears here instead. Nothing is double counted, and an entity is listed once, at the level that actually holds the money."
      },
      {
        "what": "budgets that are not currently delivering",
        "count": 0,
        "why": "a paused or archived entity still carries a budget field in Meta, but it is not money going out today. Only entities whose effective status is ACTIVE are in the totals, and the count of live-dial entities excluded for status is reported alongside."
      }
    ],
    "caveats": [],
    "certainty": "machine_certain",
    "definitions_cited": [
      {
        "registry": "warehouse.definitions",
        "name": "budget"
      },
      {
        "registry": "warehouse.definitions",
        "name": "spend"
      },
      {
        "registry": "registry_definitions",
        "name": "structure_rules",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "pricing_currency",
        "version": 1
      }
    ]
  }
}
```

### 23. `scale_headroom`: Tyson

```json
{
  "question_key": "scale_headroom",
  "question": "Which ad sets have earned more budget, how much more, and when the raise is actually allowed. For every ad set that is at or above the KPI line it reports where it sits on the signed scaling ladder, the next earned step, the date that step becomes legitimate under the weekly cadence, any proven saturation ceiling in the way, and what the account's total daily spend becomes if every earned step is taken. A step is never emitted for a dial that moved inside the last seven days.",
  "params": {
    "client": "tyson",
    "date_from": "2026-07-25",
    "date_to": "2026-08-07",
    "ruleset": "zakk_v1"
  },
  "answers": {
    "account": "tyson",
    "window": {
      "from": "2026-07-25",
      "to": "2026-08-07"
    },
    "under_ruleset": "zakk_v1",
    "ruleset_definition": {
      "name": "ruleset_zakk",
      "version": 1
    },
    "units": "Money is in USD CENTS. Collected ROI is a multiple.",
    "ladder": {
      "launch_daily_usd_cents": 5000,
      "bottom_rungs_usd_cents": [
        5000,
        10000,
        20000
      ],
      "above_threshold_usd_cents": 20000,
      "above_threshold_step_pct": [
        20,
        33
      ],
      "budget_is_floor_at_cash_roi": 2,
      "step_cadence": "weekly",
      "cadence_gate_days": 7
    },
    "ad_sets": [
      {
        "client": "tyson",
        "adset_id": "52589686189864",
        "adset_name_verbatim": "FIT - Warm Audience Stack (relaunch 7/21)",
        "campaign_id": "52570597860064",
        "campaign_name_verbatim": "SCALING",
        "under_ruleset": "zakk_v1",
        "window_spend_usd_cents": 166169,
        "window_collected_usd_cents": 989900,
        "collected_roi": 5.96,
        "closes": 8,
        "booked": 6,
        "current_daily_usd_cents": 14000,
        "budget_level": "adset",
        "ladder_position": "scaling_ladder v1: at 5.96x cash ROI, budget is a floor not a cap. $140.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week.",
        "engine_next_step_usd_cents": 20000,
        "step_emitted": false,
        "recommended_daily_usd_cents": null,
        "increase_usd_cents": null,
        "blocked_by": [
          "weekly_cadence",
          "saturation_ceiling"
        ],
        "earliest_step_day": "2026-08-14",
        "last_dial_change_day": "2026-08-07",
        "days_since_dial_change": 1,
        "dial_photo_record_starts": "2026-07-23",
        "saturation_ceiling_usd_cents": 14000,
        "basis": "scaling_ladder v1: at 5.96x cash ROI, budget is a floor not a cap. $140.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week. scaling_ladder v1 sets a weekly step cadence, never reactive mid-week. This dial last moved on 2026-08-07 ($115.00 to $140.00), 1 day ago, so no step is emitted today. The earliest legitimate step is 2026-08-14. This ad set is at or above its proven saturation ceiling of $140.00/day (currently $140.00). scaling_ladder v1 details.evidence.fit_ceiling_daily_cents: a measured saturation ceiling of $140.00/day for the \"FIT\" ad set. Applied by matching the verbatim ad set name, because the registry keys this ceiling by name and not by adset_id. Above that number we have already watched it stop converting, so a good ROI does not earn it more budget."
      },
      {
        "client": "tyson",
        "adset_id": "52581820968064",
        "adset_name_verbatim": "7/1 - SCALE - Revived Winners",
        "campaign_id": "52570597860064",
        "campaign_name_verbatim": "SCALING",
        "under_ruleset": "zakk_v1",
        "window_spend_usd_cents": 140738,
        "window_collected_usd_cents": 559900,
        "collected_roi": 3.98,
        "closes": 3,
        "booked": 2,
        "current_daily_usd_cents": 10000,
        "budget_level": "adset",
        "ladder_position": "scaling_ladder v1: at 3.98x cash ROI, budget is a floor not a cap. $100.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week.",
        "engine_next_step_usd_cents": 20000,
        "step_emitted": true,
        "recommended_daily_usd_cents": 20000,
        "increase_usd_cents": 10000,
        "blocked_by": [],
        "earliest_step_day": "2026-08-08",
        "last_dial_change_day": null,
        "days_since_dial_change": null,
        "dial_photo_record_starts": "2026-07-23",
        "saturation_ceiling_usd_cents": null,
        "basis": "scaling_ladder v1: at 3.98x cash ROI, budget is a floor not a cap. $100.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week. No dial change appears anywhere in this entity's stored budget photos, which start 2026-07-23 (17 days of record). That is as far back as this claim reaches; it is not evidence the dial has never moved in its life."
      },
      {
        "client": "tyson",
        "adset_id": "52575879187864",
        "adset_name_verbatim": "TEST · Lead Magnet · 50 (6/24)",
        "campaign_id": "52564462555664",
        "campaign_name_verbatim": "Tyson - TESTING",
        "under_ruleset": "zakk_v1",
        "window_spend_usd_cents": 87975,
        "window_collected_usd_cents": 359900,
        "collected_roi": 4.09,
        "closes": 2,
        "booked": 2,
        "current_daily_usd_cents": 10000,
        "budget_level": "adset",
        "ladder_position": "scaling_ladder v1: at 4.09x cash ROI, budget is a floor not a cap. $100.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week.",
        "engine_next_step_usd_cents": 20000,
        "step_emitted": false,
        "recommended_daily_usd_cents": null,
        "increase_usd_cents": null,
        "blocked_by": [
          "weekly_cadence"
        ],
        "earliest_step_day": "2026-08-10",
        "last_dial_change_day": "2026-08-03",
        "days_since_dial_change": 5,
        "dial_photo_record_starts": "2026-07-23",
        "saturation_ceiling_usd_cents": null,
        "basis": "scaling_ladder v1: at 4.09x cash ROI, budget is a floor not a cap. $100.00/day sits on the bottom of the ladder, which DOUBLES by necessity ($50.00 to $100.00 to $200.00), so the next weekly step is $200.00/day. Never reactive mid-week. scaling_ladder v1 sets a weekly step cadence, never reactive mid-week. This dial last moved on 2026-08-03 ($50.00 to $100.00), 5 days ago, so no step is emitted today. The earliest legitimate step is 2026-08-10."
      }
    ],
    "ad_sets_that_earned_nothing": 1,
    "if_every_earned_step_is_taken": {
      "steps_available_today": 1,
      "current_total_daily_usd_cents": 44000,
      "added_daily_usd_cents": 10000,
      "new_total_daily_usd_cents": 54000,
      "note": "Only the steps that pass BOTH gates today are in this total. Steps blocked by the weekly cadence are not counted, because they are not available today; their earliest legitimate date is on each ad set."
    },
    "saturation_ceilings_known": [
      {
        "token": "fit",
        "daily_usd_cents": 14000,
        "basis": "scaling_ladder v1 details.evidence.fit_ceiling_daily_cents: a measured saturation ceiling of $140.00/day for the \"FIT\" ad set. Applied by matching the verbatim ad set name, because the registry keys this ceiling by name and not by adset_id."
      }
    ],
    "the_cadence_rule": "scaling_ladder v1: steps are weekly, never daily and never reactive mid-week. This question enforces that as a hard gate: an ad set whose dial moved fewer than 7 days ago gets NO step, however well it is performing, and the answer names the date the step becomes legitimate instead. The June over-scale to twelve ad sets at $1,200/day crushed the book rate; that is our own evidence for why this gate exists.",
    "what_this_is": "Advice under ruleset zakk_v1, stamped as such. The ladder arithmetic and every verdict here come from the same engine kill_scale_read uses in decide mode; this question adds the weekly cadence gate, the proven saturation ceilings, and the portfolio total. A step is a recommendation under a lens, not a fact, and nothing here has been executed: no budget was moved and Meta was not touched."
  },
  "definitions_quoted": [
    {
      "key": "budget",
      "label": "Daily budget",
      "meaning": "The daily budget set in Meta at that time. Ad sets hold budgets in ABO; campaigns only when CBO; ads never do.",
      "source": "Meta budget settings, saved once per Eastern-time day.",
      "format": "budget",
      "is_calculated": false
    },
    {
      "key": "spend",
      "label": "Ad spend",
      "meaning": "How much Meta charged to run this ad across the selected days.",
      "source": "Meta, bucketed to Eastern-time days.",
      "format": "usd",
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
      "source": "adsv2_dm_facts",
      "last_written_at": "2026-08-08T09:25:14.834023+00:00",
      "note": "the newest stamped DM fact"
    },
    {
      "source": "adsv2_booking_facts",
      "last_written_at": "2026-08-08T09:25:15.010535+00:00",
      "note": "the newest stamped booking fact"
    },
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-08T09:25:15.212974+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "adsv2_budget_snapshots",
      "last_written_at": "2026-08-08T09:25:11.4+00:00",
      "note": "the last daily budget photo"
    }
  ],
  "sources": [
    "ads_meta_insights_daily",
    "adsv2_dm_facts",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "adsv2_budget_snapshots",
    "registry_definitions",
    "registry_entities"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "scale_headroom",
    "question_version": 1,
    "asked_at": "2026-08-08T09:53:04.072Z",
    "caller": "chat",
    "params_as_resolved": {
      "client": "tyson",
      "date_from": "2026-07-25",
      "date_to": "2026-08-07",
      "ruleset": "zakk_v1"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-25",
      "to": "2026-08-07",
      "kind": "trailing_decision_window"
    },
    "data_version": 412,
    "freshness": [
      {
        "source": "adsv2_dm_facts",
        "last_written_at": "2026-08-08T09:25:14.834023+00:00",
        "note": "the newest stamped DM fact"
      },
      {
        "source": "adsv2_booking_facts",
        "last_written_at": "2026-08-08T09:25:15.010535+00:00",
        "note": "the newest stamped booking fact"
      },
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-08T09:25:15.212974+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "adsv2_budget_snapshots",
        "last_written_at": "2026-08-08T09:25:11.4+00:00",
        "note": "the last daily budget photo"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 23,
      "window_cash_usd_cents_total": 3209400,
      "buckets": {
        "ad": {
          "wins": 17,
          "cash_usd_cents": 2449500
        },
        "organic": {
          "wins": 2,
          "cash_usd_cents": 340000
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
      "classified_pct_wins": 82.6,
      "classified_pct_cash": 86.9,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 4 of the 4 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 2 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read."
    },
    "exclusions": [
      {
        "what": "ad sets below the KPI line",
        "count": 0,
        "why": "this question is about where money should GO. An ad set that has not earned its current budget is the kill read's subject, not this one's; ask kill_scale_read in decide mode for those."
      },
      {
        "what": "organic keyword traffic and rows still awaiting review",
        "count": 0,
        "why": "organic_keywords v1 keeps marked organic keywords out of ad ROAS, and an awaiting-review row is unclassified. Both are out of every ROI here, which understates the case for scaling rather than flattering it."
      }
    ],
    "caveats": [
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-08-07, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "4 wins worth 4199.00 USD in this window are still awaiting review, so 82.6% of wins and 86.9% of cash are classified. This answer is not a claim of full coverage."
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
        "name": "budget"
      },
      {
        "registry": "warehouse.definitions",
        "name": "newClients"
      },
      {
        "registry": "warehouse.definitions",
        "name": "booked"
      },
      {
        "registry": "registry_definitions",
        "name": "sales_lag",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "coverage",
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
        "name": "verdict_floors_kill_tree",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "daily_run_rate",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "roi_window",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "structure_rules",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "unit_economics",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "ruleset_zakk",
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
        "name": "pricing_currency",
        "version": 1
      }
    ]
  }
}
```

---

## Brick 8 remainder: what changed

**`describe_misses` is now an MCP tool.** It existed in the service since Brick 2
and nothing could reach it. It returns the miss log grouped by normalised
asked-text with counts. This is the certification backlog, ordered by how often each
thing was asked.

**`X-Door-Caller`.** The MCP route stamped every receipt and log row `utari`.
It now reads an optional header, so chat traffic, Utari traffic and worker
traffic are distinguishable in `door_ask_log` and `door_miss_log`. The value is
sanitised to `[a-z0-9_-]`, capped at 32 characters, and **defaults to `utari`**,
so every existing client keeps exactly the behaviour it has today. The header is
added to the CORS allow-list, because a browser MCP client cannot send a custom
header the preflight has not allowed, and a silently dropped tag would put chat
traffic back into the record as `utari`, which is the problem this solves.
Sanitising is tested, including that a SQL-ish value cannot be written through.

**The freestyle sentence.** Every `ask_question` response now carries a standing
`freestyle_rule`: an answer produced outside the door is a workshop answer, label
it uncertified, and log what you were trying to ask into `door_miss_log`. It is
attached to the response envelope rather than to the answer object, so no
consumer reading `answers` or `receipt` is affected.

Verified live: the three manual rows logged on 8/8 by `fable_chat_manual` come
back grouped and counted, and repeated asks collapse into one row with a count.

---

## Not in this brick

Nothing person or bridge related (Brick 5). Nothing creative-store related
(Brick 7). No workers or crons (Brick 9). No new decision rules: `scale_headroom`
applies only signed ones. No UI. No migrations.

## Open items

1. **Re-sign the FIT saturation ceiling keyed by `adset_id`** rather than by
   name, so `structure_rules` v1 holds everywhere (finding 3).
2. **Consider signing the 25% reconciliation band.** It is currently a named
   platform constant in `budget-map.ts` and `kill-scale.ts`, documented as Meta's
   documented delivery behaviour and explicitly *not* an owner threshold. It
   coincides with the signed `spend_pace_flag_pct`, which is a different rule
   wearing the same number. If Alex wants the band tuned independently it should
   become a signed definition.
3. **Run the suite with credentials in CI.** 38 tests silently skipped is how
   finding 1 survived. The live goldens are the ones that catch data drift, and
   they are exactly the ones that skip.
