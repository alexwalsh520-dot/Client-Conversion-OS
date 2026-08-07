# Truth Layer, Brick 4: The Trust Pack

**Built 2026-08-07. Migrations 078 to 081. Branch `truthlayer-brick4`.**

Brick 2 made coverage HONEST: every money answer admits what it has not classified. Brick 4 makes coverage IMPROVE.

Business-wide, since the attribution floor of 2026-05-22, this brick moved **6 wins and 12,698.00 USD** out of the awaiting-review gap and into a classified bucket, flagged 4 organic sales at the source instead of only at the door, and turned "which rows are still open" from a query somebody has to write into a question with a certified answer.

**Locked list: 14 to 17.** No earlier question's numbers changed.

---

## The finding that shaped the brick

The spec asked capture_health to find broken organic automations by finding "DM threads whose first inbound message text equals a registered organic keyword but which produced no keyword event". That is a per-person join, and it cannot be built. Measured on the live database, 2026-08-07:

| | distinct subscriber ids | of length >= 15 |
|---|---|---|
| `ads_keyword_events` | 7,585 | 0 |
| `dm_conversation_messages` | 29,897 | 29,848 |
| **present in BOTH** | **1** | |

One id in common out of 7,585. The keyword events carry ManyChat subscriber ids (9 to 10 digits); the DM messages carry Instagram-scoped ids (16 digits). They are different id spaces, and bridging them is Brick 5.

The obvious detector, written across those two tables, returns **every** organic keyword sender as a break, every day, forever, including all the ones the automation handled perfectly. It would be a false-alarm engine wearing a trust badge, which is worse than having no detector at all: the first week nobody believes it, the second week nobody reads it.

So the detector compares **cohort counts** per creator, per keyword, per day: how many people said the word, against how many events were recorded. It never claims to know that a particular DM belongs to a particular event. It needs no identity bridge, and it reproduces the real history without being told it.

This is why golden fixture (e) could not be met as written. See "Fixtures I could not meet as specified" below.

---

## What shipped

### Migrations

| Migration | What it does |
|---|---|
| `078_labeler_organic_and_human_non_ad.sql` | Labeler parts C and D. Adds `human_confirmed_non_ad` to the `blank_reason` CHECK. |
| `079_labeler_backfill_since_attribution_floor.sql` | Runs the upgraded labeler over the full history since 2026-05-22. |
| `080_door_coverage_v2_and_capture_health.sql` | `door_coverage_block` v2, the resolution queue, deposits pending close, four capture-health reads, one new threshold, four sources that report their freshness for the first time. |
| `081_adsv2_sync_single_flight.sql` | `adsv2_claim_sync_lock` and `adsv2_release_sync_lock`. |

The labeler had **no migration file at all** before this: `adsv2_label_sale_origins` lived only in the database, so the repo could not tell you what the labeler did. 078 reproduces parts A and B character for character alongside the new parts, which fixes that.

### Code

| File | Change |
|---|---|
| `coverage-report.ts` (new) | Question 15. |
| `resolution-queue.ts` (new) | Question 16. |
| `capture-health.ts` (new) | Question 17. |
| `registry.ts` | Three entries added, none changed. Four new stored places named. |
| `receipts.ts` | Reads the three new coverage columns; two caveat rules gated on money. |
| `service.ts` | Passes `money` into the receipt assembly. |
| `ads-v2/sync.ts` | `claimSyncLock` / `releaseSyncLock` replace the read-then-write `acquireLock`. |
| `brick4.golden.test.ts` (new) | 22 fixtures against the real database. |
| `ads-v2/sync-lock.test.ts` (new) | 6 unit, 4 live concurrency. |

---

## Part A: the labeler, and what the backfill actually moved

### Part C, the organic flag

`organic_keywords v1` says organic sales never enter ad ROAS. Before this brick, **all four** organic-keyword wins carried `is_organic = false`, and Brick 2's belt-and-suspenders registry rule in `door_coverage_block` was doing 100% of the work. Brick 2's own report flagged this and did not fix it, correctly, because the labeler was out of its scope.

The rule is scoped **per client**, and that is not a detail. `ready` is a marked ORGANIC keyword for Jake and was a retired AD keyword for Tyson. A flat keyword list would flip Tyson's 2026-06-12 `ready` sale to organic and strip 1,200.00 USD out of ad ROAS six weeks before Jake's organic use began. `registry_keywords` is read with both keys, always. I verified before shipping that no `(keyword, client)` pair is both ad and organic for the same client, so the rule cannot collide with "paid takes precedence while an ad is live".

### Part D, human-confirmed non-ad

A resolution row with `keyword_normalized IS NULL` is a person saying "I opened the thread; there is no ad in it". The labeler read only resolutions that carried a keyword, so those rows sat in the awaiting-review queue being re-reviewed by every reader who looked at the gap. A resolution that changes nothing teaches people that resolving changes nothing.

### The backfill, before and after

Run over 2026-05-22 to 2026-08-07 with roster `{tyson, jake}`. **12 rows changed on the first run, 0 on the second** (idempotent, verified live).

Business-wide buckets, 2026-05-22 to 2026-08-07:

| bucket | wins before | wins after | cash before | cash after |
|---|---|---|---|---|
| ad | 76 | 76 | 10,162,300 | 10,162,300 |
| organic | 4 | 4 | 470,000 | 470,000 |
| misc_chat | 0 | **6** | 0 | **1,269,800** |
| awaiting_review | 47 | **41** | 5,289,300 | **4,019,500** |
| **total** | **127** | **127** | **15,921,600** | **15,921,600** |

**Nothing entered or left the ad bucket. No money number changed.** What changed is the honesty of the labels on it: 6 wins worth 12,698.00 USD moved from "nobody has looked" to "somebody looked and it is not an ad".

Tyson, 2026-06-24 to 2026-07-31: awaiting_review 22 to 16 wins, misc_chat 0 to 6, classified coverage **55.3% to 76.1% of wins**.

---

## The decision I did NOT make, and why

Part D resolved 8 rows. Six carry the team's own `callType = "Miscellaneous Chat"`, so the existing signed priority moves them into misc_chat with no rule change at all.

**Two do not.** Drake McGinley's callType is "Strategy Session" and Hunter Fleek's is "Onboarding Call" (240,000 cents between them). A person opened both threads and confirmed there is no ad in either. They are classified by any ordinary meaning of the word. But `certainty_buckets v1` defines MISC CHAT strictly as the team's own callType field reading "Miscellaneous Chat", and theirs does not. **No signed bucket covers them.**

Three options, one of them honest:

- call them misc_chat anyway: the door inventing a value for a sheet field it can read. No.
- invent a fifth bucket: a bucket nobody signed, quietly entering every receipt. No.
- count them in the gap, and NAME them: understates coverage, states exactly why, hands the owner a decision.

The third. This is the same shape as Brick 3's `tree_unresolved`: where the signed rules do not reach, the answer says so instead of guessing, and the resolution is a registry change the owner signs, not code freelancing. Coverage may understate itself; it may never overstate itself.

`door_coverage_block` gained three columns to say this out loud, and every receipt now carries the sentence:

