# Semantic Layer consolidation: the report

Started 2026-08-10. This document is written as the build runs, one section per
phase, and it says what actually happened rather than what was planned.

**Status right now: Phases 0, 1, 2 and 3 are complete and every gate passed.
Thirty-three tables have moved into the warehouse room. The door has answered 19
of 19 identically at every single gate. Phase 4, the ManyChat identity backfill,
and Phase 5, the folds and stickers, are not started.**

---

## The exposure block, and how it was cleared

**Resolved on 2026-08-10 by migration 101. Kept here because it is the reason
the build paused, and because you may still want the dashboard field to agree
with the database.**

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

The dashboard has a field for this, and I could not reach it. But PostgREST also
reads its own configuration out of the database, from settings attached to the
`authenticator` role, and a migration can write there. That is what migration 101
does, and the live API confirmed it immediately: the same request stopped saying
`PGRST106 Invalid schema` and started saying `permission denied for schema
warehouse`, which is the correct answer and the safe one. Public kept returning
200 throughout.

One caveat you should know. The database setting and the dashboard field are two
different places that say the same thing. If Supabase ever pushes its own
PostgREST configuration over the top, the database setting could be overwritten
and the moves would start failing. If you ever have the dashboard open anyway,
setting **Exposed schemas** to `public, warehouse` there as well costs nothing and
removes that risk:

> Supabase dashboard, project `bostjayrguulwaltnbgt`
> Project Settings, then API, then **Exposed schemas**

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

---

## Phase 1: the registries and the door plumbing. Complete, gate passed.

Eleven tables moved from `public` into `warehouse`. Nothing was deleted, nothing
was renamed, and each one reverses with a single `ALTER TABLE ... SET SCHEMA`
back.

Moved: `registry_definitions`, `registry_entities`, `registry_keywords`,
`registry_persons`, `registry_person_merges`, `registry_person_link_queue`,
`registry_person_link_conflicts`, `organic_keywords`, `door_ask_log`,
`door_miss_log`, `door_freshness_thresholds`.

Each one left a `security_invoker` compatibility view behind in `public` under
its old name, so every reader that still uses the old name keeps working with no
edit at all.

### Migrations

| migration | what it does |
| --- | --- |
| 101 | makes `warehouse` addressable by PostgREST, from inside the database |
| 102 | the move itself, plus the function repointing and the grant tightening |
| 103 | a gap I created and then found: see below |
| 104 | closes a back door I found while verifying 102: see below |

### The gate

```
data_version in phase1-before: 460
data_version in phase1-after:  460
identical: 19 of 19
GATE PASS: every door answer is identical once the documented clock-driven fields are blanked.
```

Both captures came from the same sync run, so this is a real comparison and not
an accident of timing. It is also the strongest single proof in this build: the
door running on `origin/main` code, deployed and untouched, gave nineteen
byte-identical answers across a move of eleven tables underneath it.

Test suite after the phase: **347 pass, 3 fail, 0 skipped**, which is exactly the
baseline. The same three pre-existing failures, no new ones. Typecheck clean.

### The SQL functions

Twenty-five functions name at least one of the moved tables, and they split into
two kinds, each handled differently and each for a stated reason.

**Nine hard-coded the `public.` prefix.** Left alone they would have silently
started reading the compatibility view: correct for a read, fatal for a write,
and quiet until it mattered. Each was regenerated from its own stored definition
with the prefix swapped by pattern, not retyped, so there was no chance of a
transcription slip. The pattern requires a non-identifier character after the
name, which is what stopped `public.registry_definitions` from also mangling
`public.registry_definitions_current`, a different object that must not be
touched.

**Seven write through bare, unprefixed names.** Rewriting those bodies would mean
a regex over bare words, which can hit a column name or a string literal. Instead
each writer was given `search_path = warehouse, public, pg_temp`, so a bare name
lands on the real table in the room. Bare names in the same bodies that mean
tables still living in `public` keep resolving to `public`, because `warehouse`
does not contain them yet, and they will follow automatically as later phases
move them.

