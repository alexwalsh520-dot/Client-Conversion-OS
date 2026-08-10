# Semantic Layer consolidation: the report

Started 2026-08-10. This document is written as the build runs, one section per
phase, and it says what actually happened rather than what was planned.

**Status right now: Phase 0 is complete and its gate passed. Phase 1 has NOT
started, because law 7 of this build says to stop and hand you a one-click, and
that one-click turned out to be real. It is at the top of the "What is waiting on
you" section below.**

---

## What is waiting on you

**One thing, and it takes about thirty seconds.**

The warehouse room is not reachable by the app's database client. Postgres will
happily let code read it, but the API layer in front of the database (PostgREST)
only serves schemas that are on an allow list, and that list currently reads
`public, graphql_public`. I proved this rather than assumed it, by asking the
live API for a warehouse table:

```
GET /rest/v1/definitions   with header  Accept-Profile: warehouse
406  {"code":"PGRST106","message":"Invalid schema: warehouse",
      "hint":"Only the following schemas are exposed: public, graphql_public"}
```

That list is a project setting, not a database setting, so no migration can
change it and neither can I. The click:

> Supabase dashboard, project `bostjayrguulwaltnbgt`
> Project Settings, then API
> the **Exposed schemas** field
> add `warehouse` next to `public`, then Save

Nothing breaks when you do it. Adding a schema to that list does not grant
anybody anything: every table in warehouse already has row level security on with
no policies, so the app's public keys still read zero rows from it. It only makes
the schema addressable, which is what the moves in Phases 1, 2 and 3 need in
order to repoint the code that writes.

Why it blocks the moves: when a table moves to warehouse we leave a view behind
in public so every reader keeps working untouched. That trick does not work for
writers, because Postgres views cannot accept `INSERT ... ON CONFLICT`, which is
what the sync uses everywhere. A writer must therefore be pointed at the new
schema directly, and the app can only address a schema that is exposed.

---

## Phase 0: groundwork. Complete, gate passed.

Nothing was moved, renamed or deleted in this phase. One role was created and one
migration was applied. Everything else is measurement.

### The door fixture panel, and a real problem found in it

Law 3 asks for byte-identical door answers at every phase. Before trusting that
as a gate I tested whether the door is byte-identical to **itself**, by capturing
the whole panel twice in a row with nothing changed in between. It was not, and
the reasons matter.

The panel is 19 questions with pinned parameters (script:
`scripts/door-fixtures.mjs`, fixtures: `docs/fixtures/door/`). Windows are pinned
to 2026-07-27 through 2026-08-09 rather than left on their trailing defaults, so
a capture taken either side of midnight Eastern is still comparing like with
like. The person used for `person_timeline` is a fixed person id who carries a
ManyChat id, a GoHighLevel id and an Instagram id, so the answer actually
exercises the identity bridge instead of an empty path.

Three things were found:

**1. The door is not stable across a sync run, by design.** Two captures 51
seconds apart straddled sync run 455 to 456. In the second one, a `shown` count
in a **closed historical window** (2026-07-12 to 2026-07-26) moved from 4 to 5.
That is not a bug: new hard-key evidence landed and an old window got more
accurate. But it means a naive before-and-after diff would report ordinary data
arrival as a consolidation regression. The gate now records the `data_version` of
every capture and **refuses to rule at all** when two captures come from
different sync runs, rather than ruling wrongly. In practice this means capturing
each phase's pair inside one hour, away from :25 past the hour.

**2. Two questions cannot be value-gated at all, because they are clock
thresholds.** Two captures 29 seconds apart, same sync run, disagreed only
because the stored budget photo aged from 26.0 hours to 26.1 hours and crossed
its 26 hour freshness line. That single tick flipped seven budget dials from
fresh to stale, flipped `capture_health` from `degraded` to `no_go`, and rewrote
the wording of the receipt. `budget_map` and `capture_health` are therefore gated
on **shape** instead of value: every key path their answer contains must still be
present after a move, which is the thing a schema move could actually break. This
is written down in the script next to the code that does it, so nobody later
mistakes it for laziness.