> 2 of those, worth 2400.00 USD, are still counted in the awaiting-review gap even though a person HAS classified them. Their callType is not "Miscellaneous Chat", and certainty_buckets v1 defines misc chat strictly by that field, so no signed bucket covers them.

**OPEN FOR ALEX, one question:** should a human-confirmed non-ad sale count as classified regardless of its callType? If yes, that is a `certainty_buckets v2` signature and a one-line change to the bucket rule. If no, these 2 stay in the gap permanently and the number is correct as it stands. Nothing is blocked either way.

---

## Part B: the three new questions

### 15. `coverage_report`

The four buckets for a window, the same buckets for the three windows before it at equal length, and the business-wide view alongside any per-creator one. Plus `deposits_pending_close`, which implements a sentence `win_definition v1` has carried since it was signed and which nothing had ever built: cash-bearing PCFU rows surface so the money is visible without ever being counted as wins.

The business-wide block is on **every** answer, including a per-creator one. That is the Brick 2 law, not a convenience: every awaiting-review win carries no creator, so a per-creator coverage number standing alone cannot be reconciled with the money.

Live, Tyson 2026-06-24 to 2026-07-31, the movement line reads:

> classified coverage is 20.8 points higher than the window before.

That sentence is the whole brick. Brick 2's number was honest and static. This one has a direction.

### 16. `resolution_queue`

Every awaiting-review win, newest first, with the ManyChat link joined from the tracker row on the hard sale key. This is the list Alex hand-worked on 2026-07-31 and again on 2026-08-07, rebuilt from a fresh query both times. A working list that has to be reconstructed before it can be worked is a list nobody works.

`door_miss_backlog` is the certification backlog for QUESTIONS. This is the certification backlog for MONEY.

Zero-cash rows (the Hugo Magana class) are split into `zero_cash_oddities`: still counted in every total and every coverage block, but listed apart, because a win worth nothing is never worth anyone's minute, so it is never resolved, so it sits in the gap forever making the queue look worse than it is.

`likely_fastest_to_resolve` flags rows whose subscriber DID produce keyword events, since those are one-look decisions.

### 17. `capture_health`

Five pipes, each with go / degraded / no_go and its evidence. Live result, 14 days to 2026-08-07:

```
overall: degraded
- keyword_events_flowing   => go        every creator produced a keyword event inside the 24 hour
                                        threshold: jake 1.4h ago, tyson 1.8h ago.
- webhook_keyword_misses   => degraded  15 of 74 sales carrying a ManyChat subscriber id (20.3%)
                                        have NO keyword event for that subscriber at all.
- organic_automation       => degraded  19 of 25 organic keyword senders across 10 of 15 active
                                        days produced no keyword event. Events ARE flowing, so the
                                        automation is running and dropping people rather than
                                        being down.
- misc_chat_recoverable    => go        none of the 2 misc-chat wins belong to a subscriber with
                                        keyword events before the sale.
- stored_source_freshness  => go        every watched source is inside its stored threshold.
```

**Three outcomes, not two, and the middle one is the point.** A pipe with events flowing but misses present is not healthy and is also not down. Collapsing that into no_go makes every partial loss look like an outage and the reader stops reacting to either; collapsing it into go throws away the only early warning there is.

`certainty_buckets v1` anticipated this question in writing: *"broken organic-keyword automations have mislabeled some real keyword leads as misc chat; capture_health (Q7) watches for keyword-recoverable misc chats."* This is that watch.

The threshold for `ads_keyword_events` is **24 hours**, and it is measured rather than picked: over the 30 days to 2026-08-07 the largest real gap between consecutive keyword events was 11.0 hours for Tyson and 19.1 hours for Jake. 24 sits above every gap either creator has actually produced, so it has never yet fired on healthy behaviour.

---

## The organic outage, reproduced from the data

The cohort detector found this without being told it existed:

| day | tyson LOCKED senders | events | jake READY senders | events |
|---|---|---|---|---|
| 2026-07-24 | 3 | **0** | 1 | **0** |
| 2026-07-25 | | | 3 | **0** |
| 2026-07-26 | | | 2 | **0** |
| 2026-07-28 | 1 | **0** | | |
| 2026-07-29 | 2 | **0** | | |
| 2026-07-30 | | | 1 | **0** |
| 2026-08-01 | 1 | **0** | 1 | **0** |
| 2026-08-02 | 3 | **0** | | |
| 2026-08-03 | 4 | **0** | | |
| 2026-08-04 | 1 | 1 | 1 | 1 |
| 2026-08-05 | 1 | **0** | | |
| 2026-08-06 | 1 | 1 | 0 | 1 |
| 2026-08-07 | 2 | 2 | 1 | 2 |

Zero organic keyword events existed in the entire database before 2026-08-04. The break Alex found by hand on 2026-08-02 is the run of zeroes; the recovery on 8/04 is real; and 8/05 shows one Tyson sender with no event, which is why that window reports **degraded** rather than go or no_go.

---

## Part C: the sync single-flight

### What I found, and it is not what the standing prompt describes

The standing prompt (`CCOS-SyncLock-Fix-Opus-Prompt.md`) documents twin runs every hour at :25, pinned to 2026-07-31. **That is no longer happening.** Over the four days to 2026-08-07, `adsv2_sync_runs` shows exactly one budget row and one facts row per hour, with zero duplicate-key errors. The only hours with doubles are three on 2026-08-04, which is the day of the Jake status-null incident and its manual re-runs.

So I could not reproduce the chronic hourly double-fire, and I am not going to claim I fixed something I could not observe failing.

**The race is still real, and it still shipped.** `acquireLock()` was a read, then a write:

```ts
const { data } = await db.from("adsv2_meta").select(...)   // read
if (held?.at && now - held.at < TTL) return false;
await db.from("adsv2_meta").upsert({ at: now });            // write
return true;
```

Two callers inside the same few milliseconds both read a free lock and both proceed. That lock never prevented a double entry; it only narrowed the window. It protects nothing against a manual "Sync Now" colliding with the cron, which is the collision most likely to happen next.

### The fix

One statement. `INSERT ... ON CONFLICT DO UPDATE ... WHERE` takes a row lock, so a second caller blocks on the row until the first commits and then re-evaluates the guard against what the winner wrote. There is no window between the read and the write because there is no separate read.

- The loser exits **before any fetch and before any write**, returning `{ran: false, skipped: true, reason}` and leaving one `adsv2_sync_runs` row with source `skipped`.
- A claim older than the 15 minute TTL is taken over (crash recovery), and the takeover is recorded in the row and in a `lock_takeover` run row.
- Release is **holder-scoped**: a runner that hung past the TTL and lost its lock cannot free the lock its rescuer now holds.
- **No upserts were added to the facts inserts.** That duplicate-key error is a correct alarm for concurrent execution; silencing it would hide the next concurrency bug behind a green run. The lock removes the cause; the alarm stays armed.

### Live proof of the atomicity

