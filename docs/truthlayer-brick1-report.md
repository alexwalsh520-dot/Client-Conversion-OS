# Truth Layer, Brick 1: the Registries - build report

**Built 2026-08-02. Applied to Supabase `bostjayrguulwaltnbgt`. All six acceptance tests pass.**

Brick 1 gives every future certified question one shared set of nouns: who the
entities are (with every alias any system uses), which keywords exist, and what
every metric term means. After this, entity resolution outside the registries is
uncertified by definition.

The two failures this was built to kill are both closed:

- **"Jake has zero DMs"** (message store keys him `jake_divljak`, warehouse keys
  him `jake`): `registry_resolve_entity` now maps both to `jake`, along with
  nine other spellings including a misspelling nobody had noticed.
- **A setter roster missing two people**: a full DISTINCT sweep of all nine
  source columns now resolves every value except the two labels that are
  deliberately not people.

---

## What was created

Four migrations, numbered after the previous max on `origin/main` (063):

| File | Contents |
|---|---|
| `supabase/migrations/064_registry_entities.sql` | `registry_entities` table, alias index view, `registry_resolve_entity()` |
| `supabase/migrations/065_registry_keywords.sql` | `registry_keywords` table, collision view, `registry_resolve_keyword()`, `registry_enforce_keyword_uniqueness()`, `registry_reseed_keywords()` |
| `supabase/migrations/066_registry_definitions.sql` | `registry_definitions` table, `registry_definitions_current` view |
| `supabase/migrations/067_registry_seed.sql` | `registry_seed_entities()`, `registry_seed_definitions()`, and the seed invocation |

Plus `scripts/seed-registries.mjs`, a re-runnable seed that calls the three SQL
seed functions and prints the state of the keyword uniqueness law every run.

**Objects added** (3 tables, 3 views, 6 functions). All tables have RLS enabled
with no anon policies, matching the existing internal-table posture. Reads are
single indexed lookups: no request-path compute.

**Seeded:** 18 entities, 25 definitions, 455 keywords (451 ad, 4 organic).

```
entities by kind:  creator=6, closer=6, setter=6
keywords:          207 active ad, 244 retired ad, 4 organic
definitions:       25 signed, 0 open, 0 superseded
```

---

## Acceptance test results

### Test 1: resolver spot checks - PASS

```
jake_divljak       -> jake            Jake Divijak       -> jake
Jake Divljak       -> jake            rrf                -> jake
jake               -> jake            act_304988118349730-> jake
setter_gideon      -> setter_gideon   Gideon             -> setter_gideon
gideon             -> setter_gideon   GIDEON             -> setter_gideon
Phone Setter 1     -> (NULL)          Other              -> (NULL)
tyson_sonnek       -> tyson           fb1024471          -> tyson
17841400987609293  -> tyson           AMARA              -> setter_amara
matthew_conder     -> setter_matthew_conder
BROZ               -> closer_broz     AARON              -> closer_aaron
Zoe and Emily      -> zoe_and_emily   Lucy Hubbard       -> lucy
"  JAKE_DIVLJAK  " -> jake            nobody-at-all      -> (NULL)
```

Both required NULL cases behave correctly, whitespace and case are handled, and
the two non-person tracker labels never resolve to a person.

### Test 2: full DISTINCT sweep of every source - PASS

Every distinct value in every source column resolves. Nothing was sampled.

| Source column | Distinct | Resolved | Unresolved |
|---|---|---|---|
| `dm_conversation_messages.client` | 5 | 5 | 0 |
| `adsv2_dm_facts.client_key` | 2 | 2 | 0 |
| `ads_meta_insights_daily.client_key` | 5 | 5 | 0 |
| `ads_keyword_events.client_key` | 5 | 5 | 0 |
| `sales_tracker_rows.closer` | 10 | 10 | 0 |
| `sales_tracker_rows.setter` | 7 | 5 | **2** |
| `ads_keyword_events.setter_name` | 6 | 6 | 0 |
| `adsv2_dm_facts.setter_name` | 5 | 5 | 0 |
| `dm_conversation_messages.setter_name` | 3 | 3 | 0 |