**3. Ages and timestamps hide inside sentences.** The `capture_health` evidence
line reads like "every creator produced a keyword event inside the 24 hour
threshold: jake 3.5h ago, tyson 0.7h ago". Blanking timestamp *fields* is not
enough when the timestamp is prose. The normaliser now blanks ISO timestamps and
age phrases inside strings too.

After those three fixes, the proof:

```
data_version in phase0-baseline: 456
data_version in phase0-selfcheck: 456
identical: 19 of 19
GATE PASS: every door answer is identical once the documented clock-driven fields are blanked.
```

That is the baseline every later phase is measured against. Both the raw answers
and the normalised ones are committed, so a surprising diff later can always be
read back to the real numbers it came from.

### A live condition worth knowing about, found while capturing

The stored budget photo was 26 hours old at capture time, past its own 26 hour
threshold, so all seven budget dials currently answer with a stale flag. This is
not caused by anything in this build and it was already true before I started. It
means `budget_map` is answering from yesterday's photo. Worth a look separately.

### The boundary credential

Migration `100_ai_marketing_readonly_role.sql`, applied live. Role
`ai_marketing_readonly`. Verified by asking Postgres directly rather than by
reading the migration back:

| check | result |
| --- | --- |
| can log in | yes |
| has a password | **no**, so it cannot connect until you set one |
| USAGE on `warehouse` | yes |
| table grants inside `warehouse` | 16 |
| table grants anywhere else | **0** |
| SELECT on `public.ads_meta_insights_daily` | no |
| SELECT on `public.sales_tracker_rows` | no |
| SELECT on `public.registry_persons` | no |
| INSERT on `warehouse.people` | no |
| CREATE on schema `public` | no |

Two honest caveats on it.

**It has BYPASSRLS, on purpose.** Every real table in warehouse has row level
security switched on with zero policies, and all eleven warehouse views are
`security_invoker`, meaning they are permission-checked as the caller and not as
their owner. Without BYPASSRLS this role would connect fine and read zero rows
from everything, which looks exactly like broken data and would send somebody on
a long hunt. BYPASSRLS only reaches tables the role can already SELECT, and this
role can only SELECT inside warehouse, so the bypass is fenced by the same
boundary as everything else.

**Today it can read less than you would expect, and that is the point of the rest
of the build.** Warehouse holds five real tables and eleven views. The views are
`security_invoker` and they read tables that still live in `public`, so this role
reads the five real tables (`ads`, `people`, `ad_changes`, `definitions`,
`accuracy_checks`) and gets a permission error from the eleven views. The room it
can see grows as Phases 1 to 3 move tables in. That is why the role was created
first instead of last.

To mint a working connection when you want one, set a password on it:

```sql
alter role ai_marketing_readonly with password '<a long random password>';
```

then connect with that role name against the project's pooler host. Nothing
secret is stored in this repo.

### A correction to THE MAP

THE MAP says floor 5 is "`warehouse` schema, 16 tables" with "its own copies".
Reality, read live on 2026-08-10:

**Warehouse is 5 real tables and 11 views, not 16 tables.** The `raw_*` objects
are not copies of anything. They are `security_invoker` views that read the
public tables live:

| real tables (5) | views (11) |
| --- | --- |
| `ads`, `people`, `ad_changes`, `definitions`, `accuracy_checks` | `raw_meta_daily`, `raw_keyword_dms`, `raw_conversations`, `raw_bookings`, `raw_sales`, `raw_calls`, `dm_events`, `booking_events`, `sale_events`, `answers`, `checks` |

This changes the shape of the job in a helpful way. There is no duplicated data
to reconcile between floor 5 and floors 2 to 4, and there never was. The two
generations overlap in *naming*, not in *storage*. It also means the moves are
safer than expected: `ALTER TABLE ... SET SCHEMA` does not break a view, because
Postgres binds views to the table's internal id and not to its name, so all
eleven views keep working across a move with no edit at all.

Second correction: **`adsv2_targeting_snapshots` does not exist.** It is listed on
the map as floor 3 "if the audience brick has run". It has not run: the table is
absent from the database, and migrations 098 and 099 are on neither `origin/main`
nor the live database. I have left 098 and 099 free for the audience brick and
taken 100 onward for this build.

### The reference sweep

Law 2 says nothing moves until its references are enumerated. Both halves are
done and both are committed as data rather than prose.