```
✔ LIVE: two concurrent claims produce exactly ONE winner (1614.71125ms)
✔ LIVE: a claim older than its TTL is taken over, and the takeover is recorded (1926.294375ms)
✔ LIVE: a cleanly released lock is claimable at once, with no TTL wait (2391.73325ms)
✔ LIVE: the PRODUCTION lock row is left free by this whole test file (442.263167ms)
```

Six callers fired together, one winner, run three times with no flake. That proof cannot come from a fake: the atomicity belongs to Postgres, not to us, and a mock would prove only that the mock is deterministic. This matters because the bug being fixed was exactly that shape: the old `acquireLock()` would have passed any reasonable unit test, since each individual step did what it said.

---

## Test output, verbatim

### Brick 4 goldens, against the real database

```
✔ GOLDEN a1: the 4 LOCKED wins carry is_organic at the SOURCE, not only at the door (659.88175ms)
✔ GOLDEN a2: door coverage for 2026-06-24 to 2026-07-31 tyson still sums exactly (280.852ms)
✔ GOLDEN a3: Brick 2's own hand-verified window is UNCHANGED by this brick (307.980542ms)
✔ GOLDEN b1: the 8 rows reviewed on 2026-07-31 are stamped human_confirmed_non_ad (324.769292ms)
✔ GOLDEN b2: the 6 misc-chat ones count as misc_chat; the 2 others are NAMED, not hidden (318.9555ms)
✔ GOLDEN b3: the labeler is idempotent, so a re-run stamps nothing twice (401.868208ms)
✔ GOLDEN c0: the prior windows are equal length and butt up against each other (0.318834ms)
✔ GOLDEN c1: coverage_report's current window matches door_coverage_block exactly (3474.407333ms)
✔ GOLDEN c2: three prior windows compute, and business-wide is ALWAYS present (1367.838416ms)
✔ GOLDEN c3: deposits pending close reports the one cash-bearing PCFU row (1512.640791ms)
✔ GOLDEN d1: the queue is exactly the awaiting-review wins, verified against the facts (1323.914667ms)
✔ GOLDEN d2: every queued row that has a tracker match carries its ManyChat link (1480.952334ms)
✔ GOLDEN d3: the zero-cash oddities are split out but still counted (1049.377833ms)
✔ GOLDEN e0: worst() never lets an unhealthy pipe round up to go (0.485417ms)
✔ GOLDEN e1: the organic detector reproduces the 7/24 to 8/03 outage (476.542ms)
✔ GOLDEN e2: after the 8/04 recovery the pipe reads DEGRADED, not no_go (1236.0465ms)
✔ GOLDEN e3: capture_health is a TRUST answer: no coverage block, and it says why (1403.562041ms)
✔ GOLDEN e4: the webhook-miss pipe finds the real lead_engaged gap (282.735292ms)
✔ GOLDEN e5: the DM and keyword id spaces really are disjoint, which is why e1 is a cohort test (657.786667ms)
✔ GOLDEN g1: the locked list is 17, and Brick 4 added exactly three (0.377417ms)
✔ GOLDEN g2: each new question is reachable ONLY through the door, and refuses junk params (1.174334ms)
✔ GOLDEN g3: every new answer carries a receipt with a real window and a caller (3927.5215ms)
ℹ tests 22
ℹ pass 22
ℹ fail 0
ℹ skipped 0
```

### Sync single-flight

```
✔ a winning claim is reported as claimed (0.6825ms)
✔ a losing claim names who is holding it, so the skip row can say (0.107625ms)
✔ a TTL takeover is reported as a takeover, not as an ordinary claim (0.086334ms)
✔ a single object, not an array, is read the same way (0.082375ms)
✔ a claim that cannot be READ throws, so the sync refuses to run (0.329625ms)
✔ an empty reply is treated as NOT claimed, never as claimed (0.079666ms)
✔ LIVE: two concurrent claims produce exactly ONE winner (1614.71125ms)
✔ LIVE: a claim older than its TTL is taken over, and the takeover is recorded (1926.294375ms)
✔ LIVE: a cleanly released lock is claimable at once, with no TTL wait (2391.73325ms)
✔ LIVE: the PRODUCTION lock row is left free by this whole test file (442.263167ms)
ℹ tests 10
ℹ pass 10
ℹ fail 0
```

### Full repo suite

```
ℹ tests 300
ℹ pass 299
ℹ fail 1
ℹ skipped 0
```

**Baseline measured, not assumed.** I ran the suite on a clean worktree of `origin/main` at `c2c166c` before comparing:

```
ℹ tests 268
ℹ pass 266
ℹ fail 2
```

268 + 32 new = 300. The two baseline failures were:

1. `ads-tracker-export.html inline app compiles`: pre-existing and unrelated. `public/ads-tracker-export.html` at `origin/main` contains no `<script type="text/babel">` block at all; this is the shared-file hazard already on record. I did not touch that file and did not fix it: it is outside this brick.
2. `GOLDEN: the 4 LOCKED organic sales show up across 2026-06-24 to 2026-07-31`: **caused by my backfill**, and this is a genuine finding rather than a nuisance. See the changed assertions below.

Everything Brick 2 and Brick 3 pinned still passes, apart from the two assertions listed next.

---

## Every changed assertion, with before and after

Exactly two, both deliberate.

### 1. `brick3.golden.test.ts`, the locked-list count

```
before:  assert.equal(keys.length, 14);
after:   assert.equal(keys.length, 17);
```

The locked list grew on purpose. It is a count of certified questions, not a behaviour. I also added a positive check that all three new keys are present, so the number cannot drift without the names drifting too.

### 2. `coverage.golden.test.ts`, the misc-chat overlap

```
before:  assert.match(c.note, /Miscellaneous Chat/);
after:   assert.equal(c.buckets.misc_chat.wins, 6);
         assert.equal(c.buckets.misc_chat.cash_usd_cents, 1269800);
```

Brick 2 could only REPORT the overlap: 6 wins in that window carried the team's "Miscellaneous Chat" label AND were awaiting review, so they counted as the gap and the note said so. Brick 2's own report predicted this exact change: *"When labeler part D lands, those 18 rows move to misc_chat and coverage will rise."*

Part D has landed. Those 6 are resolved, the overlap for that window is now 0, and the sentence the old assertion matched is correctly gone. The new assertion pins the outcome that replaced it, which is a stronger claim: the rows did not just get described, they got classified.

Worth being explicit: in my branch the old assertion would have **passed by accident**, because my new note text happens to contain the words "Miscellaneous Chat" in a different sentence. I updated it deliberately rather than leaving a green test that was green for the wrong reason.

---

## Three defects this brick found in its own output

All three were found by running the new questions and reading what came back, not by reasoning about them.

### 1. A caveat that fired on every single answer

`coverage_report` names `sales_tracker_rows` as a freshness source. Brick 2 seeded a staleness threshold for it and noted honestly that nothing compared it, because `question_door_freshness()` never reported that source. Harmless until a question named it: a source with a threshold and no reported write time is flagged stale **by design**, so every coverage_report answer carried a permanent

> sales_tracker_rows reported no write time at all, so its freshness is unknown

which was about the reporting function, not about the data. Fixed by adding `sales_tracker_rows`, `dm_conversation_messages`, `ads_keyword_events` and `adsv2_budget_snapshots` to `question_door_freshness()`. No existing answer's freshness list moves: every previously reported row is returned unchanged, in the same order.

