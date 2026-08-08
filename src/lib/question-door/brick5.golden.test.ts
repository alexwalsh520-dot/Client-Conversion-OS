// ─────────────────────────────────────────────────────────────────────────
// BRICK 5 GOLDEN FIXTURES: the identity bridge, against the REAL database.
//
// Same discipline as Bricks 2, 3 and 4. Every number below was computed in SQL
// against the live database, by hand, BEFORE this file existed. If one ever
// disagrees, either the data moved (recompute by hand and update the fixture,
// saying so in the report) or a rule changed underneath us, which is exactly
// what we want to be told.
//
// The tests that matter most here are the ones that assert a FAILURE to bridge.
// A bridge is easy to make look good by linking generously; what makes this one
// worth trusting is that it refuses, out loud, in the four cases below where
// the only thing connecting two rows is a name.
//
// SKIPS LOUDLY without credentials, so it can never pass by not running.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { askQuestion } from "./service";
import { isRefusal, type Db, type DoorAnswer } from "./types";

function loadEnvLocal(): void {
  const path = resolve(process.cwd(), ".env.local");
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (!m) continue;
    if (process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
loadEnvLocal();

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const LIVE = Boolean(URL && KEY);
const skip = LIVE ? false : "no database credentials in the environment, so the Brick 5 goldens were NOT checked";

function liveDb(): Db {
  return createClient(URL!, KEY!, { auth: { persistSession: false } }) as unknown as Db;
}

const CLIENTS = ["tyson", "jake"] as const;

function answerOf(r: unknown): DoorAnswer {
  assert.ok(!isRefusal(r as never), `expected an answer, got a refusal: ${JSON.stringify(r).slice(0, 400)}`);
  return r as DoorAnswer;
}

type Row = Record<string, unknown>;

async function call(db: Db, fn: string, args: Row): Promise<unknown> {
  const { data, error } = await db.rpc(fn, args);
  assert.ok(!error, `${fn} failed: ${error?.message}`);
  return data;
}

// ─────────────────────────────────────────────────────────────────────────
// (a) THE FOUR FIT BOOKERS, hand-verified on 8/8.
//
// Three typed "fit" and the rest came through the button path; all four were
// verified by hand in the threads. Every one of them has a GoHighLevel contact
// and a booking. NONE of them has a ManyChat id on hard evidence, so none can
// reach a DM thread, and the test asserts they are REPORTED unbridgeable
// rather than quietly showing an empty story.
//
// Carter Peterson is the sharpest case in the whole brick. He exists as TWO
// person rows: one holding the GoHighLevel contact from his booking, one
// holding ManyChat 306311390 and Instagram 1352887187017699 from his sale. The
// only thing connecting them is a name, and the tracker spells him "Cater
// Peterson". The bridge refuses to merge them, and person_timeline refuses to
// answer the name at all, because two live people answer to it.
// ─────────────────────────────────────────────────────────────────────────

const FIT_BOOKERS = [
  { name: "Carter Peterson", contact: "BrJv4RkEgAcAm6Qlp8LQ", booked: "2026-08-05" },
  { name: "Adrian Hidalgo", contact: "WihuT2KoUHRP7hcSDnVF", booked: "2026-08-03" },
  { name: "Mark Holtcamp", contact: "gLZlJYHdV548Cf5NhLv0", booked: "2026-07-28" },
  { name: "Bradford Wendt", contact: "vJbIXnCunLkf63SHQ4Ou", booked: "2026-07-25" },
];

test("(a) the four FIT bookers resolve by their GHL contact and report what could not be bridged", { skip }, async () => {
  const db = liveDb();

  for (const b of FIT_BOOKERS) {
    const r = answerOf(
      await askQuestion(
        { question_key: "person_timeline", params: { person: b.contact } },
        { db, clients: CLIENTS, caller: "test" },
      ),
    );
    const a = r.answers as Row;
    const ids = a.ids as Row;

    // The contact resolved to a person, and that person holds this contact.
    assert.ok(a.person_id, `${b.name}: the GHL contact did not resolve to a person`);
    assert.deepEqual(ids.ghl, [b.contact], `${b.name}: wrong contact on the person`);

    // Their booking is on the timeline, on the day it was hand-verified for.
    const events = a.events as Array<Row>;
    const bookings = events.filter((e) => e.kind === "booking");
    assert.ok(bookings.length >= 1, `${b.name}: no booking on the timeline`);
    assert.ok(
      bookings.some((e) => (e.detail as Row).booked_et_day === b.booked),
      `${b.name}: no booking on ${b.booked}`,
    );

    // And the part that matters: no ManyChat id, no Instagram id, SAID OUT LOUD.
    assert.deepEqual(ids.manychat, [], `${b.name}: unexpected ManyChat id`);
    assert.deepEqual(ids.ig_scoped, [], `${b.name}: unexpected Instagram id`);
    const couldNot = (a.could_not_bridge as string[]) || [];
    assert.ok(
      couldNot.some((s) => s.includes("Instagram")),
      `${b.name}: the missing Instagram id was not reported`,
    );
    assert.ok(
      couldNot.some((s) => s.includes("ManyChat")),
      `${b.name}: the missing ManyChat id was not reported`,
    );

    // The receipt carries the same admission, so a reader who only reads the
    // receipt cannot come away thinking the story was complete.
    assert.ok(
      r.receipt.exclusions.some((e) => e.why.includes("Instagram")),
      `${b.name}: the receipt did not carry the unbridged exclusion`,
    );
  }
});

test("(a2) Carter Peterson is two people and the door refuses to guess which one", { skip }, async () => {
  const db = liveDb();

  // The name resolves to nothing, because two live people answer to it.
  const resolved = await call(db, "registry_person_resolve", { p_identifier: "Carter Peterson" });
  assert.equal(resolved, null, "an ambiguous name must never resolve to one person");

  const r = answerOf(
    await askQuestion(
      { question_key: "person_timeline", params: { person: "Carter Peterson" } },
      { db, clients: CLIENTS, caller: "test" },
    ),
  );
  const a = r.answers as Row;
  assert.equal(a.answered, false, "an ambiguous name must not return a single story");
  assert.ok(String(a.why_not).includes("More than one person"), "the refusal must say why");
  assert.ok(((a.candidates as unknown[]) || []).length >= 2, "both candidates must be offered");

  // The sale side of him is bridged all the way to a thread; the booking side
  // is not; and nothing joins them but a name the tracker spelled "Cater".
  const saleSide = answerOf(
    await askQuestion(
      { question_key: "person_timeline", params: { person: "306311390" } },
      { db, clients: CLIENTS, caller: "test" },
    ),
  ).answers as Row;
  assert.deepEqual((saleSide.ids as Row).ig_scoped, ["1352887187017699"]);
  assert.deepEqual((saleSide.ids as Row).ghl, [], "the sale side must NOT have acquired the booking's contact");
});

// ─────────────────────────────────────────────────────────────────────────
// (b) THE TWO PRO CLOSES WITH NO BOOKING FACT, verified 8/7.
//
// Both bought. Neither has a booking on any calendar. The timeline has to show
// that as a fact about the calendar, not as a missing person.
// ─────────────────────────────────────────────────────────────────────────

const PRO_CLOSES = [
  { name: "Jacob Duran", manychat: "396494297", ig: "1405171361469648", cents: 239900, day: "2026-08-01" },
  { name: "Hunter Krivokucha", manychat: "755916801", ig: "1014855297825764", cents: 120000, day: "2026-08-05" },
];

test("(b) the PRO closes tell a sale-without-a-calendar-booking story", { skip }, async () => {
  const db = liveDb();

  for (const p of PRO_CLOSES) {
    const r = answerOf(
      await askQuestion(
        { question_key: "person_timeline", params: { person: p.manychat } },
        { db, clients: CLIENTS, caller: "test" },
      ),
    );
    const a = r.answers as Row;
    const ids = a.ids as Row;
    const events = a.events as Array<Row>;

    // Bridged to their real thread on hard evidence.
    assert.deepEqual(ids.ig_scoped, [p.ig], `${p.name}: not bridged to their Instagram thread`);
    const threads = events.filter((e) => e.kind === "dm_thread_started");
    assert.ok(threads.length >= 1, `${p.name}: the bridged thread did not appear`);
    assert.ok(Number((threads[0].detail as Row).messages) > 0, `${p.name}: the thread was empty`);

    // The win is there, with its cash.
    const wins = events.filter((e) => e.kind === "sale" && (e.detail as Row).is_win === true);
    assert.ok(wins.length >= 1, `${p.name}: no win on the timeline`);
    assert.ok(
      wins.some((e) => Number((e.detail as Row).collected_usd_cents) === p.cents),
      `${p.name}: the win did not carry ${p.cents} cents`,
    );

    // And there is NO booking, which is the whole point of this fixture.
    assert.equal(events.filter((e) => e.kind === "booking").length, 0, `${p.name}: unexpected booking`);
    const couldNot = (a.could_not_bridge as string[]) || [];
    assert.ok(
      couldNot.some((s) => s.includes("GoHighLevel")),
      `${p.name}: a sale with no booking must say no GoHighLevel contact was reached`,
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────
// (c) DISJOINTNESS IS RESPECTED: no evidence, no link.
//
// The two id spaces were measured on 2026-08-08 as 7,623 ManyChat ids and
// 36,598 Instagram-scoped ids with ONE value in common. A bridge that linked on
// anything less than a stored row carrying both would be inventing people.
// ─────────────────────────────────────────────────────────────────────────

test("(c) a link with no evidence is refused, and name similarity never crosses id systems", { skip }, async () => {
  const db = liveDb();
  const stamp = `brick5-c-${Date.now()}`;
  const idA = `TEST-MC-${stamp}`;
  const idB = `TEST-IG-${stamp}`;

  const person = (await call(db, "registry_person_ensure", {
    p_system: "manychat",
    p_id: idA,
    p_source: "test:brick5",
    p_confidence: "hard",
    p_display_name: "Brick 5 Test C",
    p_client_key: null,
  })) as string;
  assert.ok(person, "the test person was not created");

  // No source: refused.
  const noSource = await db.rpc("registry_person_link", {
    p_person_id: person,
    p_system: "ig_scoped",
    p_id: idB,
    p_source: "",
    p_confidence: "hard",
  });
  assert.ok(noSource.error, "a link with no evidence must be refused");
  assert.ok(/needs a source/i.test(noSource.error!.message), `wrong refusal: ${noSource.error!.message}`);

  // name_match across id systems: refused.
  const nameAcross = await db.rpc("registry_person_link", {
    p_person_id: person,
    p_system: "ig_scoped",
    p_id: idB,
    p_source: "test:brick5 a name that looked similar",
    p_confidence: "name_match",
  });
  assert.ok(nameAcross.error, "a name_match must never join two id systems");
  assert.ok(/name similarity/i.test(nameAcross.error!.message), `wrong refusal: ${nameAcross.error!.message}`);

  // Nothing stuck to the person.
  const holder = await call(db, "registry_person_holding", { p_system: "ig_scoped", p_id: idB });
  assert.equal(holder, null, "a refused link must leave no trace on the person");

  await db.from("registry_persons").delete().eq("person_id", person);
});

// ─────────────────────────────────────────────────────────────────────────
// (d) A MERGE IS A RECORDED OPERATION, and the absorbed id keeps resolving.
// ─────────────────────────────────────────────────────────────────────────

test("(d) merging two people writes the merge record and the absorbed id resolves to the survivor", { skip }, async () => {
  const db = liveDb();
  const stamp = `brick5-d-${Date.now()}`;
  const idA = `TEST-MC-${stamp}`;
  const idB = `TEST-GHL-${stamp}`;

  const survivor = (await call(db, "registry_person_ensure", {
    p_system: "manychat", p_id: idA, p_source: "test:brick5", p_confidence: "hard",
    p_display_name: "Brick 5 Survivor", p_client_key: null,
  })) as string;
  const absorbed = (await call(db, "registry_person_ensure", {
    p_system: "ghl", p_id: idB, p_source: "test:brick5", p_confidence: "hard",
    p_display_name: "Brick 5 Absorbed", p_client_key: null,
  })) as string;
  assert.notEqual(survivor, absorbed, "the two test people must start apart");

  // A merge with no reason is refused: a merge nobody can audit is a merge
  // nobody should trust.
  const noReason = await db.rpc("registry_person_merge", {
    p_survivor: survivor, p_absorbed: absorbed, p_reason: "", p_actor: "test",
  });
  assert.ok(noReason.error, "a merge with no written reason must be refused");

  const merged = (await call(db, "registry_person_merge", {
    p_survivor: survivor,
    p_absorbed: absorbed,
    p_reason: "Brick 5 test: two synthetic people merged on purpose.",
    p_actor: "test",
  })) as string;
  assert.equal(merged, survivor);

  // The absorbed person's id now resolves to the survivor.
  assert.equal(await call(db, "registry_person_resolve", { p_identifier: idB }), survivor);
  assert.equal(await call(db, "registry_person_resolve", { p_identifier: absorbed }), survivor);

  // The merge is written down, with who and why.
  const { data: merges } = await db
    .from("registry_person_merges")
    .select("survivor_person_id, absorbed_person_id, reason, actor")
    .eq("absorbed_person_id", absorbed);
  assert.equal((merges || []).length, 1, "the merge was not recorded");
  assert.equal((merges as Row[])[0].actor, "test");

  // The absorbed row is KEPT, not deleted. Archive, never delete.
  const { data: kept } = await db
    .from("registry_persons")
    .select("person_id, merged_into")
    .eq("person_id", absorbed)
    .maybeSingle();
  assert.ok(kept, "the absorbed person row must be kept");
  assert.equal((kept as Row).merged_into, survivor);

  await db.from("registry_person_merges").delete().eq("absorbed_person_id", absorbed);
  await db.from("registry_persons").delete().eq("person_id", absorbed);
  await db.from("registry_persons").delete().eq("person_id", survivor);
});

// ─────────────────────────────────────────────────────────────────────────
// (e) lead_quality_read REPRODUCES THE 7/31 JAKE SHAPE.
//
// The hand-built read on 7/31 counted 27 keyword DMs over 28 to 30 July. The
// certified question returns the same 27.
//
// It does NOT return the "17 with captured threads" the hand-built read
// reported, and that difference is the brick working. Those 17 came from
// searching DM bodies for the keyword text, which proves somebody typed a word,
// not that a thread belongs to a keyword event. Re-run today the same text
// search finds 23 threads, because more DM history has synced since. The
// certified answer reports 0 people bridged to a thread on hard evidence and
// says why, rather than reporting a number that would move on its own.
// ─────────────────────────────────────────────────────────────────────────

test("(e) lead_quality_read reproduces the hand-verified Jake cohort of 27", { skip }, async () => {
  const db = liveDb();
  const r = answerOf(
    await askQuestion(
      {
        question_key: "lead_quality_read",
        params: { client: "jake", date_from: "2026-07-28", date_to: "2026-07-30" },
      },
      { db, clients: CLIENTS, caller: "test" },
    ),
  );
  const a = r.answers as Row;
  const totals = a.totals as Row;

  assert.equal(Number(totals.people_who_sent_the_keyword), 27, "the 7/31 hand-verified cohort was 27 people");
  assert.equal(Number(totals.people_on_the_bridge), 27, "every one of them should be on the bridge");
  assert.equal(Number(totals.people_bridged_to_a_thread), 0, "none of them is bridged to a thread on hard evidence");

  // Every cohort states the denominator its depth was measured over.
  for (const c of a.cohorts as Array<Row>) {
    const depth = c.dm_depth as Row;
    assert.equal(
      Number(depth.out_of_people),
      Number(c.people_who_sent_the_keyword),
      "DM depth must carry the cohort size it was measured against",
    );
    assert.ok(String(depth.note).length > 0, "DM depth must always explain its denominator");
  }

  // A money answer, so the receipt carries coverage and the unbridged count.
  assert.ok(r.receipt.coverage, "lead_quality_read is a money answer and must carry coverage");
  const unbridged = r.receipt.exclusions.find((e) => e.what.includes("could not be bridged"));
  assert.ok(unbridged, "the receipt must say how many people could not be bridged");
  assert.equal(unbridged!.count, 27, "all 27 are unbridged, and the receipt must say so");

  // It informs; it does not judge. Both halves of that are asserted: the
  // answer says it does not judge, and the door's own note says who does.
  assert.ok(String(a.speaking_rule).includes("does not judge"), "this question must not deliver a verdict");
  assert.ok(String(a.speaking_rule).includes("kill_scale_read"), "it must name where verdicts actually come from");
  assert.ok(String(r.note ?? "").includes("not a verdict"), "the door note must say these are not a verdict");
});

test("(e2) a geo split is refused in writing, naming what is missing", { skip }, async () => {
  const db = liveDb();
  const r = await askQuestion(
    {
      question_key: "lead_quality_read",
      params: { client: "jake", date_from: "2026-07-28", date_to: "2026-07-30", cohort: "geo" },
    },
    { db, clients: CLIENTS, caller: "test" },
  );
  assert.ok(isRefusal(r), "a cohort this system cannot compute must be refused, never approximated");
  assert.ok(/geo_count/.test(r.reason), `the refusal must name what is actually stored: ${r.reason}`);
});

// ─────────────────────────────────────────────────────────────────────────
// The locked list grew by exactly two, and nothing before it moved.
// ─────────────────────────────────────────────────────────────────────────

test("(f) the locked list is twenty-three questions and Brick 5 added exactly two", { skip: false }, async () => {
  const { QUESTION_KEYS } = await import("./registry");
  // Written as 17 -> 19 pre-merge; Brick 6 (parallel wave) landed first with its
  // four, so the merged list is 23. Brick 5 still added exactly two.
  assert.equal(QUESTION_KEYS.length, 23, "Bricks 5 + 6 take the locked list from seventeen to twenty-three");
  assert.ok(QUESTION_KEYS.includes("person_timeline"));
  assert.ok(QUESTION_KEYS.includes("lead_quality_read"));
  // Question 6 is untouched: no existing template's numbers change.
  assert.ok(QUESTION_KEYS.includes("person_lookup"), "person_lookup must still be on the list");
});