The 2 unresolved values are `Other` and `Phone Setter 1`, which are **required**
to return NULL. There are no stragglers.

I swept the three `setter_name` columns as well, beyond the required list. That
is where the original roster miss lived, and all three are clean.

### Test 3: keyword uniqueness constraint - PASS (with a real finding)

```
3a duplicate active ad keyword (brave/tyson)   PASS - rejected
   duplicate key value violates unique constraint "registry_keywords_pkey"

3b arm signed all-client uniqueness            PASS - refused
   Cannot arm all-time keyword uniqueness: 9 active ad keyword(s) belong to
   more than one client -> bold (antwan, tyson); boost (antwan, tyson);
   course (jake, tyson); flex (antwan, tyson); fuel (antwan, tyson);
   lift (antwan, tyson); spark (antwan, tyson); thrive (antwan, tyson);
   vital (antwan, tyson)

3c cross-client duplicate (brave/jake)         ACCEPTED - not blocked today
   rows persisted after rollback: 0
```

Two honest caveats on this test, both reported rather than papered over:

1. **3a was enforced by the primary key, not by the fallback index.** The
   fallback `UNIQUE (keyword_normalized, client_key) WHERE status='active' AND
   type='ad'` is structurally subsumed by the primary key
   `(keyword_normalized, client_key, type)`. It exists and is correct, but it
   adds no enforcement the PK did not already provide.
2. **The signed law is therefore genuinely unenforced today** (test 3c). Rather
   than leave that invisible, the gap is guarded two ways: the
   `registry_keyword_active_collisions` view lists it on demand, the seed script
   prints it on every run, and `registry_enforce_keyword_uniqueness()` arms the
   real index the moment the list is empty, refusing with the list until then.

The collisions were kept as real rows with status per the data. No winner was
picked and no history was deleted.

### Test 4: definitions - PASS

25 definitions seeded, all `signed`, 0 `open`, 0 `superseded`; the
`registry_definitions_current` view returns 25 rows. The signoff sheet's only
open item (is Kelechi current?) is carried inside `setter_roster` as
`"pending_confirm": ["Kelechi"]` per the spec, so the definition itself is
signed while the question stays visible.

### Test 5: capability fields - PASS

`0` rows across the whole table (not just creators) have a null
`pixel_status`, `conversion_source`, or `attribution_source`. Every row is
`none / native_messaging_event / warehouse_only`, so the future-pixel
conditional paths have somewhere to read from on day one.

### Test 6: no existing object touched, migrations idempotent - PASS

Everything ran a second time with identical results:

| Table | Before | After | Result |
|---|---|---|---|
| entities | 18 | 18 | PASS |
| definitions | 25 | 25 | PASS |
| keywords | 455 | 455 | PASS |
| keywords active ad | 207 | 207 | PASS |