### 2. The same bug one level down, inside capture_health

Brick 3 seeded a 26 hour threshold for `adsv2_budget_snapshots` and nothing reported its write time either, so capture_health's own freshness pipe read `unknown` forever and sat permanently at `degraded`. Same fix. That pipe now reads `go` on real evidence.

### 3. A money caveat on an answer that reports no money

`capture_health` came back carrying *"its cash and close numbers will keep rising after this answer was given"* and Jake's AUD conversion note, on an answer that reports no cash, no closes and no spend. Two of Brick 2's caveat rules fire on any answer with a window, which was harmless while every windowed question was a money question; capture_health is the first that is not.

Both rules are now gated on `receipt.money`. Brick 2 made this exact point about a currency note that fired on the wrong creator: a caveat that fires when it does not apply trains the reader to skip caveats, which costs more than the caveat was ever worth. `capture_health`'s receipt now carries one caveat, its own standing note.

**Note for the auditor:** this changes the caveat list of any pre-existing question that is `money: false` and has a window. In practice that is `change_history` only, and it loses a sales-lag sentence about cash it never reported. No number changes anywhere.

---

## Two bugs the tests caught in my own work

### `took_over` was silent on the one case it exists for

The flag was derived from the TTL comparison: "did the previous claim look expired before I claimed it". A takeover forced with a zero-second TTL therefore reported `took_over = false`, because by that TTL the previous claim counted as expired and so as "free". The field whose entire job is to say "the last run never finished" was silent on exactly that case.

Fixed: `took_over` now means we claimed a lock somebody was still nominally holding (a previous holder existed and had not released), which is what a reader needs it to mean.

### Every loser named a holder that had already gone

The "before" read in the claim function happens outside the row lock. Under a real double-fire, both twins read the same pre-existing holder: whoever ran an hour ago. Six concurrent callers produced one winner correctly, and then **all five losers named a holder that no longer held anything**. That would have put a stale name in every skip row and in the sync history, which is the kind of plausible-looking wrong detail that costs an hour when somebody investigates.

Fixed: a loser re-reads and reports who holds it now. Only the losing path pays for the extra read, and the losing path is the cheap one by design.

### One hazard in the tests themselves

The first version of the LIVE lock tests claimed the **production** `sync_lock` row. An assertion that failed before its release call left the production lock held, and a real cron arriving in that window would have stood down for fifteen minutes because of a test. The claim and release functions gained a `p_lock_key` parameter so the tests use their own row, and a final test asserts the production row is left free by the whole file. A test that can wedge production is a hazard whatever it proves.

---

## Fixtures I could not meet as specified

### Fixture (e): "the organic-break detector finds at least the known historical LOCKED cases"

**It cannot, and no detector in this brick could.** The four LOCKED sales (Dany Jimenez, Andrew Sober, Evan Carlson, Will Lindsey) carry ManyChat subscriber ids like `1084646542`. `dm_conversation_messages` carries Instagram-scoped ids like `1398110531877329`. Those four people have **zero rows** in the DM store under their sale's subscriber id, so no query over those two tables can connect them. Alex recovered those cases by opening ManyChat threads by hand, which is a source this layer does not have.

I pinned the finding instead, as golden e5, so that if the identity bridge ever lands and the spaces converge, the test fails loudly and the cohort detector can be upgraded to a per-person one.

What e1 and e2 verify instead is stronger than the fixture asked for: the detector reproduces the **actual organic outage** (2026-07-24 to 2026-08-03, every arrival day at zero events), the actual recovery on 8/04, and reports `degraded` rather than `no_go` for the post-recovery window with misses still present, which is the second half of fixture (e) met exactly.

### Fixture (f), second half: "one real observed cron cycle after deploy"

Not yet observable. The sync change is committed but the cron runs at :25 past the hour, so a full cycle has to elapse after the deploy lands. **This is the one item in the brick that is not verified.** What IS verified: the atomicity proof above, three times without flake, plus the four days of `adsv2_sync_runs` history showing the chronic double-fire is already absent.

The check to run after the next :25:

```sql
SELECT source, status, started_at, error FROM adsv2_sync_runs
WHERE started_at > NOW() - INTERVAL '90 minutes' ORDER BY started_at DESC;
```

Expect exactly one `budget` row and one `facts` row per hour, and zero duplicate-key errors. A `skipped` row appearing would mean a real twin was stopped, which is the fix working rather than a fault.

### The misc-chat recoverable detector via the body-text bridge

The spec asked for misc-chat rows whose person "via the same body-text bridge, DID send a registered keyword". Blocked by the same id-space gap. Implemented instead over `ads_keyword_events` using the subscriber id the sale row already carries, which is the same id space and needs no bridge. It currently finds **zero** recoverables, which is correct: the labeler's part B already stamps any subscriber with a single pre-sale keyword, so there is nothing left for this route to recover. The pipe reports `go` honestly rather than reporting nothing.

---

## Other honest findings

- **`coverage_report`'s trend can run off the end of the data.** Asking for a 38 day window starting 2026-06-24 produces prior windows reaching back to 2026-03-02, and the sale facts only start 2026-06-08. Those windows correctly report 0 wins and 0% rather than erroring, and the `movement` line compares only against the immediately preceding window, so the headline is never distorted by empty history. Worth knowing before reading a trend over a long window.
- **`resolution_queue` reports 39 rows; `door_coverage_block` reports 41 awaiting.** Not a discrepancy. The queue reads `awaiting_review = true` on the facts, which the 2 human-confirmed non-ad rows no longer are. The coverage block folds those 2 into the gap because no signed bucket covers them. Both are right, and this is precisely the state the owner decision above would collapse.
- **The webhook keyword miss rate is 20.3% over 14 days and 123 of 415 sales all-time.** That is the real `lead_engaged` flow gap, now counted for the first time rather than known about. It is not a regression; it is a number that had never been measured.
- **`meta_graph_live` has a 1 hour threshold and health_check hardcodes `last_written_at: null` on the budget-snapshot entry of its own `asOf` array.** That is a Brick 3 template detail, so a permanent unknown-freshness flag remains on health_check's receipt. I did NOT change it: health_check is Brick 3's template and altering another brick's answer shape was not in scope. It is a one-line fix for whoever touches that file next.
- **The three new questions add no crons and no automation.** They read and report. Nothing auto-executes.

---

## Deliberately not in this brick

No identity bridge (Brick 5). No new kill-tree branch for the STRENGTH `tree_unresolved` case: that is a definitions decision awaiting the owner, and when he rules it lands as a signed registry change plus a fixture, not code freelancing. No workers, no crons for the new questions, no enforcement changes, no Meta writes, no v1 changes, nothing in the Google Sheets.

---

## Appendix: one full answer from each new question, pasted whole

These are the exact JSON documents the door returned on 2026-08-07, written straight to disk by a script that calls askQuestion and does nothing else to the result. Nothing below is retyped or trimmed.

### 15. coverage_report, asked as `{"client": "tyson", "date_from": "2026-06-24", "date_to": "2026-07-31"}`

