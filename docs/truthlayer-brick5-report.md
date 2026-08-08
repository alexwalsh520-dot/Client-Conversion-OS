# Truth Layer Brick 5 — The Identity Bridge

Built 2026-08-08. Branch `truthlayer-brick5`, migrations 083 to 087.
Locked question list: **17 to 19**. No earlier question's numbers changed.

---

## What this brick is for, in one paragraph

Four id systems name the same human and share no key. ManyChat subscriber ids
(6 to 10 digits) live on keyword events, the adsv2 facts and the sales tracker.
Instagram-scoped ids (15 to 17 digits) live in `dm_conversation_messages`, which
is where the actual conversations are. GoHighLevel contact ids (20 characters)
live on bookings. Tracker name spellings live in the sheet a human types into.
Measured against the live database on 2026-08-08: **7,623 distinct ManyChat ids,
36,598 distinct Instagram-scoped ids, and ONE value in common.** They are
disjoint. Every cross-system read before this brick was hand-built, and the
hand-built ones leaned on name matching. `registry_persons` replaces that with a
stored bridge where a link exists only if one stored row carried both ids, and
every link records the row that proved it.

---

## Part A — the bridge store

### Tables (migration 083)

| Table | What it holds |
| --- | --- |
| `registry_persons` | One row per human: `manychat_ids`, `ig_scoped_ids`, `ghl_contact_ids`, `tracker_name_keys`, `client_keys`, `evidence` jsonb, `merged_into` |
| `registry_person_merges` | Every merge: survivor, absorbed, written reason, actor, and a snapshot of the absorbed row |
| `registry_person_link_conflicts` | An id claimed for a second person. Recorded, never silently resolved |
| `registry_person_link_queue` | Bridge evidence seen by a live capture path, waiting to be drained |

Each `evidence` entry is `{id, system, source, linked_at, confidence}` where
confidence is `hard` or `name_match` and `source` names the stored row.

### The functions, and the rules they enforce

`registry_person_link` is the only way an id joins a person, so the rules live in
one place and are enforced rather than documented:

1. **A link with no source is refused.** Evidence is not optional.
2. **`name_match` may only ever attach a `tracker_name` key.** It can never join
   two id systems. This is the signed `person_identity` v1 rule, enforced in SQL.
3. **An id already held by another live person does not silently move.** It
   writes a conflict row.
4. **Merging is `registry_person_merge` and nothing else**: survivor, absorbed,
   written reason, actor. The absorbed row is kept with `merged_into` set, so
   every id it ever held keeps resolving, now to the survivor. Archive, never
   delete.

`registry_person_link_pair` (084) is the one place a merge happens automatically,
and it is still explicit: when hard evidence proves two existing person rows are
one human, it calls `registry_person_merge` with the evidence named in the reason
and `backfill` as the actor. It lands in the merge log like any other merge.
Name evidence can never reach that path, because rule 2 stops it first.

### A design correction the data forced

The first version treated a name like an id: exclusive, first claimant wins. The
first backfill run recorded **1,000 conflicts, all of them `tracker_name`, across
528 distinct name keys** — "aaron", "a", and so on. Treating that as ownership
would have left exactly one person holding "aaron", and `registry_person_resolve`
would then have answered that name with total confidence and the wrong human.

Names are now **non-exclusive**: everyone called "aaron" keeps the key, and
resolve refuses any name that more than one live person answers to. Conflicts
went to **0**, and an ambiguous name now returns a candidate list instead of a
confident mistake. This is the single most important correction in the brick.

### Backfill (migration 084)

Ten sweeps, all hard, all idempotent. Sweeps 1 to 6 join two id systems; 7 to 9
attach a name to an id **because the name and the id sat on the same row**, which
is same-row co-occurrence and not name similarity; sweep 10 materialises the ids
the money system already knows so a person we can see but have not bridged still
has a row.

```json
{
    "ran_at": "2026-08-08T09:43:47.565859+00:00",
    "confidence": {
        "hard": 16340
    },
    "ids_linked": {
        "ghl": 600,
        "manychat": 7825,
        "ig_scoped": 402,
        "tracker_name": 7513
    },
    "live_persons": 8113,
    "persons_after": 8124,
    "persons_created": 8124,
    "persons_before": 0,
    "merges_performed": 11,
    "conflicts_recorded": 0,
    "queue_rows_drained": 0
}
```

**Idempotency, second run immediately after, verbatim:**

```json
{
    "persons_before": 8124,
    "persons_after": 8124,
    "persons_created": 0,
    "merges_performed": 0,
    "conflicts_recorded": 0,
    "ids_linked": { "ghl": 600, "manychat": 7825, "ig_scoped": 402, "tracker_name": 7513 }
}
```

**16,340 links, every one of them `hard`. Zero `name_match` links exist in the
store today**, because the only name links written are same-row ones.

All 11 merges are hard-evidence merges with the proving row named, for example:

