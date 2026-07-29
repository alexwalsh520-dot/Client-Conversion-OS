# Warehouse Build 4 — audit handoff

**The AI question list, and Utari's trial.**
Built 29 July 2026, in Claude Code on Alex's Mac, from `CCOS-Build4-Opus-Prompt.md`.
Branch `build4-question-door`, cut from `origin/main` at `cf7fc7d`.

Everything below is written so Fable can re-verify it directly against the live
database and the code, taking nothing on faith. Every gate has its pasted output.

---

## 1. What Build 4 is

One front door. A locked list of twelve questions, each answered by exactly one
fixed, tested query that reads numbers which were computed and **saved before the
question was asked**. No AI composes SQL through this door. A question that is not
on the list gets an honest written refusal naming the nearest one that is.

Then Utari, the external agent Jeremy uses, was repointed through that same door
and put on trial: every question it can be asked, over real HTTP, must return
exactly the number the Ads v2 tab shows.

**Build 4 wrote no money number, no fact, no snapshot and no attribution.** Its
only writes are its own code, its own database functions, and (from the next
daily run) one new measurement row per day in `warehouse.accuracy_checks`.

---

## 2. Phase 0 recon — the four adjustments, and why

The spec required adjusting any question to the **stored reality** rather than
recomputing to make an assumption true. Four adjustments were needed. All four
are recorded here and on the Blueprint.

### A1. Utari has sixteen tools, not seven

The spec and the project memory both say Utari exposes 7 tools. It exposes **16**:
`list_ads`, `get_ad`, `get_dms_for_ad`, `get_ad_day`, `list_sales`,
`get_sales_with_ad`, `freshness`, `business_snapshot`, `get_ad_full`,
`get_call_transcripts`, `get_organic_content`, `describe_schema`, plus four
Factory tools (`factory_list_projects`, `factory_get_project`, `factory_create`,
`factory_update`).

Law 8 says keep the existing contract working, so **all sixteen were kept**, and
`ask_question` makes seventeen. The trial asserts every pre-existing name is
still present.

### A2. "A stored window" has an exact and moving meaning

`warehouse.answers` is a view onto `adsv2_window_snapshots`. That table held 421
rows across 54 date ranges at recon time, but the tab does **not** serve most of
them: `serve.ts` `readSnapshot()` discards any row whose `data_version` is not the
current one. Every sync bumps that version.

So "every stored window" means **the rows at the current data version**, which is
8 preset ranges x 3 accounts x 3 statuses = **72 saved answers**. The rest are
historical husks the tab would never paint either. The door serves exactly those
72 and refuses anything else in writing. Both the Phase 1 proof and the trial pin
the version at the start of the run, because it moves hourly.

### A3. Two of the twenty-one definitions are not window numbers

`warehouse.definitions` holds 21 rows. Two are not a number a window or an ad
carries, and both are refused **by name with the reason** rather than returned as
a confusing zero:

- `name` is the row's label, not a number.
- `budget` is the daily dial, which lives on a campaign or an ad set and never on
  an ad or on a whole window. It is answered by `ad_setup` and `change_history`,
  where it belongs.

That leaves **19 numeric metrics**: 8 saved base counts and 11 calculated.

### A4. Cash with no ad evidence carries no creator

`attribution_share` and `leak_map` were specified per client. They cannot be. On
`adsv2_sale_facts`, every row with no ad evidence has `client_key = null`,
because the engine refuses to guess which creator a sale belongs to when nothing
proves it. Both questions were therefore made **roster-wide**, returning the
creator on each row (null where there genuinely is none), and each says so in its
own description and in its answer.

---

## 3. A real finding, recorded and deliberately NOT fixed

**Hunter Chapman's 1,599 dollar sale of 25 July is not in the tab's numbers.**

The Blueprint's 27 July entry says the human-decision store makes that sale
count. It does not, today. The row is stamped `evidence_key = 'human_resolution'`
with keyword `good`, and it also carries `awaiting_review = true`.
`adsv2_window_leaves` — the function that builds every saved answer — filters
`and not awaiting_review`, so the row is excluded.

Proved by query, not inferred:

```
facts the tab counts (Tyson, 2026-07-16..2026-07-29):   1,309,900 cents
the same facts including the awaiting-review row:       1,469,800 cents
the saved answer for that window:                       1,309,900 cents
```

Build 4 is read-only toward the money system, so this was **recorded and left
alone**. It is Alex and Fable's call. The door surfaces it honestly rather than
hiding it: `attribution_share` returns it in a bucket named
`proved_but_held_back`, with `counted_in_the_saved_answer: false`.

The same bucket also holds Hugo Magana's 0 dollar EDGE sale
(`subscriber_single_presale_keyword`, 4 July), for the same reason.

---