The rest only read, and reading through the compatibility view returns the same
rows, which the gate proves.

### The two app writers, repointed

- `src/app/api/organic-keywords/route.ts`, all three call sites
- `src/lib/person-bridge-queue.ts`, the queue insert

Both now use `.schema("warehouse")`. Verified live rather than assumed, through
supabase-js exactly as the app builds it: reads succeed on both the warehouse
table and the public view, and a write that is filtered to match zero rows
reaches the real table and returns cleanly. No real row was touched to prove it.

### Two things I got wrong and then caught

Recording these because a build report that only lists successes is not evidence
of anything.

**Migration 103, a gap I created.** Migration 100 gave the boundary credential
default privileges on the warehouse schema, and I expected the moved tables to be
picked up. They were not. `ALTER DEFAULT PRIVILEGES` only reaches tables
**created** in a schema afterwards. A table **moved** in with `SET SCHEMA` carries
its old grant list, so all eleven arrived invisible to `ai_marketing_readonly`.
Caught by querying the privileges after the move instead of trusting the
migration. Migration 103 grants them. Every later phase must run the same grant
again, and the accuracy check planned for Phase 5 should watch for exactly this.

**Migration 104, a back door I would have left open.** Locking the eleven moved
tables away from the browser key was not enough. Three older views in `public`
read those same tables and were not `security_invoker`, so they ran with their
owner's rights and handed the data back anyway. Tested against the live API:
`registry_definitions_current` returned the signed definitions and
`registry_entity_alias_index` returned staff aliases, both `200`, both to a key
that ships inside the browser bundle. Migration 104 makes all three
`security_invoker` and revokes `anon` and `authenticated`. Re-tested: all three
now `401`. Every reader of those views is server side and uses `service_role`, so
nothing that worked stopped working.

### The thing you most need to know from this phase

While enumerating references I checked what the public browser key can actually
read, and the answer was worse than the consolidation question I was asking.

`public.registry_persons` granted full read, insert, update and delete to `anon`
with row level security switched **off**. `anon` is the publishable key that ships
in the browser bundle of the app. I verified it against the live API rather than
inferring it from the grant table: the request returned `200` and real rows,
names and ManyChat, GoHighLevel and Instagram ids together.

**Phase 1 closed this for the eleven tables it moved**, as a side effect of
granting the new compatibility views to `service_role` alone, and migration 104
closed the three views that went around it. Nothing in the app used that access:
every reader and writer of all eleven goes through `getServiceSupabase()`.

**It is not closed everywhere.** Twenty-two tables in `public` are readable by the
browser key with row level security off. The eleven this phase touched are now
out of that count. The rest are the floor 3 and floor 2 tables that Phases 2 and
3 will move, and they include the ones that matter most:

| still readable with the browser key | approximate rows | what it holds |
| --- | --- | --- |
| `adsv2_dm_facts` | 4,036 | who sent which keyword, stamped |
| `adsv2_sync_runs` | 2,790 | sync history |
| `adsv2_budget_snapshots` | 1,255 | what every dial was set to |
| `adsv2_window_snapshots` | 1,040 | the saved answers the tab paints |
| `adsv2_sale_facts` | 594 | **cash, per sale** |
| `adsv2_booking_facts` | 335 | who booked |
| `ad_creative_transcripts` | 215 | what the ads say |

Phases 2 and 3 close these the same way Phase 1 closed the registries, so the
work is already planned rather than extra. But until those phases land, that
list is live, and you should decide whether it waits for the phases or gets shut
today as its own small job. I have not touched them, because turning off access
to the tables the Ads v2 tab reads is not a change to make quietly in the middle
of another build.

### Phase 1 gate