> Hard evidence linked manychat 786559268 to ghl QQuc9EfNCdJiGyOClhcY on one
> stored row (ads_keyword_events (one row carrying both the subscriber and the
> contact)), and the two ids were on two person rows.

### The source this brick deliberately REFUSED

`manychat_contact_links` holds **10,448** ManyChat-to-GHL rows and is the richest
looking bridge in the database. Migration 073's stamp ladder already leans on it.
Brick 5 does not import it wholesale, and the reason is measured, not stylistic.

It is written by two paths and records neither:

- a hard path, where the GoHighLevel contact is **created for** a ManyChat
  subscriber and stamped with their `manychat_user_id`
  (`src/lib/ghl-dm-sync.ts:539`);
- a **scoring** path (`src/lib/dm-contact-linking.ts`,
  `scoreExistingInstagramContact`) that ranks candidate contacts on first-name
  equality, last-name equality and how close their creation times were, and
  accepts anything scoring 70 or more. That is name similarity in machine
  clothing.

Checked against the **290** ManyChat-to-GHL pairs this brick can prove
independently: **265 agree** and **25 map the same subscriber to a different
contact.** Those 25 may be bad scored links or may be the known duplicate-GHL-
contact pattern; the table alone cannot tell you which.

So sweep 6 imports **only the corroborated rows** and the rest are counted, not
trusted. Brick 5 is knowingly stricter than migration 073, and this is the
number that justifies it.

### Forward writes

Found by reading the code, not guessed. Both hooks enqueue and return; the queue
is drained by `registry_person_drain_queue()` on the adsv2 sync cycle
(`src/lib/ads-v2/facts.ts`, right after `adsv2_stamp_booking_links`). A webhook
that blocks on bookkeeping is a webhook that drops leads, so
`enqueuePersonLink` never throws and never returns a failure a caller must handle.

| Path | Evidence | Tier |
| --- | --- | --- |
| `src/app/api/sync/manychat-origin/route.ts` | `raw.ig_id` beside the subscriber id | hard |
| `src/lib/ghl-dm-sync.ts:539` | the GHL contact was **created for** this subscriber | hard |

`ghl-dm-sync.ts:516` is deliberately **not** hooked. That branch reaches its
contact through the name-and-time scorer, and name similarity never creates a
hard link.

### The unbridgeable remainder, counted honestly

```json
{
    "manychat": { "ids_in_the_data": 7759, "on_a_person": 7814,
                  "bridged_to_ig": 400, "bridged_to_ghl": 278 },
    "ig_scoped": { "ids_in_the_data": 36664, "on_a_person": 400 },
    "ghl":       { "ids_in_the_data": 860, "on_a_person": 589 }
}
```

- **Instagram-scoped: 36,264 of 36,664 ids cannot be bridged (98.9%).** The only
  stored row anywhere that carries a ManyChat id and an Instagram id together is
  a `manychat_origin_checks` row, and that check runs **per sale**. A thread that
  never produced a sale has no bridge row, and nothing else in the database
  carries both ids. This is the single biggest finding in the brick and it is a
  capture gap, not a modelling gap: it is fixed by running the origin check
  earlier, not by writing cleverer SQL.
- **ManyChat: `on_a_person` (7,814) exceeds `ids_in_the_data` (7,759)** because
  the remainder's denominator counts four fact tables while the store also holds
  ids reached from `manychat_origin_checks`. Not a discrepancy; different sets.
- **GoHighLevel: 271 ids are not on a person.** These are `ghl_appointments`
  contacts that never became an adsv2 booking fact (former creators and
  non-adsv2 calendars). Deliberately not swept: they are outside the Tyson and
  Jake money questions this door serves. Counted here so the gap is visible.

---

## Part B — the two new questions

### 18. `person_timeline`

Resolves any identifier (ManyChat id, Instagram-scoped id, GoHighLevel contact
id, `person_id`, or a name) through the bridge, then returns the person's whole
story in event order across every system, with `could_not_bridge` stating in
words what is missing and why. An ambiguous name returns a candidate list and
never a single story.

`money` is **false** on its receipt. It does show cash — the person's own
stamped sale rows — but never a window total, and a coverage block measures how
much of a *window* is classifiable. `why_unattributed` (4) is `money: false` for
the same reason.

**On `person_events`:** the prompt describes question 18 as absorbing an existing
`person_events` question. No question by that name has ever been on the locked
list. The real question 6 is **`person_lookup`**, and `question_door_person_events`
is an RPC it calls. `person_lookup` is **untouched and its numbers do not move**,
because Brick 3's standing law is that no existing template's numbers change; its
receipt has always carried the caveat that the identity bridge was a later brick.
`person_timeline` supersedes its event list without replacing it. Flagging the
naming difference rather than quietly rewriting question 6.

### 19. `lead_quality_read`