## 4. What was built

### Migrations (all `SECURITY DEFINER`, pinned `search_path`, own statement timeout)

| Migration | Functions |
|---|---|
| `question_door_readers` | `question_door_definitions`, `question_door_freshness`, `question_door_data_health` |
| `question_door_changes_setup_people` | `question_door_change_history`, `question_door_ad_setup`, `question_door_person_by_id`, `question_door_person_candidates`, `question_door_person_events`, `question_door_why_unattributed` |
| `question_door_cycle_share_leak` | `question_door_sales_cycle`, `question_door_attribution_share`, `question_door_leak_map`, `question_door_leak_trend`, `question_door_ad_run_dates` |
| `question_door_attribution_share_roster_wide` | corrects `question_door_attribution_share`, `question_door_leak_map`, `question_door_leak_trend` to roster-wide (adjustment A4) |

Every function carries a `comment on function` explaining what it is for in plain
words. The app can only reach the `warehouse` schema through public functions, so
these follow exactly the pattern Build 3's accuracy readers established.

### Code

| File | What it is |
|---|---|
| `src/lib/question-door/types.ts` | The shapes: answer, refusal, quoted definition, as-of, one registry entry. |
| `src/lib/question-door/params.ts` | Strict parameter checking. A malformed parameter is refused, never repaired by guessing. |
| `src/lib/question-door/answers.ts` | Reading `warehouse.answers` and nothing else for metrics. Holds the written explanation of why the 11 calculated metrics go through the tab's own `derive()`. |
| `src/lib/question-door/sources.ts` | Quoting the stored definitions, and reading real write times. |
| `src/lib/question-door/registry.ts` | **The locked list.** One entry per question, one fixed template each. |
| `src/lib/question-door/service.ts` | The door: ask, or be refused. Per-template wall-clock budget. |
| `src/lib/question-door/utari-adapter.ts` | Utari's per-ad funnel, now fed from the door, with field names and units preserved. |
| `src/app/api/questions/route.ts` | The internal endpoint, session-gated. GET lists the questions; POST asks one. |
| `src/lib/accuracy/rules.ts` | Adds `ONE_DOOR_TOLERANCE_NOTE` and `classifyOneDoor` (the thirteenth check's judgement, kept pure so its red paths are testable). |
| `src/lib/accuracy/checks.ts` | Adds the thirteenth check, `one_front_door`. |
| `src/app/api/mcp/utari/route.ts` | Repointed to the door; `ask_question` added; roster read from config. |
| `scripts/question-door-proof.mts` | The Phase 1 gate. |
| `scripts/utari-trial.mts` | The Phase 2 trial. |
| `scripts/run-check-13.mts` | Runs the thirteenth check alone, writing nothing. |

### The one place the door computes, and why it is not a second opinion

The saved payload holds **base counts only**. The eleven calculated columns are
not saved: the tab computes them at render time from those bases through one
shared function, `derive()`, so that a total is a formula over the union and
never a sum of per-row ratios. The door calls that **same function on those same
saved bases**. That is what makes its answer equal the screen's. It is written
out at the top of `answers.ts` rather than left implicit.

The Phase 1 proof deliberately does **not** call `derive()`. It restates all
eleven formulas from the definitions' own written sentences, so a disagreement
between the code and the stored meanings would fail the gate.

---

## 5. Gate results, with pasted output

### Phase 1 — unit tests

35 tests, all passing. They force: an off-list question, an empty question, a
malformed date, an impossible date (2026-02-31), a backwards range, a former
creator, an unknown parameter, a non-numeric metric, an unknown metric, an
unknown scope, an unsaved window, a name lookup (candidate list only), a question
asked with no way to find its row, a template that throws, and the presence of
quoted definitions plus a real as-of on every answering path.

```
ℹ tests 35
ℹ pass 35
ℹ fail 0
```

With the twelve existing accuracy tests plus the five new ones for the thirteenth
check: `ℹ tests 87 / ℹ pass 87 / ℹ fail 0`.

### Phase 1 — live proof, every saved window

```
data_version pinned for this run: 155
active roster: tyson, jake
saved windows at this version: 72

SAMPLE OF THE DOOR'S OWN ANSWERS (money in cents):
  tyson 2026-07-29..2026-07-29 all       spend=4719 dms=7 booked=1 closes=0 cash=0 roas=0
  jake 2026-07-29..2026-07-29 all        spend=3942 dms=4 booked=0 closes=0 cash=0 roas=0
  tyson 2026-07-28..2026-07-28 all       spend=31320 dms=28 booked=2 closes=2 cash=199900 roas=6.38250319284802
  jake 2026-07-28..2026-07-28 all        spend=6845 dms=7 booked=0 closes=0 cash=0 roas=0
  jake 2026-07-27..2026-07-29 all        spend=10787 dms=11 booked=0 closes=0 cash=0 roas=0
  tyson 2026-07-27..2026-07-29 all       spend=82759 dms=69 booked=4 closes=3 cash=279900 roas=3.3821094986647977
  tyson 2026-07-23..2026-07-29 all       spend=240090 dms=198 booked=9 closes=5 cash=489900 roas=2.0404848181931774
  jake 2026-07-23..2026-07-29 all        spend=28560 dms=11 booked=0 closes=0 cash=0 roas=0

windows checked:      72
ad rows checked:      4276
number comparisons:   82612
mismatches:           0

GATE PASSED: every number the door returned equals the saved answer, and every
answer carried its definitions and a real as-of time.
```

### Phase 1 — `sales_cycle` against an independently written hand query

A second query of a different shape (a `LATERAL` sub-select instead of a grouped
CTE join):

```
src       measured  p25  median  p75   p90   min  max  within7  within14
HAND      125       1    1       3     12.2  0    42   106      115
FUNCTION  125       1    1       3     12.2  0    42   106      115
```

### Phase 1 — `attribution_share` against an independently written hand query

Four separate explicit counts instead of one `CASE` expression:

```
bucket                            sales     cash (cents)
HAND counted_by_the_tab           131       3562900
FUNCTION counted_by_the_tab       131       3562900
HAND proved_but_held_back           2        159900
FUNCTION proved_but_held_back       2        159900
HAND former_creator_ad             19        390000
FUNCTION former_creator_ad         19        390000
HAND no_ad_evidence                64       2139500
FUNCTION no_ad_evidence            64       2139500
```

### Phase 2 — THE TRIAL, through the Utari MCP endpoint over HTTP

Real bearer token, real JSON-RPC, nothing reaching into the app's own functions.
**Results only below; the keep-or-rebuild-Utari decision belongs to Alex and Fable.**

```
unauthenticated request status: 401 (locked, as it should be)

tools exposed: 17 (was 16, plus ask_question = 17)
every pre-existing tool still present: yes
ask_question present: yes

data_version pinned for this trial: 155
saved windows the tab can serve right now: 72

─── THE TRIAL TABLE (every numeric answer, through the Utari MCP endpoint) ───
question                                              utari      the tab  match
all 2026-07-29..2026-07-29 all spend                   8661         8661  yes
all 2026-07-29..2026-07-29 all messages                  11           11  yes
all 2026-07-29..2026-07-29 all booked                     1            1  yes
all 2026-07-29..2026-07-29 all taken                      0            0  yes
all 2026-07-29..2026-07-29 all newClients                 0            0  yes
all 2026-07-29..2026-07-29 all collected                  0            0  yes
all 2026-07-29..2026-07-29 all impressions             6977         6977  yes
all 2026-07-29..2026-07-29 all clicks                    54           54  yes
tyson 2026-07-29..2026-07-29 all spend                 4719         4719  yes
  ... and 552 more rows, all compared

numeric comparisons: 576   matched: 576   mismatched: 0
windows asked through Utari: 72 of 72
```

Every question on the list, asked for real, both creators:

```
yesterday_summary  tyson / jake       answered   as_of=2026-07-29T10:25:51
change_history     tyson / jake       answered   as_of=2026-07-28T23:27:48
ad_setup           tyson / jake       answered   as_of=2026-07-29T10:26:00
sales_cycle        tyson / jake       answered   as_of=2026-07-29T10:25:11
kill_scale_inputs  tyson / jake       answered   as_of=2026-07-29T10:25:51
why_unattributed   tyson / jake       answered   as_of=2026-07-29T10:25:11
person_lookup      tyson / jake       answered   as_of=2026-07-29T10:25:53
attribution_share  roster-wide        answered   as_of=2026-07-29T10:25:11
leak_map           roster-wide        answered   as_of=2026-07-29T10:25:11
data_health                           answered   as_of=2026-07-29T08:45:52
define                                answered   as_of=2026-07-29T10:26:02
```

Refusal behaviour, through the same door:

```
a question that is not on the list       refused, in writing
a creator who has left the roster        refused, in writing
a window that was never saved            refused, in writing
a malformed date                         refused, in writing
a filter this question does not take     refused, in writing
```

Freshness honesty:

```
utari's as-of for warehouse.answers:        2026-07-29T10:25:51.2+00:00
the newest saved answer's real write time:  2026-07-29T10:25:51.2+00:00
same instant: yes
```

The repointed `list_ads`, keeping its old shape and units:

```
tyson    ads= 108 window=2026-06-30..2026-07-29
  top ad: keyword=fit spend=$3362.18 cash=$12030 roas=3.58 gross_profit=null
  spend in DOLLARS: tool total $12903.13 vs saved answer $12903.13 (agrees)
jake     ads=  59 window=2026-06-30..2026-07-29
  top ad: keyword=course spend=$1274.74 cash=$0 roas=0 gross_profit=null
  spend in DOLLARS: tool total $2076.01 vs saved answer $2076.01 (agrees)
```

Verdict, results only:

```
calls made over HTTP: 98   median 1004ms   95th percentile 2278ms   slowest 8733ms
numeric match rate: 576/576 (100.00%)
GATE PASSED
```

### Phase 3 — the thirteenth check, on live data

```
checks registered: 13 (was 12, plus one_front_door = 13)
running: one_front_door — "The AI's answer equals the screen's"

status:       GREEN
numbers the AI door returned: 576
of those, equal to the screen's saved answer: 576
difference:   (none)
detail:       {"dataVersion":155,"savedWindows":72,"refusedWindows":[],"mismatches":[]}
took:         16834ms of its 90000ms budget
```

Its written tolerance, stored on every row it ever writes:

> The question door and the Ads v2 tab must return the identical number, because
> they read the identical saved row. There is NO tolerance here and there is no
> honest lag to allow: both sides read the same snapshot at the same data
> version, so a difference cannot be timing and can only be a fault in the door.
> Any difference at all is red. A window the door refuses to serve is also red,
> because the tab would have served it.

---

## 6. Deviations from the spec, all deliberate

1. **Sixteen Utari tools kept, not seven** (adjustment A1). The spec's count was
   stale. Keeping only seven would have broken Jeremy's agent.
2. **`attribution_share` and `leak_map` are roster-wide, not per creator**
   (adjustment A4). Asked per creator they would have silently returned only the
   attributed slice and hidden the entire point of the question.
3. **`budget` and `name` are refused as window metrics** (adjustment A3), by name
   and with the reason, and answered by `ad_setup` / `change_history` instead.
4. **The thirteenth check runs its 72 questions six at a time**, not one after
   another. End to end took 76 seconds of its 90 second budget, which is the
   exact shape of the fault Build 3's law 14 exists to prevent. Six at a time
   finishes in 17 seconds. No window is sampled away; all 72 are still checked.
5. **`gross_profit` and `gross_profit_roas` now return `null`, not a number.**
   They came from v1's unit-economics model, which the saved answers do not
   carry. Returning 0 would read as "made no profit", a different and wrong
   statement from "we are not reporting this". See the note for Jeremy below.

---

## 7. The note for Jeremy (Alex can send this as-is)

> Two small changes to the CCOS tools your agent uses. Nothing was removed and
> every tool name and field name is the same.
>
> **1. The per-ad numbers now come from the same saved rows the Ads dashboard
> itself paints from.** They are checked against the dashboard every day and
> currently match on every number. Units are unchanged: spend, cash and the
> cost-per figures are still in dollars.
>
> **2. `gross_profit` and `gross_profit_roas` now come back empty.** They came
> from an older profit model that the new saved numbers do not carry, and we
> would rather send you nothing than send you an estimate dressed up as a fact.
> Everything else, including ROAS on collected cash, is unchanged.
>
> **3. The `client` list is now Tyson and Jake.** Antwan left the roster on 21
> July, so asking for him returns a clear message saying so instead of a silently
> empty answer.
>
> **4. There is one new tool, `ask_question`.** It is a locked list of twelve
> questions about the money system: the numbers, plus the written meaning of
> every number and how fresh the data is. Call it with no arguments to see the
> whole list. It never makes up a query, and anything not on the list comes back
> refused with the nearest allowed question named. Note that money in
> `ask_question` answers is in **cents**, unlike the older per-ad tools, and each
> number's quoted definition names its format.

---

## 8. What Build 4 did NOT do

No chat UI, no new tabs, no dashboards. No reader switched except Utari (Sales
Hub and Home are Build 5). No new cache or store. Utari gained no access it did
not already have: `ask_question` reads the same saved answers and stamped facts,
and there is still no raw SQL, no schema browsing, and no DM text beyond what its
existing tools already returned. Nothing was archived, deleted, renamed, or
written to any money table. The Google Sheets were not touched. v1 is untouched.

---

## 9. For Fable to re-verify

- `select count(*) from adsv2_window_snapshots where data_version = (select (value)::bigint from adsv2_meta where key='data_version')` should be 72 (8 presets x 3 accounts x 3 statuses).
- Re-run `scripts/question-door-proof.mts` and `scripts/run-check-13.mts`; both pin the version themselves, so they are safe to run at any time and write nothing.
- Re-run `scripts/utari-trial.mts` against a running app with `UTARI_MCP_TOKEN` set.
- The Hunter Chapman finding in section 3 is the one thing here that is a real, open question about money, and it was deliberately not touched.