The database half was a single query over `pg_depend`, `pg_rewrite`, `pg_proc`,
`pg_policy`, `pg_trigger` and `pg_constraint`, covering all 41 candidate tables.
The repo half is `scripts/reference-sweep.mjs`, which scanned 1,056 files and
split every supabase-js call site into readers and writers, flagging upserts
specifically, because an upsert writer is the one thing a compatibility view
cannot serve. Output: `docs/fixtures/reference-sweep.json`.

Headline counts, live app code only, migrations excluded:

| floor | tables | files touching them | upsert writers | notes |
| --- | --- | --- | --- | --- |
| 4, registries | 8 | 1 to 16 each | 1 | smallest blast radius, as expected |
| door plumbing | 3 | 4 to 8 each | 0 | written by SQL functions only |
| 3, clean facts | 16 present, 1 absent | 2 to 20 each | 18 | heavy sync writers, law 6 applies to each |
| 2, copies of reality | 13 | 3 to 31 each | 20 | plus live webhooks |

### The per-table move plan

`move now` means it can move with a compatibility view left behind and no code
change. `repoint` means it has a writer that must be pointed at warehouse in the
same migration, which needs the exposure click first. `deferred` means something
blocks it this build and the blocker is named.

**Phase 1, floor 4 and door plumbing.** This is the phase the click unblocks.

| table | plan | why |
| --- | --- | --- |
| `registry_definitions` | move now | no app writer, no app reader by name, read through `question_door_definitions` |
| `registry_keywords` | move now | no app writer or reader; 6 SQL functions name it, all rewritten in the same migration |
| `registry_person_link_conflicts` | move now | written only by `registry_person_link` |
| `registry_entities` | move now | 3 readers, no writer |
| `registry_persons` | move now | 12 SQL functions name it, no app writer outside a test |
| `registry_person_merges` | move now | written only by `registry_person_merge` |
| `registry_person_link_queue` | **repoint** | `src/lib/person-bridge-queue.ts` writes it from the app |
| `organic_keywords` | **repoint** | `src/app/api/organic-keywords/route.ts` upserts it |
| `door_ask_log`, `door_miss_log` | move now | written by the door route in raw SQL, rewritten with the move |
| `door_freshness_thresholds` | move now | 3 readers, no writer |

**Phase 2, floor 3.** Every `adsv2_*_facts` table has zero app writers, which was
a surprise worth checking: the facts are written by SQL functions
(`adsv2_stamp_booking_links`, `adsv2_label_sale_origins` and friends), not by
supabase-js, so they move with function rewrites and no exposure needed. The
snapshot and creative tables are the opposite: `adsv2_window_snapshots`,
`adsv2_budget_snapshots`, `adsv2_meta`, `adsv2_alerts`, `ad_creative_copy`,
`ad_creative_image`, `ad_creative_transcripts`, `ad_set_targeting`,
`ads_dashboard_snapshots` and `sale_attribution_facts` all carry upsert writers
and all need the click.

Six of them are also read by the frozen v1 tab (`src/lib/ads-tracker/*`,
`src/app/api/ads/*`). v1 is alive and is never modified in this build, so those
keep a permanent compatibility view in public and the view is what v1 reads:
`ad_creative_copy`, `ad_creative_image`, `ad_creative_transcripts`,
`ad_set_targeting`, `ads_dashboard_snapshots`, `sale_attribution_facts`.

**Phase 3, floor 2.** All 13 exist. `ads_keyword_events` (10 writers) and
`dm_conversation_messages` (4 upsert writers) are written by live webhooks and
need the most care. Six of the 13 are read by v1 and keep permanent
compatibility views: `ads_meta_insights_daily`, `ads_keyword_events`,
`sales_tracker_rows`, `ghl_appointments`, `manychat_origin_checks`,
`manychat_tag_events`.

**Phase 5, the shrink list.** Of the eight legacy candidates, three have zero
references anywhere in live code and are archive-ready:
`ads_keyword_backfill_runs`, `ads_keyword_backfill_rows`, `dm_identity`. The
other five are not: `ads_attribution_exceptions` (5 writers),
`manychat_contact_links` (12 readers, 2 upsert writers, one of them v1),
`attribution_summary` (2 v1 readers), `ads_attribution_facts` (1 upsert writer),
`dm_ad_links` (1 reader). Each is deferred until its named reference is dealt
with.