Per cohort (`keyword` or `ad_set`), with N beside every claim: people who sent
the keyword, how many are on the bridge, how many reach a readable thread, DM
depth **with its own denominator**, qualification where `person_context` holds a
stage state, DM-to-book and show rate with their Ns, calls taken on calendar and
in the tracker, wins and cash. `money: true`, `certainty: directional`, so the
service attaches the four signed coverage buckets.

A **geo** cohort is refused in writing: `warehouse.ads` stores `geo_count`, which
is how *many* places an ad set targeted, and no stored row records which country
or region a *person* was in. Answering it would need a per-person geography this
system does not capture.

---

## Part C — the fold-in fixes, and the honest result

`adsv2_booking_bridge_recovery()` (087) adds a fifth rung to migration 073's
ladder: resolve the person from the GoHighLevel contact and read their ManyChat
id off the bridge. It writes `linked_subscriber_id` and `dm_et_day` **only where
they are null**, touches no cash column, and deliberately does not recompute
`taken`.

**It recovered nothing, and the reason matters more than the outcome:**

```json
{
    "before": { "rows": 328, "with_linked_subscriber": 183, "with_dm_et_day": 183, "taken_true": 24 },
    "after":  { "rows": 328, "with_linked_subscriber": 183, "with_dm_et_day": 183, "taken_true": 24 },
    "subscribers_recovered": 0,
    "dm_days_recovered": 0
}
```

Diagnosed rather than assumed:

- 145 booking facts have no `linked_subscriber_id`.
- **All 145 are on the bridge** — their contact resolves to a person.
- **Zero of those 145 persons hold any ManyChat id at all.**

The bridge cannot supply what nobody ever recorded. These are the Carter
Peterson and Mark Holtcamp class: a GoHighLevel contact, a name, and nothing
else. The rung is correct, it is wired into the sync cycle, and it will start
paying the moment those people acquire a ManyChat id. **No money number moved,
and no count changed in either direction.**

Only **1** live person holds more than one GoHighLevel contact, so the
duplicate-contact repair this rung was built for has almost nothing to bite on
today either.

---

## The findings that cost something to learn

1. **`dm_conversation_messages` is two capture paths sharing one column.**
   132,521 rows carry 15-to-17 digit Instagram-scoped ids and no GHL contact;
   620 rows carry 6-to-10 digit ManyChat ids and **do** carry a GHL contact.
   Treating the short ones as Instagram ids would file 49 people under an id
   space they were never in. `registry_person_dm_system()` classifies by shape.

2. **The tracker's `manychat_link` is the ManyChat subscriber space, settled.**
   The brief asked this to be verified against real rows rather than assumed.
   Parsing the chat id out of all 528 links: **527 parsed, 527 equal the stored
   `manychat_subscriber_id`, 0 disagreements.** 375 of them exist in the
   `ads_keyword_events` subscriber space and **0** in the DM space. It is not an
   account-scoped thread id; it is the subscriber id, and it adds no new id
   beyond the column already there.

3. **Name matching would have been actively wrong, with a named victim.**
   `manychat_origin_checks` contains "Carter Kovalsky" and "Carter Klekvolski",
   neither of whom is Carter Peterson. It also contains a row named "Mark
   Holtcamp" whose Instagram handle is `otm_kev02`. Any first-name or fuzzy
   matcher joins at least one of these to the wrong human and reports it as fact.

4. **Carter Peterson is two person rows and the bridge refuses to merge them.**
   One holds GHL contact `BrJv4RkEgAcAm6Qlp8LQ` from his booking; the other holds
   ManyChat `306311390` and Instagram `1352887187017699` from his sale. Nothing
   joins them but a name — and the tracker spells him **"Cater Peterson"**.
   `registry_person_resolve('Carter Peterson')` returns nothing and the door
   returns both candidates. Two rows for one human is the honest state of the
   evidence; one row would have been a guess.

5. **A second pre-existing test failure exists on clean `origin/main`.** The
   brief named one known failure (the export parse). Running the door tests on a
   fresh `origin/main` worktree at `82e9848` before touching anything:
   `GOLDEN LIVE: the budget map reconciles` also fails, 134 of 135 passing. It is
   unrelated to Brick 5 and is flagged here so it is not later blamed on it.

6. **Two bugs the tests caught, both fixed, both invisible without live data.**
   `registry_person_resolve` used `min(person_id)` on a uuid, which Postgres has
   no aggregate for; it only failed on the name branch, which is to say when it
   mattered. And the two new door RPCs were not `SECURITY DEFINER` while every
   other door RPC is, so `lead_quality_read` failed with `permission denied for
   schema warehouse` — a question that would have refused in production and
   passed against any fake.

---

## Tests, verbatim

`npx tsx --test src/lib/question-door/brick5.golden.test.ts`