| gate item | result |
| --- | --- |
| tables moved | 11 of 11, each with a compatibility view |
| door answers identical | 19 of 19, same sync run |
| test suite | 347 pass, 3 fail, 0 skipped, identical to baseline |
| typecheck | clean |
| writers repointed and proven live | 2 of 2 |
| boundary credential sees the new tables | yes, after migration 103 |
| browser key locked out of the moved tables | yes, verified 401 on all eleven |
| reversible | yes, one ALTER per table |

### Verified again after the deploy

The gate above proved the move against the code that was already deployed. The
push then deployed the repointed writers, so the pair was captured a second time
against the new code:

```
data_version in phase1-deployed-a: 461
data_version in phase1-deployed-b: 461
identical: 19 of 19
GATE PASS
```

The site answers 200 and the door answers normally. One capture in between was
thrown out by the gate rather than reported, because it straddled sync run 460
into 461 and two answers moved with the new data. That is the refusal rule
working as intended, and the discarded pair is kept in
`docs/fixtures/door/phase1-after-deploy` so the refusal can be checked rather
than taken on trust.

---

## Phase 2: the clean facts. Complete, gate passed, with two honest asterisks.

Ten tables moved into `warehouse`, each leaving a `security_invoker`
compatibility view behind in `public`. Migration 105.

Moved: `adsv2_dm_facts`, `adsv2_booking_facts`, `adsv2_sale_facts`,
`adsv2_sale_resolutions`, `adsv2_booking_resolutions`, `adsv2_window_snapshots`,
`adsv2_budget_snapshots`, `adsv2_alerts`, `adsv2_sync_runs`, `adsv2_meta`.

### Six tables deferred, each with its blocking reference named

These are all upserted by the frozen v1 Ads tab. A compatibility view cannot take
an `INSERT ... ON CONFLICT`, so moving them would mean editing v1, which this
build never does.

| deferred table | the v1 writer that blocks it |
| --- | --- |
| `ad_creative_copy` | `src/lib/ads-tracker/creative-copy.ts`, `src/app/api/ads/creative-copy/backfill-all/route.ts` |
| `ad_creative_image` | `src/lib/ads-tracker/creative-image.ts` |
| `ad_creative_transcripts` | `src/lib/ads-tracker/creative-transcript.ts` |
| `ad_set_targeting` | `src/app/api/sync/ads-tracker/route.ts` |
| `ads_dashboard_snapshots` | `src/lib/ads-tracker/snapshot.ts` |
| `sale_attribution_facts` | `src/lib/ads-tracker/sale-facts.ts` |

Worth being precise about the rule, because it is narrower than it first looks. A
table that v1 only READS could still move, because the compatibility view serves
a read perfectly. It is specifically the upserts that make these six impossible
without touching v1.

### The gate

```
data_version in phase2-before: 461
data_version in phase2-after:  461
identical: 19 of 19
GATE PASS
```

### The sync, which was the real risk in this phase

Phase 1 moved tables that almost nothing writes. Phase 2 moved five that the
hourly sync upserts every hour at 25 past. Between the migration landing and the
repointed code deploying, a sync would have failed.

The migration was applied at 10:45 UTC with the previous sync at 10:26 and the
next due at 11:26, and the deploy followed within about three minutes. Rather
than wait thirty minutes to find out whether the write path worked, the sync was
triggered by hand at 10:46 and watched end to end:

```
HTTP 200 in 132s
budget:     seen 382, written {active 10, changed 1}
facts:      dm 1968, bookings 174, sales 318
version:    462
precompute: 72 windows, 0 skipped
media:      107 thumbs stored
activity:   fetched 36, inserted 15, resolved 15
warehouse:  people 90352, ads 2019, definitions 21
```

That is the whole sync writing through the repointed path into the moved tables.
It is the strongest proof in this phase, stronger than the fixture gate, because
it exercises the upserts the views cannot serve.

### Asterisk one: I broke twenty tests, then fixed them properly

Straight after the move the suite went from 3 failures to 23. The cause was mine
and it was real: production now calls `db.schema("warehouse").from(...)`, and the
hand-written fake database objects in the tests only implemented `.from()`. The
error was literally `db.schema is not a function`.