```json
{
  "question_key": "coverage_report",
  "question": "How much of a window's wins and cash are classified, in the four signed buckets, for one creator and for the whole business side by side, plus the same buckets for the three windows before it so the gap can be seen shrinking or growing. Includes cash-bearing PCFU rows as deposits pending close.",
  "params": {
    "client": "tyson",
    "date_from": "2026-06-24",
    "date_to": "2026-07-31"
  },
  "answers": {
    "client": "tyson",
    "date_from": "2026-06-24",
    "date_to": "2026-07-31",
    "window_days": 38,
    "units": "Money is in CENTS.",
    "this_window": {
      "date_from": "2026-06-24",
      "date_to": "2026-07-31",
      "wins": 67,
      "cash_usd_cents": 8502100,
      "buckets": {
        "ad": {
          "wins": 41,
          "cash_usd_cents": 5362500
        },
        "organic": {
          "wins": 4,
          "cash_usd_cents": 470000
        },
        "misc_chat": {
          "wins": 6,
          "cash_usd_cents": 1269800
        },
        "awaiting_review": {
          "wins": 16,
          "cash_usd_cents": 1399800
        }
      },
      "classified_pct_wins": 76.1,
      "classified_pct_cash": 83.5
    },
    "business_wide": {
      "date_from": "2026-06-24",
      "date_to": "2026-07-31",
      "wins": 67,
      "cash_usd_cents": 8502100,
      "buckets": {
        "ad": {
          "wins": 41,
          "cash_usd_cents": 5362500
        },
        "organic": {
          "wins": 4,
          "cash_usd_cents": 470000
        },
        "misc_chat": {
          "wins": 6,
          "cash_usd_cents": 1269800
        },
        "awaiting_review": {
          "wins": 16,
          "cash_usd_cents": 1399800
        }
      },
      "classified_pct_wins": 76.1,
      "classified_pct_cash": 83.5,
      "roster": [
        "tyson",
        "jake"
      ],
      "why_always_shown": "Every awaiting-review win carries no creator, because nobody has classified it yet. A per-creator coverage number on its own therefore cannot be reconciled with the money, which is exactly how a false 100% gets reported. This block is here on every answer so it never has to be asked for."
    },
    "trend_prior_windows": [
      {
        "date_from": "2026-05-17",
        "date_to": "2026-06-23",
        "wins": 47,
        "cash_usd_cents": 5829700,
        "buckets": {
          "ad": {
            "wins": 26,
            "cash_usd_cents": 3629900
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
            "wins": 21,
            "cash_usd_cents": 2199800
          }
        },
        "classified_pct_wins": 55.3,
        "classified_pct_cash": 62.3
      },
      {
        "date_from": "2026-04-09",
        "date_to": "2026-05-16",
        "wins": 0,
        "cash_usd_cents": 0,
        "buckets": {
          "ad": {
            "wins": 0,
            "cash_usd_cents": 0
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
            "wins": 0,
            "cash_usd_cents": 0
          }
        },
        "classified_pct_wins": 0,
        "classified_pct_cash": 0
      },
      {
        "date_from": "2026-03-02",
        "date_to": "2026-04-08",
        "wins": 0,
        "cash_usd_cents": 0,
        "buckets": {
          "ad": {
            "wins": 0,
            "cash_usd_cents": 0
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
            "wins": 0,
            "cash_usd_cents": 0
          }
        },
        "classified_pct_wins": 0,
        "classified_pct_cash": 0
      }
    ],
    "movement": "classified coverage is 20.8 points higher than the window before.",
    "deposits_pending_close": {
      "rows": 1,
      "cash_usd_cents": 30000,
      "rows_detail": [
        {
          "day": "2026-07-09",
          "closer": "WILL",
          "setter": "Kelechi",
          "prospect": "Guillermo Vela",
          "cash_usd_cents": 30000
        }
      ],
      "note": "Cash-bearing PCFU rows: money in the door from someone the closers have not closed yet. Per win_definition v1 these are NOT wins and are never counted as wins, because a PCFU person who later buys gets a NEW row with outcome WIN and counting both would double them. They are surfaced here so the cash is visible rather than lost."
    },
    "bucket_key": {
      "ad": "a machine-stamped keyword, or a human resolution to an ad.",
      "organic": "a marked organic keyword from the registry, or a human resolution to organic. Never enters ad ROAS.",
      "misc_chat": "the team's own callType label reading Miscellaneous Chat, where the keyword is unknown. A CLASSIFIED bucket, not dark data: the team deliberately does not chase these.",
      "awaiting_review": "nobody has looked yet. The only bucket that counts as a gap."
    },
    "how_to_shrink_the_gap": "Ask resolution_queue for the working list. Every row there is one awaiting-review win with its ManyChat link. Resolving one moves it out of the gap on the next label run."
  },
  "definitions_quoted": [],
  "as_of": [
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-07T09:25:20.725987+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "sales_tracker_rows",
      "last_written_at": "2026-08-07T09:41:04.54+00:00",
      "note": "the last sales tracker sync"
    }
  ],
  "sources": [
    "adsv2_sale_facts",
    "registry_keywords",
    "sales_tracker_rows"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "coverage_report",
    "question_version": 1,
    "asked_at": "2026-08-07T09:47:30.859Z",
    "caller": "report",
    "params_as_resolved": {
      "client": "tyson",
      "date_from": "2026-06-24",
      "date_to": "2026-07-31"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-06-24",
      "to": "2026-07-31",
      "kind": "explicit_range"
    },
    "data_version": null,
    "freshness": [
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-07T09:25:20.725987+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "sales_tracker_rows",
        "last_written_at": "2026-08-07T09:41:04.54+00:00",
        "note": "the last sales tracker sync"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 67,
      "window_cash_usd_cents_total": 8502100,
      "buckets": {
        "ad": {
          "wins": 41,
          "cash_usd_cents": 5362500
        },
        "organic": {
          "wins": 4,
          "cash_usd_cents": 470000
        },
        "misc_chat": {
          "wins": 6,
          "cash_usd_cents": 1269800
        },
        "awaiting_review": {
          "wins": 16,
          "cash_usd_cents": 1399800
        }
      },
      "classified_pct_wins": 76.1,
      "classified_pct_cash": 83.5,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 14 of the 16 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 8 wins in this window have been reviewed by a person who confirmed it is not an ad sale. 2 of those, worth 2400.00 USD, are still counted in the awaiting-review gap even though a person HAS classified them. Their callType is not \"Miscellaneous Chat\", and certainty_buckets v1 defines misc chat strictly by that field, so no signed bucket covers them. They are counted in the gap rather than moved, because understating coverage is allowed and inventing a bucket nobody signed is not. This is a decision for the owner, not for this read."
    },
    "exclusions": [
      {
        "what": "anything that is not a WIN",
        "count": 0,
        "why": "coverage is measured on wins and their cash, per coverage v1. Calls that did not close are not part of it. Cash-bearing PCFU rows are reported separately as deposits pending close, because win_definition v1 says they must be visible without ever being counted as wins."
      }
    ],
    "caveats": [
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-07-31, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "16 wins worth 13998.00 USD in this window are still awaiting review, so 76.1% of wins and 83.5% of cash are classified. This answer is not a claim of full coverage."
    ],
    "certainty": "machine_certain",
    "definitions_cited": [
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
        "name": "certainty_buckets",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "win_definition",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "organic_keywords",
        "version": 1
      }
    ]
  }
}
```