```
✔ (a) the four FIT bookers resolve by their GHL contact and report what could not be bridged (6428.22425ms)
✔ (a2) Carter Peterson is two people and the door refuses to guess which one (2670.84925ms)
✔ (b) the PRO closes tell a sale-without-a-calendar-booking story (2145.286ms)
✔ (c) a link with no evidence is refused, and name similarity never crosses id systems (1848.091375ms)
✔ (d) merging two people writes the merge record and the absorbed id resolves to the survivor (4397.779458ms)
✔ (e) lead_quality_read reproduces the hand-verified Jake cohort of 27 (2389.942ms)
✔ (e2) a geo split is refused in writing, naming what is missing (3.982709ms)
✔ (f) the locked list is nineteen questions and Brick 5 added exactly two (7.605791ms)
ℹ tests 8
ℹ suites 0
ℹ pass 8
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

### (a) The four FIT bookers — the test asserts they CANNOT bridge

Carter Peterson, Adrian Hidalgo, Mark Holtcamp and Bradford Wendt were
hand-verified in their threads on 8/8 (three typed "fit", the rest came through
the button path). All four resolve from their GoHighLevel contact, all four show
their booking on the right day, and **none of them has a ManyChat or Instagram
id on hard evidence.** The test asserts they are **reported unbridgeable**, in
the answer and in the receipt, rather than silently showing an empty story.
This is the brief's stated fallback and it is the outcome that occurred.

### (e) The Jake cohort, and where the hand-built read differed

`lead_quality_read('jake', 2026-07-28, 2026-07-30)` returns
**27 people who sent the keyword**, reproducing the hand-verified 7/31 read
exactly. All 27 are on the bridge.

It does **not** reproduce the "17 with captured threads". It reports **0 people
bridged to a thread**, and the difference is the brick doing its job. The 17 came
from searching DM bodies for the keyword text, which proves somebody typed a
word, not that a thread belongs to a keyword event. Re-run today over the same
cohort that text search finds **23 threads across 26 messages**, because more DM
history has synced since — a number that moves on its own. The certified answer
reports the hard-evidence count and says why it is zero.

### (f) Full suite

`npm test`

```
ℹ tests 309
ℹ suites 0
ℹ pass 307
ℹ fail 2
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Both failures are pre-existing on clean `origin/main` (finding 5):
`ads-tracker-export.html inline app compiles` and
`GOLDEN LIVE: the budget map reconciles`. Every registry, receipt, kill_scale,
health_check and trust-pack test passes unchanged.

---

## One full `person_timeline`, pasted whole

Hunter Krivokucha, asked by ManyChat id through the door, caller `brick5-report`.
A PRO close with a 41-message Instagram thread reached only through the bridge,
and no calendar booking anywhere.