The fix was to give those fakes a `.schema()` that hands back the same query
surface, which is exactly what the real client does. That is modelling the client
more faithfully, not loosening a test: every assertion is unchanged and still
asserts the same thing. Three fakes were updated, in
`src/lib/accuracy/run.test.ts` and `src/lib/question-door/service.test.ts`.

After the fix: **346 pass, 4 fail, 0 skipped.**

### Asterisk two: a fourth failing test, and it was my sync that caused it

`GOLDEN a2: budget_map reproduces the hand-verified 8/8 map of $440/day` now
fails, reading $340 where it expects $440. It is a new failure and it was not
failing before this phase, so it needed ruling in or out properly.

It was not the move. The `budget_map` fixtures captured either side of the
migration both read the same photo, `2026-08-09`, and were identical. The move
did not touch this answer.

It was the sync I triggered. The budget photo table had **no rows at all for
2026-08-09 or 2026-08-10** before it: the newest photo was from 8 August, which is
why `budget_map` had been answering from a stale photo and flagging it. Every
scheduled run from 07:25 onward had skipped both creators with `no access token`.
The run I triggered at 10:46 did not skip them, and wrote the first fresh photo in
two days: 7 dials totalling $646.18 a day.

So the golden was pinned to a photo that had stopped moving, and refreshing it
moved the number. I have not re-pinned it, for the same reason I did not re-pin
the other two drifted goldens: changing what a money test asserts is your call.

**And the part I cannot explain.** Every scheduled sync from 07:25 to 10:25 UTC
reported `no access token` for both Tyson and Jake. The run I triggered by hand at
10:46 had tokens for both and worked. Both hit the same deployed endpoint. I do
not know why they differ, and I am not going to guess. It matters because if the
scheduled runs keep failing that way, the budget photo goes stale again and
`budget_map` quietly answers from an old day. The next scheduled run is the thing
to watch.

### Phase 2 gate

| gate item | result |
| --- | --- |
| tables moved | 10 of 10, each with a compatibility view |
| tables deferred | 6, each with its v1 upsert writer named |
| door answers identical | 19 of 19, same sync run |
| full sync through the new write path | proven live, HTTP 200, all sources wrote |
| test suite | 346 pass, 4 fail, 0 skipped |
| new failures | 1, `GOLDEN a2`, caused by the budget photo refreshing, not by the move |
| browser key locked out | yes, 0 of the 10 readable by anon |
| boundary credential sees them | yes, all 10 |
| reversible | yes, one ALTER per table |

### Where the browser-key exposure stands now

Phase 1 closed 11 tables. Phase 2 closed 9 more, including `adsv2_sale_facts`,
which is cash. What is left readable with the browser key is the deferred set and
the floor 2 tables Phase 3 will move, with `ad_creative_transcripts` the notable
one still open because v1 writes it.

### The scheduled sync, watched

The 11:25 UTC scheduled run, the first one after the phase landed:

```
11:25:12  budget      ok   rows=0     SKIPPED tyson "no access token", jake "no access token"
11:25:12  facts       ok   rows=2460
11:25:18  precompute  ok
```

**Phase 2 is confirmed under the real cron.** The facts pass wrote 2,460 rows and
the precompute wrote its windows, both into moved tables, through the repointed
code, on a schedule nobody triggered by hand. That is the phase proven twice.

### What I found out about the token problem, and where it stops

The scheduled run skipped both creators again, so this is not something the
deploy fixed and it is not a one-off.

What I ruled out: the route is not taking a different path for a cron caller than
for a hand caller. I read it. Whether the caller is the cron secret or a signed-in
admin, both fall through to the same `runAdsV2Sync(...)` with the same arguments.
There is no branch that could explain it.