### 16. resolution_queue, asked as `{"limit": 8}` (limited deliberately, so the truncated flag is visible)

```json
{
  "question_key": "resolution_queue",
  "question": "Every win still awaiting review, newest first: the day, the person, the cash, the tracker call type, the setter, the closer and the ManyChat link, so each one can be looked at and decided. Plus the zero-cash oddities listed separately so they stop haunting the queue.",
  "params": {
    "limit": 8
  },
  "answers": {
    "returned": 8,
    "limit": 8,
    "truncated": true,
    "total_cash_usd_cents": 959700,
    "units": "Money is in CENTS.",
    "with_manychat_link": 5,
    "without_manychat_link": 3,
    "likely_fastest_to_resolve": 2,
    "queue": [
      {
        "sale_key": "2026-08-06:call-34:edward-bobadilla",
        "day": "2026-08-06",
        "prospect": "Edward Bobadilla",
        "client": null,
        "cash_usd_cents": 80000,
        "call_type": "Miscellaneous Chat",
        "setter": "Amara",
        "closer": "BROZ",
        "subscriber_id": "361352483",
        "manychat_link": "https://app.manychat.com/fb1024471/chat/361352483?channel=instagram&messageID=25404198598",
        "subscriber_has_keyword_events": false,
        "blank_reason": "unknown"
      },
      {
        "sale_key": "2026-08-03:call-20:carlos-melendez",
        "day": "2026-08-03",
        "prospect": "Carlos Melendez",
        "client": null,
        "cash_usd_cents": 239900,
        "call_type": "Follow up",
        "setter": "Other",
        "closer": "WOBBE",
        "subscriber_id": null,
        "manychat_link": null,
        "subscriber_has_keyword_events": false,
        "blank_reason": "no_keyword_ever"
      },
      {
        "sale_key": "2026-08-02:call-5:racy-king",
        "day": "2026-08-02",
        "prospect": "Racy King",
        "client": null,
        "cash_usd_cents": 100000,
        "call_type": "Miscellaneous Chat",
        "setter": "Amara",
        "closer": "AUSTIN",
        "subscriber_id": "1093149971",
        "manychat_link": "https://app.manychat.com/fb1024471/chat/1093149971?channel=instagram&messageID=25404129741",
        "subscriber_has_keyword_events": false,
        "blank_reason": "unknown"
      },
      {
        "sale_key": "2026-07-22:call-162:jordan-houghtling",
        "day": "2026-07-22",
        "prospect": "Jordan Houghtling",
        "client": null,
        "cash_usd_cents": 199900,
        "call_type": "Outbound Call",
        "setter": "Erin",
        "closer": "ERIN",
        "subscriber_id": null,
        "manychat_link": null,
        "subscriber_has_keyword_events": false,
        "blank_reason": "no_keyword_ever"
      },
      {
        "sale_key": "2026-07-17:call-124:david-thain",
        "day": "2026-07-17",
        "prospect": "David Thain",
        "client": null,
        "cash_usd_cents": 239900,
        "call_type": "Outbound Call",
        "setter": "Other",
        "closer": "WOBBE",
        "subscriber_id": null,
        "manychat_link": "N/A",
        "subscriber_has_keyword_events": false,
        "blank_reason": "no_keyword_ever"
      },
      {
        "sale_key": "2026-07-08:call-59:kornell-robinson",
        "day": "2026-07-08",
        "prospect": "Kornell Robinson",
        "client": null,
        "cash_usd_cents": 20000,
        "call_type": "Strategy Session",
        "setter": "Amara",
        "closer": "BROZ",
        "subscriber_id": "1662629994",
        "manychat_link": "https://app.manychat.com/fb1409488/chat/1662629994?channel=instagram&messageID=25405207020",
        "subscriber_has_keyword_events": true,
        "blank_reason": "former_creator_ad"
      },
      {
        "sale_key": "2026-07-07:call-62:nate-margerum",
        "day": "2026-07-07",
        "prospect": "Nate Margerum",
        "client": null,
        "cash_usd_cents": 80000,
        "call_type": "Strategy Session",
        "setter": "Erin",
        "closer": "WILL",
        "subscriber_id": "480058360",
        "manychat_link": "https://app.manychat.com/fb1409488/chat/480058360",
        "subscriber_has_keyword_events": true,
        "blank_reason": "former_creator_ad"
      }
    ],
    "zero_cash_oddities": {
      "count": 1,
      "why_listed_separately": "A win worth nothing is never worth anyone's minute, so it is never resolved, so it sits in the gap forever making the queue look worse than it is. These are still counted in every total and in every coverage block. They are listed apart so the rows that are worth a minute are not buried behind the rows that are not.",
      "rows": [
        {
          "sale_key": "2026-08-04:call-26:max-de-los-reyes",
          "day": "2026-08-04",
          "prospect": "Max De Los reyes",
          "client": null,
          "cash_usd_cents": 0,
          "call_type": "Outbound Call",
          "setter": "Erin",
          "closer": "WILL",
          "subscriber_id": null,
          "manychat_link": null,
          "subscriber_has_keyword_events": false,
          "blank_reason": "no_keyword_ever"
        }
      ]
    },
    "how_to_resolve": "Write one row into adsv2_sale_resolutions with the sale_key from this list. Put the keyword in keyword_normalized to attribute the sale to that keyword; leave keyword_normalized NULL to record \"I looked, this is not an ad sale\", which is a resolution too and closes the row just as firmly. Fill in resolved_by with who decided and note with what they saw. The labeler applies it on the next run: a keyword resolution stamps the keyword, and a NULL-keyword resolution stamps blank_reason human_confirmed_non_ad. Either way the row leaves this queue and stops being re-reviewed.",
    "link_note": "The ManyChat link comes from the tracker row, joined on the sale key the fact row already carries, so it is a hard key and never a name match. A row with no link is one whose tracker row carried none; it is still in the queue, because a queue shorter than the gap would be a lie about the gap."
  },
  "definitions_quoted": [],
  "as_of": [
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-07T09:25:20.725987+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "sales_tracker_rows",
      "last_written_at": "2026-08-07T09:41:04.54+00:00",
      "note": "the last sales tracker sync"
    }
  ],
  "sources": [
    "adsv2_sale_facts",
    "sales_tracker_rows",
    "ads_keyword_events"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "resolution_queue",
    "question_version": 1,
    "asked_at": "2026-08-07T09:47:33.041Z",
    "caller": "report",
    "params_as_resolved": {
      "limit": 8
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-07",
      "to": "2026-08-06",
      "kind": "explicit_range"
    },
    "data_version": null,
    "freshness": [
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-07T09:25:20.725987+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "sales_tracker_rows",
        "last_written_at": "2026-08-07T09:41:04.54+00:00",
        "note": "the last sales tracker sync"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 55,
      "window_cash_usd_cents_total": 7502000,
      "buckets": {
        "ad": {
          "wins": 39,
          "cash_usd_cents": 5252400
        },
        "organic": {
          "wins": 3,
          "cash_usd_cents": 370000
        },
        "misc_chat": {
          "wins": 3,
          "cash_usd_cents": 679900
        },
        "awaiting_review": {
          "wins": 10,
          "cash_usd_cents": 1199700
        }
      },
      "classified_pct_wins": 81.8,
      "classified_pct_cash": 84,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified. 8 of the 10 awaiting-review wins carry no creator at all, because nobody has classified them yet. They are counted here on purpose even when this answer is about one creator: leaving them out is exactly how a coverage number reads 100% while real money sits unclassified. 2 of the awaiting-review wins already carry the team's own \"Miscellaneous Chat\" label. They are counted as awaiting review rather than as misc chat, which understates coverage rather than flattering it. Moving them belongs to the labeler, not to this read. 5 wins in this window have been reviewed by a person who confirmed it is not an ad sale. 2 of those, worth 2400.00 USD, are still counted in the awaiting-review gap even though a person HAS classified them. Their callType is not \"Miscellaneous Chat\", and certainty_buckets v1 defines misc chat strictly by that field, so no signed bucket covers them. They are counted in the gap rather than moved, because understating coverage is allowed and inventing a bucket nobody signed is not. This is a decision for the owner, not for this read."
    },
    "exclusions": [
      {
        "what": "wins that have already been classified",
        "count": 0,
        "why": "this question is the OUTSTANDING work only. A win already stamped as ad, organic, misc chat or human-confirmed non-ad is finished, and listing it again would mean the queue never appeared to empty. Ask coverage_report for the whole picture."
      }
    ],
    "caveats": [
      "Write one row into adsv2_sale_resolutions with the sale_key from this list. Put the keyword in keyword_normalized to attribute the sale to that keyword; leave keyword_normalized NULL to record \"I looked, this is not an ad sale\", which is a resolution too and closes the row just as firmly. Fill in resolved_by with who decided and note with what they saw. The labeler applies it on the next run: a keyword resolution stamps the keyword, and a NULL-keyword resolution stamps blank_reason human_confirmed_non_ad. Either way the row leaves this queue and stops being re-reviewed.",
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-08-06, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "pricing_currency v1: One price book across creators: 3-month $1,200; 6-month standard $2,400 with frequent $2,200 closes (closer-level flexibility; the tracker is the record). Revenue reports in USD. Jake's ad account bills in AUD; spend converts at the synced fx rate. Non-USD sale rows convert at sale-date fx.",
      "Jake's ad account bills in AUD, so his spend in this answer has been converted to USD at the synced rate, while the sale money was already USD and was never converted.",
      "coverage v1: Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets (that is, classified), with AWAITING REVIEW counted and dollared separately as the true gap. Every money answer carries all four buckets in its receipt.",
      "10 wins worth 11997.00 USD in this window are still awaiting review, so 81.8% of wins and 84% of cash are classified. This answer is not a claim of full coverage."
    ],
    "certainty": "machine_certain",
    "definitions_cited": [
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
        "name": "certainty_buckets",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "win_definition",
        "version": 1
      }
    ]
  },
  "note": "Write one row into adsv2_sale_resolutions with the sale_key from this list. Put the keyword in keyword_normalized to attribute the sale to that keyword; leave keyword_normalized NULL to record \"I looked, this is not an ad sale\", which is a resolution too and closes the row just as firmly. Fill in resolved_by with who decided and note with what they saw. The labeler applies it on the next run: a keyword resolution stamps the keyword, and a NULL-keyword resolution stamps blank_reason human_confirmed_non_ad. Either way the row leaves this queue and stops being re-reviewed."
}
```