```json
{
  "question_key": "person_timeline",
  "question": "One person's whole story in the order it happened, across every id system: their first DM from the real thread, the keywords they sent, what they booked, whether they showed, what the tracker recorded and what they paid. Says which links are hard evidence and what could not be bridged at all.",
  "params": {
    "person": "755916801",
    "person_id": "6fa0a5e3-9fc9-4253-b72b-b818a3bdb99c"
  },
  "answers": {
    "ids": {
      "ghl": [],
      "manychat": [
        "755916801"
      ],
      "ig_scoped": [
        "1014855297825764"
      ],
      "tracker_names": [
        "hunter krivokucha"
      ]
    },
    "events": [
      {
        "at": "2026-07-31T15:11:19.436+00:00",
        "kind": "dm_thread_started",
        "detail": {
          "creator": "tyson_sonnek",
          "inbound": 15,
          "id_space": "ig_scoped",
          "messages": 41,
          "outbound": 26,
          "subscriber_id": "1014855297825764",
          "last_message_at": "2026-08-03T18:50:22.287+00:00",
          "first_message_at": "2026-07-31T15:11:19.436+00:00"
        },
        "source": "dm_conversation_messages"
      },
      {
        "at": "2026-07-31T15:11:22.898+00:00",
        "kind": "keyword_event",
        "detail": {
          "setter": "amara",
          "creator": "tyson",
          "keyword": "pro",
          "contact_id": null,
          "event_type": "dm_keyword",
          "subscriber_id": "755916801"
        },
        "source": "ads_keyword_events"
      },
      {
        "at": "2026-08-03T00:00:00+00:00",
        "kind": "tracker_row",
        "detail": {
          "closer": "WOBBE",
          "setter": "Amara",
          "outcome": null,
          "objection": null,
          "call_taken": false,
          "call_number": "Call 18",
          "prospect_name": "Hunter Krivokucha",
          "collected_cents": 0,
          "contracted_cents": 0,
          "manychat_subscriber_id": "755916801"
        },
        "source": "sales_tracker_rows"
      },
      {
        "at": "2026-08-03T00:00:00+00:00",
        "kind": "sale",
        "detail": {
          "closer": "WOBBE",
          "is_win": false,
          "creator": "tyson",
          "keyword": "pro",
          "sale_key": "2026-08-03:call-18:hunter-krivokucha",
          "call_type": "Strategy Session",
          "call_taken": false,
          "blank_reason": null,
          "evidence_key": "subscriber_id",
          "awaiting_review": false,
          "collected_usd_cents": 0,
          "contracted_usd_cents": 0
        },
        "source": "adsv2_sale_facts"
      },
      {
        "at": "2026-08-04T00:00:00+00:00",
        "kind": "sale",
        "detail": {
          "closer": "WOBBE",
          "is_win": false,
          "creator": "tyson",
          "keyword": "pro",
          "sale_key": "2026-08-04:call-18:hunter-krivokucha",
          "call_type": "Strategy Session",
          "call_taken": false,
          "blank_reason": null,
          "evidence_key": "subscriber_id",
          "awaiting_review": false,
          "collected_usd_cents": 0,
          "contracted_usd_cents": 0
        },
        "source": "adsv2_sale_facts"
      },
      {
        "at": "2026-08-04T00:00:00+00:00",
        "kind": "tracker_row",
        "detail": {
          "closer": "WOBBE",
          "setter": "Amara",
          "outcome": null,
          "objection": null,
          "call_taken": false,
          "call_number": "Call 18",
          "prospect_name": "Hunter Krivokucha",
          "collected_cents": 0,
          "contracted_cents": 0,
          "manychat_subscriber_id": "755916801"
        },
        "source": "sales_tracker_rows"
      },
      {
        "at": "2026-08-05T00:00:00+00:00",
        "kind": "sale",
        "detail": {
          "closer": "WOBBE",
          "is_win": true,
          "creator": "tyson",
          "keyword": "pro",
          "sale_key": "2026-08-05:call-18:hunter-krivokucha",
          "call_type": "Strategy Session",
          "call_taken": true,
          "blank_reason": null,
          "evidence_key": "subscriber_id",
          "awaiting_review": false,
          "collected_usd_cents": 120000,
          "contracted_usd_cents": 120000
        },
        "source": "adsv2_sale_facts"
      },
      {
        "at": "2026-08-05T00:00:00+00:00",
        "kind": "tracker_row",
        "detail": {
          "closer": "WOBBE",
          "setter": "Amara",
          "outcome": "WIN",
          "objection": null,
          "call_taken": true,
          "call_number": "Call 18",
          "prospect_name": "Hunter Krivokucha",
          "collected_cents": 120000,
          "contracted_cents": 120000,
          "manychat_subscriber_id": "755916801"
        },
        "source": "sales_tracker_rows"
      }
    ],
    "creators": [
      "tyson"
    ],
    "evidence": [
      {
        "id": "755916801",
        "source": "manychat_origin_checks.raw.ig_id",
        "system": "manychat",
        "linked_at": "2026-08-08T09:43:47.565859+00:00",
        "confidence": "hard"
      },
      {
        "id": "1014855297825764",
        "source": "manychat_origin_checks.raw.ig_id",
        "system": "ig_scoped",
        "linked_at": "2026-08-08T09:43:47.565859+00:00",
        "confidence": "hard"
      },
      {
        "id": "hunter krivokucha",
        "source": "manychat_origin_checks.prospect_name (same row as the subscriber id)",
        "system": "tracker_name",
        "linked_at": "2026-08-08T09:43:47.565859+00:00",
        "confidence": "hard"
      }
    ],
    "person_id": "6fa0a5e3-9fc9-4253-b72b-b818a3bdb99c",
    "event_count": 8,
    "display_name": "Hunter Krivokucha",
    "link_summary": {
      "hard_links": 3,
      "bridged_to_ghl": false,
      "name_match_links": 0,
      "bridged_to_instagram": true
    },
    "could_not_bridge": [
      "No GoHighLevel contact id, so no booking or appointment can be attached to this person by hard evidence."
    ],
    "duplicate_contact_note": null,
    "units": "Money is in CENTS.",
    "reading_note": "Events are in the order they happened. A booking with a dm_day_gap is a booking whose first-DM day is unknown, not a booking that came from nowhere."
  },
  "definitions_quoted": [],
  "as_of": [
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
      "source": "dm_conversation_messages",
      "last_written_at": "2026-08-08T10:05:58.931183+00:00",
      "note": "the last DM message captured"
    }
  ],
  "sources": [
    "registry_persons",
    "ads_keyword_events",
    "dm_conversation_messages",
    "adsv2_booking_facts",
    "adsv2_sale_facts",
    "sales_tracker_rows"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "person_timeline",
    "question_version": 1,
    "asked_at": "2026-08-08T10:06:03.391Z",
    "caller": "brick5-report",
    "params_as_resolved": {
      "person": "755916801",
      "person_id": "6fa0a5e3-9fc9-4253-b72b-b818a3bdb99c"
    },
    "aliases_resolved": [],
    "window": null,
    "data_version": null,
    "freshness": [
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
        "source": "dm_conversation_messages",
        "last_written_at": "2026-08-08T10:05:58.931183+00:00",
        "note": "the last DM message captured"
      }
    ],
    "stale": [],
    "coverage": null,
    "exclusions": [
      {
        "what": "events keyed in an id system this person is not bridged to",
        "count": 0,
        "why": "A link exists only where one stored row carried both ids. Where no such row exists, the events on the far side are unreachable and are reported as unbridged rather than left out silently. Under person_identity v1 an empty list is never evidence that nothing happened."
      },
      {
        "what": "part of this person's story",
        "count": 0,
        "why": "No GoHighLevel contact id, so no booking or appointment can be attached to this person by hard evidence."
      }
    ],
    "caveats": [],
    "certainty": "machine_certain",
    "definitions_cited": [
      {
        "registry": "registry_definitions",
        "name": "person_identity",
        "version": 1
      }
    ]
  }
}```