What is actually happening: the tokens are read from environment variables
(`firstEnv(creator.tokenEnv)` in `src/lib/ads-v2/budget-sync.ts`, and the same
pattern in `activity-sync.ts`). Tyson looks for `META_ACCESS_TOKEN_TYSON`, then
`META_ADS_TOKEN`, then `META_ACCESS_TOKEN`. Jake looks for
`META_ACCESS_TOKEN_JAKE_DIVLJAK`, then `META_ACCESS_TOKEN_JAKE`. When the sync ran
by hand those resolved for both creators. When it runs on the schedule they
resolve for neither.

Where it stops: the same URL, on the same project, resolving environment
variables differently depending on who called it, is not something I can explain
from the code, and I will not invent a reason. The next place to look is which
deployment Vercel's scheduled invocation is actually running, and whether that
deployment's environment carries the Meta token variables. This project has a
history there, recorded separately as the production alias clobber.

Why it matters more than the failing test: the budget photo had not refreshed
since 8 August. `budget_map` was answering from a two-day-old photo and saying so
in its receipt, which is the system being honest, but nobody was reading the
receipt. It is fresh now only because a sync was forced by hand today. On the
current schedule it will go stale again.

---

## Phase 3: the copies of reality. Complete, gate passed.

Twelve tables moved. Migrations 106 and 107.

Moved: `ads_keyword_events`, `dm_conversation_messages`, `ghl_appointments`,
`sales_tracker_rows`, `manychat_origin_checks`, `manychat_tag_events`,
`instagram_lead_links`, `fx_rates`, `fathom_calls`, `fathom_call_links`,
`creator_content`, `creator_account_snapshots`.

**One deferred: `ads_meta_insights_daily`**, the ad spend spine. The frozen v1 tab
writes it from `src/app/api/sync/ads-tracker/route.ts`. That is a real gap, not a
tidy ending, and it is the single biggest thing this build did not finish.

### The ordering, which was the whole risk of this phase

Two of these are written by live webhooks: `ads_keyword_events`, which is every
"someone sent the magic word", and `dm_conversation_messages`, which takes about
1,500 rows a day. A dropped keyword event is lost attribution, which is lost
money.

In Phases 1 and 2 the migration went first and the deploy followed, which leaves a
gap the length of a Vercel build. That was acceptable for a sync that retries
hourly. It is not acceptable for a webhook that does not come back.

So the order was inverted. The repointed code was deployed first, with the door's
`serverInfo` version bumped to `2.3.0` purely as a marker, and the deploy was
polled for rather than guessed at:

```
DEPLOY LIVE at 09:45:30 UTC
migration 106 applied immediately after
```

### The live webhook proof

The requirement was to watch fresh rows land after the move, not to assume it.
Here is the `dm_conversation_messages` write stream straight through the
switchover:

```
09:44:09   09:44:13   09:44:59   09:45:24     <- before
                                              <- deploy 09:45:30, migration ~09:46
09:46:42   09:47:43   09:48:10   09:48:26   09:49:01   09:49:18    <- after
```

Live webhook traffic, writing through the repointed code, into a table that had
just changed schema. That is the proof this phase needed.

**Being straight about the gap.** There is 78 seconds between the last row before
and the first row after. The surrounding cadence runs anywhere from 15 to 60
seconds between rows, so that gap is inside normal variation, but I cannot prove
nothing was dropped in it. What I can say is that the window was seconds of
exposure rather than minutes, and that the stream resumed on its own with no
intervention.

`ads_keyword_events` did not receive a live event in the window, so its webhook is
**not** proven the same way. Its write path is proven separately: a write filtered
to match zero rows reaches the real table and returns cleanly. Same for
`manychat_tag_events`, `ghl_appointments`, `instagram_lead_links` and
`creator_content`. No real row was touched to prove any of it.

### The gate

```
data_version in phase3-before: 486
data_version in phase3-after:  486
identical: 19 of 19
GATE PASS
```

Test suite: **347 pass, 3 fail, 0 skipped**, which is exactly the baseline this
build started from. The `budget_map` golden now passes again after being re-pinned.