Every statement is `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
`CREATE OR REPLACE`, or an upsert. There is no `ALTER`, `DROP`, `DELETE`, or
`UPDATE` against any pre-existing table anywhere in this brick. Column counts on
the six source tables are unchanged (`ads_meta_insights_daily` 24,
`sales_tracker_rows` 30, `ads_keyword_events` 17, `dm_conversation_messages` 14,
`adsv2_dm_facts` 15, `organic_keywords` 5). v1 and the sheets were never touched.

---

## Findings (these are findings, not failures)

### 1. The nine keyword collisions are all a status-rule artefact, not shared keywords

This is the most useful thing the build surfaced. Every one of the 9 collisions
has **`live_ad_rows: 0` on both sides** - not one of them is a keyword two
clients are actively advertising on right now.

They are active only because the seeded status rule (per spec: active if there
is spend or events in the last 30 days, **or** a live ACTIVE ad) treats recent
spend from a stopped account as "active":

- **Antwan is a former creator** (since 2026-07-21). His account has zero ACTIVE
  ad rows and stopped syncing 2026-07-16, but that is inside the 30-day window,
  so 26 of his keywords seeded as active. 8 of the 9 collisions are his.
- **Keith is a former creator** (since 2026-06-06) with 2 keywords active off a
  single trailing DM event each, zero spend.
- **`course` (jake, tyson)** is the only collision between two active creators,
  and even there neither has a live ad on it: jake spent $1,681.63 in the window
  and tyson $1.92.

In total **28 of the 207 "active" ad keywords belong to former creators.**

**This needs your call, because it is a definition change, not a bug fix.** The
options, in the order I would rank them:

- Tighten the status rule to require the creator be active AND the keyword have
  a live ACTIVE ad. That clears all 9 collisions immediately and makes "active"
  mean what people assume it means.
- Tighten it to active-creator-only. That clears the 8 Antwan/Keith collisions
  and leaves `course` as a genuine decision between Jake and Tyson.
- Leave the rule as signed and resolve the 9 by hand.

I did not change the rule on my own, because "what active means" is exactly the
kind of definition this layer exists to stop people from quietly redefining.
Once you pick, the fix is a one-line change to `registry_reseed_keywords()` plus
`select registry_enforce_keyword_uniqueness();`.

### 2. Matthew Conder is not a creator - the spec was wrong and the data won

The signoff sheet said to add `matthew_conder` as a former **creator**. The data
says otherwise, unambiguously:

- All 14 `dm_conversation_messages` rows keyed `client = matthew_conder` carry
  **Tyson's IG id** (`17841400987609293`) or **Antwan's** (`17841401520122483`)
  as the account party.
- The same 14 rows carry `setter_name = "Matthew Conder"`.
- He has no ad account, no ManyChat account, and no tracker offer string.

So those are Tyson and Antwan conversations where a setter's name was written
into the client column. He is registered as `setter_matthew_conder`, kind
setter, status former. **Needs your confirm.** The 14 mis-keyed rows are logged
here as a data-quality item and were not touched.

### 3. Jake's tracker offer string is misspelled

The sales tracker spells his offer **"Jake Divijak"** (missing the `l`), not
"Jake Divljak". All 6 of his tracker rows use the misspelling. It is recorded
verbatim as an alias, because the registry's job is to match what the source
actually contains. This is the same class of break as `jake` vs `jake_divljak`,
and it was silently live until this sweep.

### 4. AARON is on the signed roster but has zero rows in the data

A full DISTINCT sweep of `sales_tracker_rows.closer` returns no `AARON`. He is
registered with **empty aliases** and a note rather than a guessed spelling.
Either give me his exact tracker string, or confirm he has not closed since the
tracker began. He still resolves (via display name) so the sweep stays clean.

### 5. Five setters also appear in the closer column

`AMARA` (68 rows), `KELECHI` (19), `DEBBIE` (12), `GIDEON` (7) and `ERIN` (4)
all appear as closers in uppercase. One person gets one canonical key, so those
uppercase strings resolve to the same `setter_*` entity, and `kind` records the
signed primary role rather than the only role. If you want commission maths to
treat those rows as closer rows, that is a per-row question for Brick 2, not a
second entity here. Flagging it so it is not discovered later as a surprise.

### 6. Lucy is live in the data despite standing memory saying she was never a client

Project memory records "Lucy = NOT a client", but `client_key = lucy` is present
in `ads_meta_insights_daily` (191 rows through 2026-06-09), `ads_keyword_events`
(47), and the tracker offer "Lucy Hubbard" (4 rows), with her own ad account
`act_616852470282141`. She is registered as a **former creator** so that every
client key in every source resolves. Both facts are recorded; the status label
is your call.

### 7. Zoe and Emily exist only as one joint string

The tracker records them jointly as the single offer `"Zoe and Emily"` (22
rows). No separate `zoe` or `emily` key exists in DM capture, insights, keyword
events, or ad accounts. Registering two entities that both claim the same alias
would make resolution ambiguous, so they are one entity, `zoe_and_emily`. Split
them only if you can supply distinct keys.

### 8. Migration 052 was never applied to the database

`supabase/migrations/052_client_and_team_registry.sql` exists on `origin/main`
and creates `ccos_clients` and `team_members`, but **neither table exists in the
database**. I used it only as documentary evidence for ManyChat keys and left it
alone. Worth knowing: any code path that expects those tables is on its fallback
today. Not touched, per the no-cleanup rule.

---

## What I could not verify

- **The ManyChat account ids are per-creator, but `fb1024471` is also the app
  default.** I confirmed each creator's id from their own tracker links (tyson
  `fb1024471` on 417 rows, antwan `fb1409488` on 37, keith `fb2658494` on 24,
  jake `fb107310014324540` on 6, lucy `fb4608469` on 3). Note that
  `fb1024471` is *also* hardcoded as the fallback in
  `src/lib/ads-tracker/server.ts` and `src/lib/meta-business-suite.ts`, so a row
  carrying it is only weak evidence of Tyson on its own. One Tyson row carries
  `fb3858284`; a single row is not enough to register as an alias, so I did not.
- **The keychain token names** (`tyson-meta-token`, `jake-meta-token`) come from
  the spec and project memory. They are macOS Keychain entries, not in the
  database, so I could not verify them from data.
- **Keith has no IG-scoped id.** His `dm_conversation_messages` rows carry no
  sender/recipient ids at all, so none was recorded rather than guessed.
- **`status_since` for Jake** is set to 2026-07-29 from the project record of his
  webhook going live, not from a database field. Tyson and Zoe/Emily have no
  `status_since` because no dated evidence exists.
- **Whether Kelechi is current or former** remains the signoff sheet's one open
  question. Seeded active with the note, as specified.

---

## How to re-run

```bash
node scripts/seed-registries.mjs
```

Idempotent. Upserts entities and definitions, re-sweeps keywords from all three
sources, and prints the collision list. Use `--keywords-only` to refresh just
the keyword sweep after new ad data lands.

To arm the signed all-time uniqueness law once the collisions are resolved:

```sql
select registry_enforce_keyword_uniqueness();
```

It refuses, with the list, until the law is actually true.

---

## Not in this brick, by design

No answer contract, no `ask()` tool, no certified questions (Bricks 2-3). No
facts table was backfilled or modified. Nothing found along the way was cleaned
up; it is all logged above instead.

---

## Addendum: 068 owner corrections + Fable audit (2026-08-02)

The Fable audit verified every claim in this report against the live database
and confirmed the build, with ONE factual correction and four owner rulings.

**Audit correction to Finding 1:** the claim that all 9 keyword collisions have
"zero live ads on both sides" is FALSE for 6 of them. Tyson has currently
ACTIVE ads carrying bold, fuel, lift, spark, thrive and vital (TEST · Lead
Magnet · 50, Meta-starved but live). The dead side in every pair is a former
creator or a paused ad, so the ranked recommendation still holds: under
"active = creator active AND live ACTIVE ad" every collision resolves to
exactly one owner and the law arms. The decision itself is still with Alex.

**Owner rulings (Alex, 2026-08-02), applied in migration 068:**
1. Matthew Conder is Alex's BUSINESS PARTNER and co-owner ("Matt"). Not a
   setter, not a creator. New entity kind `owner`; canonical key renamed to
   `matthew_conder`; status active. The 14 mis-keyed DM rows remain a logged
   data-quality item.
2. There is no closer named AARON. The name was a voice mis-transcription of
   ERIN, the setter who also does outbound and closing. `closer_aaron` removed;
   `closer_roster` and `setter_roster` superseded by v2 (5 closers, Erin dual
   role noted).
3. Kelechi is a CURRENT setter (confirmed).
4. Lucy WAS a client (former; the stale memory line "Lucy = NOT a client" is
   corrected).

Seed functions were replaced in 068 with matching content, so a reseed cannot
resurrect any corrected row. Post-068 state, verified live: 17 entities
(creator 6, closer 5, setter 5, owner 1), 27 definitions (25 signed, 2
superseded), AARON resolves to NULL, reseed idempotent.

**Still open:** the keyword "active" status rule (finding 1) awaits Alex's
call; `registry_enforce_keyword_uniqueness()` keeps guarding until then.