---

## One full `lead_quality_read`, pasted whole

Jake, 28 to 30 July 2026, split by keyword, asked through the door, caller
`brick5-report`. This is the answer test (e) asserts against.

```json
{
  "question_key": "lead_quality_read",
  "question": "How good a creator's leads were in a window, split by keyword or ad set, with the N beside every claim: how many people sent the keyword, how many of their conversations can actually be read, how deep those went, how many booked, how many showed on the calendar and off it, and what closed.",
  "params": {
    "client": "jake",
    "date_from": "2026-07-28",
    "date_to": "2026-07-30",
    "cohort": "keyword"
  },
  "answers": {
    "units": "Money is in CENTS. Rates are percentages, each carrying the N it was computed over.",
    "client": "jake",
    "method": "The cohort is every person who sent this creator a keyword inside the window, keyed on their ManyChat subscriber id and grouped by the FIRST keyword they sent. Threads, bookings, calls and cash are attached to those people through registry_persons, so a booking recorded against a GoHighLevel contact and a DM recorded against an Instagram-scoped id reach the same human.",
    "totals": {
      "wins": 0,
      "bookings": 2,
      "people_who_booked": 2,
      "collected_usd_cents": 0,
      "people_on_the_bridge": 27,
      "calls_taken_on_calendar": 0,
      "calls_taken_in_the_tracker": 0,
      "people_bridged_to_a_thread": 0,
      "people_who_sent_the_keyword": 27
    },
    "cohorts": [
      {
        "money": {
          "wins": 0,
          "collected_usd_cents": 0
        },
        "cohort": "badge",
        "dm_depth": {
          "note": "No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.",
          "out_of_people": 17,
          "measured_over_people": 0,
          "median_inbound_per_thread": null,
          "median_messages_per_thread": null
        },
        "progression": {
          "bookings": 1,
          "dm_to_book_rate": 5.9,
          "show_rate_over_n": 1,
          "dm_to_book_over_n": 17,
          "off_calendar_note": null,
          "people_who_booked": 1,
          "show_rate_on_calendar": 0,
          "calls_taken_on_calendar": 0,
          "calls_taken_in_the_tracker": 0
        },
        "qualification": {
          "note": "Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.",
          "people_marked_qualified": 0,
          "people_with_a_stage_state": 12
        },
        "early_quality_flags": [
          "This cohort cannot be read at all: not one person in it is bridged to a thread."
        ],
        "people_on_the_bridge": 17,
        "people_bridged_to_a_thread": 0,
        "people_who_sent_the_keyword": 17
      },
      {
        "money": {
          "wins": 0,
          "collected_usd_cents": 0
        },
        "cohort": "proven",
        "dm_depth": {
          "note": "No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.",
          "out_of_people": 5,
          "measured_over_people": 0,
          "median_inbound_per_thread": null,
          "median_messages_per_thread": null
        },
        "progression": {
          "bookings": 1,
          "dm_to_book_rate": 20,
          "show_rate_over_n": 1,
          "dm_to_book_over_n": 5,
          "off_calendar_note": null,
          "people_who_booked": 1,
          "show_rate_on_calendar": 0,
          "calls_taken_on_calendar": 0,
          "calls_taken_in_the_tracker": 0
        },
        "qualification": {
          "note": "Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.",
          "people_marked_qualified": 0,
          "people_with_a_stage_state": 3
        },
        "early_quality_flags": [
          "This cohort cannot be read at all: not one person in it is bridged to a thread."
        ],
        "people_on_the_bridge": 5,
        "people_bridged_to_a_thread": 0,
        "people_who_sent_the_keyword": 5
      },
      {
        "money": {
          "wins": 0,
          "collected_usd_cents": 0
        },
        "cohort": "meter",
        "dm_depth": {
          "note": "No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.",
          "out_of_people": 1,
          "measured_over_people": 0,
          "median_inbound_per_thread": null,
          "median_messages_per_thread": null
        },
        "progression": {
          "bookings": 0,
          "dm_to_book_rate": 0,
          "show_rate_over_n": 0,
          "dm_to_book_over_n": 1,
          "off_calendar_note": null,
          "people_who_booked": 0,
          "show_rate_on_calendar": null,
          "calls_taken_on_calendar": 0,
          "calls_taken_in_the_tracker": 0
        },
        "qualification": {
          "note": "Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.",
          "people_marked_qualified": 0,
          "people_with_a_stage_state": 1
        },
        "early_quality_flags": [
          "This cohort cannot be read at all: not one person in it is bridged to a thread."
        ],
        "people_on_the_bridge": 1,
        "people_bridged_to_a_thread": 0,
        "people_who_sent_the_keyword": 1
      },
      {
        "money": {
          "wins": 0,
          "collected_usd_cents": 0
        },
        "cohort": "sure",
        "dm_depth": {
          "note": "No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.",
          "out_of_people": 1,
          "measured_over_people": 0,
          "median_inbound_per_thread": null,
          "median_messages_per_thread": null
        },
        "progression": {
          "bookings": 0,
          "dm_to_book_rate": 0,
          "show_rate_over_n": 0,
          "dm_to_book_over_n": 1,
          "off_calendar_note": null,
          "people_who_booked": 0,
          "show_rate_on_calendar": null,
          "calls_taken_on_calendar": 0,
          "calls_taken_in_the_tracker": 0
        },
        "qualification": {
          "note": "Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.",
          "people_marked_qualified": 0,
          "people_with_a_stage_state": 1
        },
        "early_quality_flags": [
          "This cohort cannot be read at all: not one person in it is bridged to a thread."
        ],
        "people_on_the_bridge": 1,
        "people_bridged_to_a_thread": 0,
        "people_who_sent_the_keyword": 1
      },
      {
        "money": {
          "wins": 0,
          "collected_usd_cents": 0
        },
        "cohort": "watch",
        "dm_depth": {
          "note": "No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.",
          "out_of_people": 1,
          "measured_over_people": 0,
          "median_inbound_per_thread": null,
          "median_messages_per_thread": null
        },
        "progression": {
          "bookings": 0,
          "dm_to_book_rate": 0,
          "show_rate_over_n": 0,
          "dm_to_book_over_n": 1,
          "off_calendar_note": null,
          "people_who_booked": 0,
          "show_rate_on_calendar": null,
          "calls_taken_on_calendar": 0,
          "calls_taken_in_the_tracker": 0
        },
        "qualification": {
          "note": "Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.",
          "people_marked_qualified": 0,
          "people_with_a_stage_state": 0
        },
        "early_quality_flags": [
          "This cohort cannot be read at all: not one person in it is bridged to a thread."
        ],
        "people_on_the_bridge": 1,
        "people_bridged_to_a_thread": 0,
        "people_who_sent_the_keyword": 1
      },
      {
        "money": {
          "wins": 0,
          "collected_usd_cents": 0
        },
        "cohort": "primed",
        "dm_depth": {
          "note": "No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.",
          "out_of_people": 1,
          "measured_over_people": 0,
          "median_inbound_per_thread": null,
          "median_messages_per_thread": null
        },
        "progression": {
          "bookings": 0,
          "dm_to_book_rate": 0,
          "show_rate_over_n": 0,
          "dm_to_book_over_n": 1,
          "off_calendar_note": null,
          "people_who_booked": 0,
          "show_rate_on_calendar": null,
          "calls_taken_on_calendar": 0,
          "calls_taken_in_the_tracker": 0
        },
        "qualification": {
          "note": "Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.",
          "people_marked_qualified": 0,
          "people_with_a_stage_state": 1
        },
        "early_quality_flags": [
          "This cohort cannot be read at all: not one person in it is bridged to a thread."
        ],
        "people_on_the_bridge": 1,
        "people_bridged_to_a_thread": 0,
        "people_who_sent_the_keyword": 1
      },
      {
        "money": {
          "wins": 0,
          "collected_usd_cents": 0
        },
        "cohort": "honed",
        "dm_depth": {
          "note": "No thread in this cohort could be read. Every one of these people sent a keyword, so the conversations happened; they are in an Instagram-scoped id space this cohort is not bridged to.",
          "out_of_people": 1,
          "measured_over_people": 0,
          "median_inbound_per_thread": null,
          "median_messages_per_thread": null
        },
        "progression": {
          "bookings": 0,
          "dm_to_book_rate": 0,
          "show_rate_over_n": 0,
          "dm_to_book_over_n": 1,
          "off_calendar_note": null,
          "people_who_booked": 0,
          "show_rate_on_calendar": null,
          "calls_taken_on_calendar": 0,
          "calls_taken_in_the_tracker": 0
        },
        "qualification": {
          "note": "Read from person_context, which only holds a stage state for people its own capture reached. Silence here is missing data, not a failed qualification.",
          "people_marked_qualified": 0,
          "people_with_a_stage_state": 0
        },
        "early_quality_flags": [
          "This cohort cannot be read at all: not one person in it is bridged to a thread."
        ],
        "people_on_the_bridge": 1,
        "people_bridged_to_a_thread": 0,
        "people_who_sent_the_keyword": 1
      }
    ],
    "date_to": "2026-07-30",
    "cohort_by": "keyword",
    "date_from": "2026-07-28",
    "speaking_rule": "These are counts and observations. This question does not judge an ad or a keyword; kill_scale_read applies the signed ruleset, and a person decides."
  },
  "definitions_quoted": [
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
      "key": "taken",
      "label": "Calls taken",
      "meaning": "How many strategy calls took place in this window, counted on the day the call happened, including ones booked earlier.",
      "source": "The sales tracker, which only lists calls that took place. Counted by call day, so this can differ from the show-rate group, which counts people booked in this window.",
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
    }
  ],
  "as_of": [
    {
      "source": "ads_keyword_events",
      "last_written_at": "2026-08-08T08:53:18.392+00:00",
      "note": "the last keyword event the capture webhook recorded"
    },
    {
      "source": "adsv2_booking_facts",
      "last_written_at": "2026-08-08T09:25:15.010535+00:00",
      "note": "the newest stamped booking fact"
    },
    {
      "source": "dm_conversation_messages",
      "last_written_at": "2026-08-08T10:06:07.694735+00:00",
      "note": "the last DM message captured"
    }
  ],
  "sources": [
    "registry_persons",
    "person_context",
    "ads_keyword_events",
    "dm_conversation_messages",
    "adsv2_booking_facts",
    "sales_tracker_rows"
  ],
  "receipt": {
    "contract_version": 2,
    "question_key": "lead_quality_read",
    "question_version": 1,
    "asked_at": "2026-08-08T10:06:21.509Z",
    "caller": "brick5-report",
    "params_as_resolved": {
      "client": "jake",
      "date_from": "2026-07-28",
      "date_to": "2026-07-30",
      "cohort": "keyword"
    },
    "aliases_resolved": [],
    "window": {
      "from": "2026-07-28",
      "to": "2026-07-30",
      "kind": "explicit_range"
    },
    "data_version": null,
    "freshness": [
      {
        "source": "ads_keyword_events",
        "last_written_at": "2026-08-08T08:53:18.392+00:00",
        "note": "the last keyword event the capture webhook recorded"
      },
      {
        "source": "adsv2_booking_facts",
        "last_written_at": "2026-08-08T09:25:15.010535+00:00",
        "note": "the newest stamped booking fact"
      },
      {
        "source": "dm_conversation_messages",
        "last_written_at": "2026-08-08T10:06:07.694735+00:00",
        "note": "the last DM message captured"
      }
    ],
    "stale": [],
    "coverage": {
      "window_wins_total": 0,
      "window_cash_usd_cents_total": 0,
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
      "classified_pct_cash": 0,
      "note": "awaiting_review is the only bucket that counts as a gap; ad, organic and misc chat are all classified."
    },
    "exclusions": [
      {
        "what": "conversation depth for people whose thread cannot be reached",
        "count": 0,
        "why": "DM depth is measured only over the people bridged to a real thread, and every cohort states that number next to the total. A median computed over four of twenty-seven people is a fact about four people, and printing it without the denominator would be the same mistake as reporting coverage over the rows that happened to join."
      },
      {
        "what": "the conversations of people who could not be bridged to a thread",
        "count": 27,
        "why": "0 of 27 people in this window are bridged to a readable Instagram thread. The rest sent a keyword, so their conversations happened; they are in an id space no stored row links them across. Their bookings, calls and cash are still counted, because those reach them by other keys."
      }
    ],
    "caveats": [
      "These are counts and observations, not a verdict. This question informs a decision; kill_scale_read applies the signed ruleset and a person decides.",
      "sales_lag v1: Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days. Recent-window answers automatically carry the understatement caveat. A recent dip is provisional and never a kill trigger.",
      "This window ends 2026-07-30, inside the sales lag, so its cash and close numbers will keep rising after this answer was given. A recent dip here is provisional and is never on its own a reason to kill an ad.",
      "pricing_currency v1: One price book across creators: 3-month $1,200; 6-month standard $2,400 with frequent $2,200 closes (closer-level flexibility; the tracker is the record). Revenue reports in USD. Jake's ad account bills in AUD; spend converts at the synced fx rate. Non-USD sale rows convert at sale-date fx.",
      "Jake's ad account bills in AUD, so his spend in this answer has been converted to USD at the synced rate, while the sale money was already USD and was never converted."
    ],
    "certainty": "directional",
    "definitions_cited": [
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
        "name": "collected"
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
        "name": "person_identity",
        "version": 1
      },
      {
        "registry": "registry_definitions",
        "name": "coverage",
        "version": 1
      }
    ]
  },
  "note": "These are counts and observations, not a verdict. This question informs a decision; kill_scale_read applies the signed ruleset and a person decides."
}```