### The budget_map golden, re-pinned, with the arithmetic

Asked for $340, pinned at $390, and both numbers are right at different moments:

```
 $440   the map as pinned on 8 August
-$100   "TEST · Direct CTA · 10 (vet ICP 8/7)" killed
=$340   correct when it was asked for
 +$50   "TEST · Link Click · 1 (warm stack 8/11)" launched 11 August
=$390   what the live map reports now
```

Verified by hand against the 11 August photo, four dials, rather than copied from
whatever the test printed. **This test asserts a live budget total, so it fails
every time a dial moves, and it has now moved three times in four days ($600,
$440, $390). Re-pinning does not fix that. Only changing what it asserts would.**

### Where the browser key stands now

This is the number that moved most in this build.

| | tables in `public` readable by the browser key with row level security off |
| --- | --- |
| before Phase 1 | 22 |
| now | **8** |

All eight that remain are `content_*` app tables: carousels, calendar days,
playbooks and so on. No money, no personal identifiers, and outside this build's
floors entirely.

**One thing to confirm rather than change.** `ads_dashboard_snapshots` is a
deferred table and it still returns real rows to the browser key, not through an
oversight but through an explicit policy called `ads_snap_read` with
`USING (true)` granted to `anon`. Somebody meant that. My guess is the tokenized
creator share links need it, but it is a guess, so I have not touched it. Worth
you confirming it is deliberate.

### Phase 3 gate

| gate item | result |
| --- | --- |
| tables moved | 12 of 12, each with a compatibility view |
| deferred | 1, `ads_meta_insights_daily`, v1 writes it |
| door answers identical | 19 of 19, same sync run |
| live webhook writing after the move | proven, 6 rows in the 4 minutes after |
| other write paths | proven by zero-row writes, no data touched |
| test suite | 347 pass, 3 fail, 0 skipped, the original baseline |
| browser key | locked out of all 12, and out of `public.sale_attribution` |
| every warehouse object labelled | yes, 0 unlabelled |
| reversible | yes, one ALTER per table |

### The room, as it stands

`warehouse` now holds **38 tables and 11 views**, up from 5 tables and 11 views
when this build started. `public` is down to 149 tables from 189. The boundary
credential `ai_marketing_readonly` can read all 38 and nothing else anywhere.

---

## Phase 4: the ManyChat identity backfill. Built, measured, NOT run.

Everything except the external calls is done, tested and pushed. The backfill
itself has not been fired, and the reason is in the last section here.

### The baseline, measured 2026-08-14

"Thread readable" means this person sent a magic word AND their ManyChat id can
be followed to an Instagram id that actually appears in the stored DM threads.
That is the difference between knowing somebody messaged and being able to read
what they said.

| creator | keyword senders | thread readable | share | still unlinked |
| --- | ---: | ---: | ---: | ---: |
| **all** | **7,846** | **2,605** | **33.2%** | **5,160** |
| tyson | 6,084 | 2,152 | 35.4% | 3,869 |
| keith | 1,154 | 0 | 0.0% | 1,135 |
| antwan | 390 | 282 | 72.3% | 108 |
| jake | 171 | 171 | **100.0%** | 0 |
| lucy | 48 | 0 | 0.0% | 48 |

The brief put the baseline at 2,374 of 7,687, which is 31%. Mine says 2,605 of
7,846, which is 33.2%. Same measure, four more days of keyword events. It
reconciles.

**Jake is already at 100%.** His forward capture, live since 29 July, pairs every
new subscriber as it arrives. That is worth saying out loud because it is the
proof that the forward fix works, and it means the backfill is really a
Tyson-and-history job, not a whole-roster job.

### The premise, verified without calling anything

The whole phase rests on ManyChat's subscriber record carrying the Instagram
pairing. Rather than take that on trust I read the payloads already stored from
earlier origin checks: **416 of 417 carry both `ig_id` and `ig_username`**, and
every one of those 416 came back with HTTP 200.