### The test suite, and a baseline that is not green

Law 4 asks for a green suite before every push. It is not green, and it was not
green before I touched anything.

```
pass 347   fail 3   skipped 0
```

Zero skipped, which is the important half: the credentials are being picked up,
so this is the real suite and not the 38-golden trap from the Brick 6 build.

The three failures are inherited from `origin/main`. I can state that as fact
rather than belief: `git status` in this worktree shows **no modified tracked
files at all**, only four new untracked paths, none of which any test imports.
The code under test is byte-identical to `origin/main`.

| failing test | cause | mine? |
| --- | --- | --- |
| `ads-tracker-export.html inline app compiles` | the committed export file on `origin/main` does not parse | no |
| `GOLDEN a1: fit and pro leaves match the hand-verified 8/8 numbers` | expects 166,169 cents, live data now says 166,176. Seven cents of real money arrived after the golden was pinned | no |
| `GOLDEN e1: describe_misses groups the manual 8/8 rows` | expects 3 rows, finds 9. Fable's own daily door sessions logged 6 more `fable_chat_manual` misses since the golden was pinned, on 8/9 and 8/10 | no |

I checked specifically whether my own fixture capture caused the third one. It
did not: my 116 door asks all logged as caller `utari` with zero misses, because
every question I asked was on the locked list. The suite itself, though, writes
to both logs when it runs: it added 200 ask rows and 30 miss rows as caller
`test` in one run. That is worth knowing, because it means the miss-log goldens
drift a little every time anybody runs the tests or asks the door by hand.

Two of these three are goldens pinned to live numbers that have since moved.
Re-pinning them changes what the test asserts, so that is your call and not mine.
I have not touched them.

### Phase 0 gate

| gate item | result |
| --- | --- |
| fixtures captured | 19 of 19, twice |
| fixture panel self-proves | yes, 19 of 19 identical at the same sync version |
| reference plans written | yes, all 41 tables plus 8 shrink candidates |
| boundary role exists and is fenced | yes, verified by privilege query |
| PostgREST exposure verified | verified, and it is **closed**. Law 7 stop |
| test suite | 347 pass, 3 fail, 0 skipped, all 3 pre-existing on `origin/main` |

Phase 0 passed. Phase 1 is held at the door by law 7 until the exposure click.

---

## Everything I could not verify

- Whether adding `warehouse` to the exposed schemas list has any side effect on
  the running app. I reasoned that it cannot grant anything, because grants and
  row level security are unchanged by it, but I could not test it, because I
  cannot change the setting.
- Whether the three pre-existing test failures matter to you. I can describe what
  each one asserts and why it moved; I cannot decide whether the assertion or the
  world is the thing that should change.
- Whether the sync's twin still fires. Not in scope here, and untouched.

## What is not done

Phases 1, 2, 3, 4 and 5. Phase 4, the ManyChat identity backfill, does not
actually depend on the exposure click, because it writes to registry tables that
are still in `public` today. It is held only because law 7 says Phase 1 does not
proceed without you, and starting Phase 4 out of order would mean firing about
7,700 live calls at ManyChat's API on my own initiative. Say the word and it
starts.

---

## Note added after the Phase 0 push: the ground moved while I worked

`origin/main` gained commit `00b7b55` (Skool signup webhook, phone-setter
attribution bridge) between the reference sweep and the push. The sweep was run
against `e7328e3`, so it does not include that commit. Three things it changes,
checked by reading the diff:

- It adds a **new upsert writer to `manychat_contact_links`**, which the shrink
  list had down as an archive candidate. It is now more alive, not less. The
  deferral stands and the reason is now stronger.
- It adds a new reader of `instagram_lead_links`, a floor 2 table. Phase 3
  detail, no change to the plan.
- It adds a new public table, `skool_signups`, and applies its migrations under
  written names rather than numbers. Numbered migrations on `origin/main` still
  run 001 to 097 plus this build's 100, so the 098 and 099 reservation for the
  audience brick is unaffected.

The wider point for later phases: this repo has more than one session applying
migrations, so every phase must re-check the reference sweep against the current
`origin/main` immediately before it moves anything, rather than trusting a sweep
taken hours earlier.