### 17. capture_health, asked as `{"days": 14}`

```json
{
  "question_key": "capture_health",
  "question": "Whether the pipes that feed the attribution numbers are still running: keyword events flowing per creator, webhook keyword misses, broken organic automations, misc-chat wins that are recoverable, and whether the stored sources are inside their thresholds. Each pipe gets go, degraded or no-go with the evidence behind it.",
  "params": {
    "client": "all",
    "days": 14,
    "sample": 5
  },
  "answers": {
    "client": "all",
    "date_from": "2026-07-25",
    "date_to": "2026-08-07",
    "days": 14,
    "checked_at": "2026-08-07T09:47:34.089Z",
    "overall": "degraded",
    "pipes": [
      {
        "pipe": "keyword_events_flowing",
        "verdict": "go",
        "evidence": "every creator produced a keyword event inside the 24 hour threshold: jake 1.5h ago, tyson 1.9h ago.",
        "detail": [
          {
            "client_key": "jake",
            "last_event_at": "2026-08-07T08:15:47.31+00:00",
            "hours_since_last": 1.5,
            "events_7d": 80,
            "events_30d": 108
          },
          {
            "client_key": "tyson",
            "last_event_at": "2026-08-07T07:54:28.368+00:00",
            "hours_since_last": 1.9,
            "events_7d": 233,
            "events_30d": 1191
          }
        ]
      },
      {
        "pipe": "webhook_keyword_misses",
        "verdict": "degraded",
        "evidence": "15 of 74 sales carrying a ManyChat subscriber id (20.3%) have NO keyword event for that subscriber at all. That is the lead_engaged flow gap: the person is in ManyChat, the sale knows their id, and the webhook never recorded them sending anything. Those sales can never be attributed to an ad by hard evidence.",
        "detail": {
          "rows_with_subscriber": 74,
          "rows_with_zero_events": 15,
          "miss_pct": 20.3,
          "sample": [
            {
              "day": "2026-08-07",
              "first_name": "Deep",
              "subscriber_id": "1256606345"
            },
            {
              "day": "2026-08-06",
              "first_name": "Edward",
              "subscriber_id": "361352483"
            },
            {
              "day": "2026-08-05",
              "first_name": "Sam",
              "subscriber_id": "753501199"
            },
            {
              "day": "2026-08-05",
              "first_name": "Alex",
              "subscriber_id": "1830148602"
            },
            {
              "day": "2026-08-04",
              "first_name": "Alexys",
              "subscriber_id": "551512414"
            }
          ]
        }
      },
      {
        "pipe": "organic_automation",
        "verdict": "degraded",
        "evidence": "19 of 25 organic keyword senders across 10 of 15 active days produced no keyword event. Events ARE flowing, so the automation is running and dropping people rather than being down.",
        "detail": {
          "by_day": [
            {
              "client_key": "jake",
              "keyword": "ready",
              "et_day": "2026-08-07",
              "dm_senders": 1,
              "keyword_events": 2
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-08-07",
              "dm_senders": 2,
              "keyword_events": 2
            },
            {
              "client_key": "jake",
              "keyword": "ready",
              "et_day": "2026-08-06",
              "dm_senders": 0,
              "keyword_events": 1
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-08-06",
              "dm_senders": 1,
              "keyword_events": 1
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-08-05",
              "dm_senders": 1,
              "keyword_events": 0
            },
            {
              "client_key": "jake",
              "keyword": "ready",
              "et_day": "2026-08-04",
              "dm_senders": 1,
              "keyword_events": 1
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-08-04",
              "dm_senders": 1,
              "keyword_events": 1
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-08-03",
              "dm_senders": 4,
              "keyword_events": 0
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-08-02",
              "dm_senders": 3,
              "keyword_events": 0
            },
            {
              "client_key": "jake",
              "keyword": "ready",
              "et_day": "2026-08-01",
              "dm_senders": 1,
              "keyword_events": 0
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-08-01",
              "dm_senders": 1,
              "keyword_events": 0
            },
            {
              "client_key": "jake",
              "keyword": "ready",
              "et_day": "2026-07-30",
              "dm_senders": 1,
              "keyword_events": 0
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-07-29",
              "dm_senders": 2,
              "keyword_events": 0
            },
            {
              "client_key": "tyson",
              "keyword": "locked",
              "et_day": "2026-07-28",
              "dm_senders": 1,
              "keyword_events": 0
            },
            {
              "client_key": "jake",
              "keyword": "ready",
              "et_day": "2026-07-26",
              "dm_senders": 2,
              "keyword_events": 0
            },
            {
              "client_key": "jake",
              "keyword": "ready",
              "et_day": "2026-07-25",
              "dm_senders": 3,
              "keyword_events": 0
            }
          ],
          "method": "COHORT counts per creator, per keyword, per day: how many people sent the word in their DMs against how many keyword events were recorded. It is deliberately NOT a person-to-person join, because ads_keyword_events and dm_conversation_messages use different subscriber id spaces (1 id in common out of 7,585) and joining them would report every organic sender as a break forever. Bridging those spaces is a later brick.",
          "what_this_cannot_say": "It cannot name WHICH people were dropped, only how many. Naming them needs the identity bridge."
        }
      },
      {
        "pipe": "misc_chat_recoverable",
        "verdict": "go",
        "evidence": "none of the 2 misc-chat wins belong to a subscriber with keyword events before the sale, so there is nothing here to recover by this route.",
        "detail": {
          "misc_chat_wins": 2,
          "recoverable": 0,
          "sample": [],
          "method": "Uses the ManyChat subscriber id the sale row already carries, which is the SAME id space as ads_keyword_events, so no identity bridge is involved. It cannot see a person whose thread carries the keyword but whose sale row pasted a different ManyChat account: that is the Hunter Chapman failure mode and it needs a human, or the identity bridge."
        }
      },
      {
        "pipe": "stored_source_freshness",
        "verdict": "go",
        "evidence": "every watched source is inside its stored threshold.",
        "detail": [
          {
            "source": "sales_tracker_rows",
            "last_written_at": "2026-08-07T09:41:04.54+00:00",
            "age_hours": 0.1,
            "threshold_hours": 24,
            "state": "fresh"
          },
          {
            "source": "adsv2_dm_facts",
            "last_written_at": "2026-08-07T09:25:20.411238+00:00",
            "age_hours": 0.4,
            "threshold_hours": 4,
            "state": "fresh"
          },
          {
            "source": "adsv2_budget_snapshots",
            "last_written_at": "2026-08-07T07:25:04.089+00:00",
            "age_hours": 2.4,
            "threshold_hours": 26,
            "state": "fresh"
          }
        ]
      }
    ],
    "outcome_key": {
      "go": "this pipe is working, on the evidence stated.",
      "degraded": "this pipe is running and losing some of what it should catch. It is its own outcome on purpose: folding it into no-go makes every partial loss look like an outage, and folding it into go throws away the only early warning there is.",
      "no_go": "this pipe is not doing its job, or could not be checked. Either way nothing here should be read as healthy."
    },
    "what_this_is_not": "This says whether capture is WORKING, never whether the ads are. An account can be capturing perfectly and losing money, and every pipe here would read go. Ask kill_scale_read for the money and health_check for whether the ads can deliver.",
    "standing_note": "certainty_buckets v1 already anticipates this question in writing: \"broken organic-keyword automations have mislabeled some real keyword leads as misc chat; capture_health watches for keyword-recoverable misc chats\". This is that watch."
  },
  "definitions_quoted": [],
  "as_of": [
    {
      "source": "ads_keyword_events",
      "last_written_at": "2026-08-07T08:15:47.31+00:00",
      "note": "the last keyword event the capture webhook recorded"
    },
    {
      "source": "adsv2_sale_facts",
      "last_written_at": "2026-08-07T09:25:20.725987+00:00",
      "note": "the newest stamped sale fact"
    },
    {
      "source": "sales_tracker_rows",
      "last_written_at": "2026-08-07T09:41:04.54+00:00",
      "note": "the last sales tracker sync"
    }
  ],
  "sources": [
    "ads_keyword_events",
    "dm_conversation_messages",
    "adsv2_sale_facts",
    "registry_keywords",
    "sales_tracker_rows"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "capture_health",
    "question_version": 1,
    "asked_at": "2026-08-07T09:47:34.089Z",
    "caller": "report",
    "params_as_resolved": {
      "client": "all",
      "days": 14,
      "sample": 5
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-25",
      "to": "2026-08-07",
      "kind": "explicit_range"
    },
    "data_version": null,
    "freshness": [
      {
        "source": "ads_keyword_events",
        "last_written_at": "2026-08-07T08:15:47.31+00:00",
        "note": "the last keyword event the capture webhook recorded"
      },
      {
        "source": "adsv2_sale_facts",
        "last_written_at": "2026-08-07T09:25:20.725987+00:00",
        "note": "the newest stamped sale fact"
      },
      {
        "source": "sales_tracker_rows",
        "last_written_at": "2026-08-07T09:41:04.54+00:00",
        "note": "the last sales tracker sync"
      }
    ],
    "stale": [],
    "coverage": null,
    "exclusions": [
      {
        "what": "any statement about how much money a break has cost",
        "count": 0,
        "why": "this question reports whether capture is working, never what the failure was worth. Sizing a break needs the identity bridge to say which people were lost, and that is a later brick. Ask coverage_report for what is currently unclassified."
      },
      {
        "what": "naming the individual people an organic automation dropped",
        "count": 0,
        "why": "the keyword events and the DM messages use different subscriber id spaces, with one id in common out of 7,585. The organic detector therefore compares cohort counts per day and can say HOW MANY were dropped but never WHICH. Joining across those spaces would report every organic sender as a break forever."
      }
    ],
    "caveats": [
      "Nothing here was changed or fixed. This question only looks. Anything it finds is BREAKAGE rather than a performance signal, so it is acted on when it is found rather than waiting for a sustained trend."
    ],
    "certainty": "machine_certain",
    "definitions_cited": [
      {
        "registry": "registry_definitions",
        "name": "certainty_buckets",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "organic_keywords",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "sale_to_ad_chain",
        "version": 1
      }
    ]
  },
  "note": "Nothing here was changed or fixed. This question only looks. Anything it finds is BREAKAGE rather than a performance signal, so it is acted on when it is found rather than waiting for a sustained trend."
}
```