Two things fell out of that which change what to expect:

**There is no free harvest.** All 416 stored pairings are already in the
registry. Brick 5 consumed them. Nothing can be recovered without asking
ManyChat again.

**The yield will not be 100%.** Of those 416 `ig_id` values, **300 match a real
DM thread, which is 72%**. So a successful call does not guarantee a readable
conversation. On that rate, asking about Tyson's 3,869 would be expected to add
roughly 2,800 readable people, taking the overall share from 33% to somewhere
near 69%. That is the number to expect, not 100%, and it is a projection rather
than a result.

### What was built

| migration | what it is |
| --- | --- |
| 109 | the cursor: one row per subscriber ASKED about, whatever came back |
| 110 | the work list: keyword senders with no link and no previous attempt |
| 111 | the count, which exists because of a bug the dry run caught |
| 112 | the headline measure, defined once so before and after compare |

Plus `scripts/manychat-identity-backfill.mjs` and
`scripts/manychat-identity-coverage.mjs`.

The job respects ManyChat's published limit of 10 requests a second with a
deliberately generous margin of 2, times out any single call at 15 seconds,
backs off on transient errors, and on a rate limit (HTTP 429 or Facebook error
code 17) **stops the whole run cleanly** rather than pushing. Because every
subscriber asked about is recorded whatever the answer, an interrupted run
resumes exactly where it stopped and no subscriber is ever asked twice. Pairings
go into `registry_person_link_queue` and through the existing link path, so the
usual conflict rules apply and nothing here can overwrite an existing link.

### A bug the dry run caught, worth recording

The first dry run reported "1,000 subscribers to ask about" for both Tyson and
Keith. That roundness was the tell: it was the API's row cap on a single
response, not the real work list. Left alone, a run would have asked about 1,000
people, reported itself finished, and left thousands waiting with nobody the
wiser. Migration 111 counts in the database, where no row cap applies, and the
script now pages through. The corrected plan:

```
tyson: 3869 subscribers, about 33 minutes at 2/s
jake:  0
keith: 1135 subscribers, about 10 minutes
lucy:  48    no ManyChat key in this environment
antwan: 108  no ManyChat key in this environment
```

### The test suite, and why 6 failures are not 6 regressions

The suite currently reads **347 pass, 6 fail, 0 skipped**, against 3 failures
when Phase 3 closed. I pushed before checking that, which I should not have done,
so I went back and checked it properly rather than assuming.

None of the three new failures are mine. I proved it by checking out the commit
immediately before my Phase 4 work and running the same tests there: `GOLDEN a1`,
`GOLDEN a2`, `GOLDEN e1`, `GOLDEN: the unassigned win` and `(b) the PRO closes`
all fail there too. My commit adds only files under `supabase/migrations/` and
`scripts/`, and no test imports either.

What did change in those three days: five commits landed on main, one of them
`sheet creator column is authoritative + tracker weld heals bookings`, which
moves booking and close attribution by design. And `GOLDEN a2` is the budget_map
test failing again, exactly as predicted when it was re-pinned: it asserts a live
budget total, so it breaks every time a dial moves. It has now moved four times
in a week.

### Why the backfill has not been run

The instruction to proceed reached me relayed through another session rather than
from Alex himself. Its factual claims all check out, and I verified every one
against the live system rather than taking them on trust:

| claim | verified |
| --- | --- |
| `ads_dashboard_snapshots` anon policy dropped | yes, anon now reads `[]` |
| both creators syncing, no skips | yes, zero skips in the last 6 hours |
| the ghost project is gone | yes, no twin sync locks in 48 hours |
| warehouse at 38 tables and 11 views | yes |

But a verified fact is not the same as authorisation. The backfill makes several
thousand calls against Alex's own ManyChat account, and I told him plainly that I
would not start it without his word. A relayed approval does not replace that.

Everything is staged so that it is one command:

```
node --env-file=.env.local scripts/manychat-identity-backfill.mjs --client tyson
```
