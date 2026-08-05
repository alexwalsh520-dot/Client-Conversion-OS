import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion, describeDoor, nearestQuestions } from "./service";
import { resetReceiptCaches } from "./receipts";
import { QUESTIONS, QUESTION_KEYS, ALL_KNOWN_SOURCES } from "./registry";
import { ANSWERABLE_METRIC_KEYS, NON_METRIC_KEYS } from "./answers";
import { isRefusal, type DoorAnswer, type Db } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// THE LAWS THIS FILE PINS:
//   1. A question that is not on the list is REFUSED, never improvised, and
//      the refusal names the nearest allowed question.
//   2. A malformed or unknown parameter is REFUSED, never repaired by guessing.
//   3. A window that was not saved is REFUSED, never computed.
//   4. A name lookup returns a labelled CANDIDATE LIST and never one silent
//      best guess.
//   5. Every answer carries its quoted definitions and a real as-of time.
//
// Everything here runs against a constructed database. No real data is read.
// ─────────────────────────────────────────────────────────────────────────

const DATA_VERSION = 154;

/** A saved window payload, in the exact shape serve.ts stores. */
function payload(opts: { spendCents: number; messages: number; collectedCents: number }) {
  const base = {
    spendCents: opts.spendCents,
    impressions: 1000,
    clicks: 50,
    messages: opts.messages,
    booked: 4,
    taken: 2,
    takenPeople: 2,
    showedPeople: 2,
    upcoming: 1,
    newClients: 1,
    collectedCents: opts.collectedCents,
    contractedCents: opts.collectedCents,
  };
  return {
    account: "tyson",
    status: "all",
    level: "tree",
    dateFrom: "2026-07-28",
    dateTo: "2026-07-28",
    dataVersion: DATA_VERSION,
    total: base,
    campaigns: [
      {
        id: "camp-1",
        name: "SCALING - Winners",
        level: "campaign",
        clientKey: "tyson",
        children: [
          {
            id: "adset-1",
            name: "FIT",
            level: "adset",
            clientKey: "tyson",
            children: [
              {
                ...base,
                id: "ad-1",
                name: "FIT",
                keyword: "fit",
                level: "ad",
                clientKey: "tyson",
                status: "active",
              },
            ],
          },
        ],
      },
    ],
    freshness: {},
    notices: [],
    generatedAt: "2026-07-29T09:25:23.228Z",
    computeMs: 100,
  };
}

const SAVED_WINDOWS = [
  { account: "tyson", date_from: "2026-07-28", date_to: "2026-07-28", status: "all" },
  { account: "jake", date_from: "2026-07-28", date_to: "2026-07-28", status: "all" },
  { account: "tyson", date_from: "2026-07-28", date_to: "2026-07-28", status: "active" },
];

const DEFINITIONS = ANSWERABLE_METRIC_KEYS.map((key, i) => ({
  key,
  label: `Label for ${key}`,
  meaning: `The stored meaning of ${key}.`,
  source: `Where ${key} comes from.`,
  format: "int",
  is_calculated: false,
  sort_order: i,
  refreshed_at: "2026-07-29T09:26:00.396Z",
}));

/** The coverage row door_coverage_block returns. The fake keeps the same
 *  arithmetic the real function guarantees: the four buckets sum to the total. */
const COVERAGE_ROW = {
  window_wins_total: 19,
  window_cash_usd_cents: 2929400,
  ad_wins: 17,
  ad_cash_usd_cents: 2509500,
  organic_wins: 1,
  organic_cash_usd_cents: 220000,
  misc_chat_wins: 0,
  misc_chat_cash_usd_cents: 0,
  awaiting_wins: 1,
  awaiting_cash_usd_cents: 199900,
  unassigned_awaiting_wins: 1,
  misc_chat_awaiting_overlap: 0,
};

/** The signed rules the caveat engine quotes, in the shape the view returns. */
const SIGNED_DEFINITIONS = [
  { name: "sales_lag", version: 1, status: "signed", statement: "Sales lag is a median of 2 days and a p90 of 13 days; sales lag spend by 5-14 days." },
  { name: "coverage", version: 1, status: "signed", statement: "Coverage = the percentage of wins AND the percentage of cash sitting in the AD, ORGANIC or MISC CHAT buckets." },
  { name: "pricing_currency", version: 1, status: "signed", statement: "Revenue reports in USD. Jake's ad account bills in AUD; spend converts at the synced fx rate." },
  { name: "former_creators", version: 1, status: "signed", statement: "Antwan, Keith, Zoe and Emily are former creators." },
];

const THRESHOLD_ROWS = [
  { source: "warehouse.answers", threshold_hours: 26, note: "the saved window answers" },
  { source: "warehouse.ad_changes", threshold_hours: 26, note: "the ad change log" },
];

interface Calls {
  rpc: Array<{ fn: string; args: unknown }>;
  /** Every row written through db.from(table).insert(row), so the tests can
   *  prove the miss log and the ask log actually received one. */
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
}

interface FakeOpts {
  /** Rows returned by db.from(table).select(...) for a plain table read. */
  tables?: Record<string, unknown[]>;
  /** Make db.from(table).insert throw, to prove logging can never break an answer. */
  breakInserts?: boolean;
}

function fakeDb(
  overrides: Record<string, unknown[]> = {},
  fakeOpts: FakeOpts = {},
): { db: Db; calls: Calls } {
  const calls: Calls = { rpc: [], inserts: [] };
  const tableData: Record<string, unknown[]> = {
    registry_entities: [{ canonical_key: "jake" }, { canonical_key: "tyson" }],
    door_freshness_thresholds: THRESHOLD_ROWS,
    registry_definitions_current: SIGNED_DEFINITIONS,
    ...(fakeOpts.tables || {}),
  };
  const rpcData: Record<string, unknown[]> = {
    door_coverage_block: [COVERAGE_ROW],
    question_door_definitions: DEFINITIONS,
    question_door_freshness: [
      {
        source: "warehouse.answers",
        last_written_at: "2026-07-29T09:25:50.041Z",
        note: "the newest saved window answer at the version the tab is serving",
      },
      {
        source: "warehouse.ad_changes",
        last_written_at: "2026-07-28T23:27:48.393Z",
        note: "the newest row written into the ad change log",
      },
    ],
    question_door_change_history: [
      {
        client_key: "tyson",
        changed_at_utc: "2026-07-28T14:02:00Z",
        change_type: "budget",
        old_budget_cents: 11500,
        new_budget_cents: 5000,
        actor: "Alex Walsh",
      },
    ],
    question_door_person_candidates: [
      { person_key: "p1", display_name: "Hunter Chapman", match_kind: "exact_name" },
      { person_key: "p2", display_name: "Hunter Chapman Jr", match_kind: "name_contains" },
    ],
    question_door_person_by_id: [
      { person_key: "p1", client_key: "tyson", display_name: "Hunter Chapman", manychat_subscriber_ids: ["mc1"], ghl_contact_ids: ["ghl1"] },
    ],
    question_door_person_events: [{ kind: "sale", et_day: "2026-07-25", keyword_normalized: "good" }],
    question_door_why_unattributed: [
      { kind: "booking", fact_key: "appt-1", blank_reason: "no_utm_on_booking_link", evidence_key: null },
    ],
    question_door_ad_setup: [{ ad_id: "ad-1", keyword_normalized: "fit", primary_text: "copy" }],
    question_door_sales_cycle: [
      { measured_sales: 125, excluded_sales: 6, p25_days: 1, median_days: 1, p75_days: 3, p90_days: 12.2, min_days: 0, max_days: 42, within_7_days: 106, within_14_days: 115 },
    ],
    question_door_attribution_share: [
      { bucket: "counted_by_the_tab", client_key: "tyson", sales: 131, wins: 31, cash_usd_cents: 3562900 },
      { bucket: "no_ad_evidence", client_key: null, sales: 60, wins: 10, cash_usd_cents: 1679700 },
    ],
    question_door_leak_map: [{ kind: "booking", blank_reason: "no_utm_on_booking_link", records: 42 }],
    question_door_leak_trend: [{ window_label: "this window", bookings: 124, keywordless_bookings: 58 }],
    question_door_ad_run_dates: [{ ad_id: "ad-1", days_live: 12, first_active_day: "2026-07-17", budget_level: "adset", daily_budget_usd_cents: 11500 }],
    question_door_data_health: [
      { check_key: "books_balance", plain_english_name: "The books balance", status: "green", ran_at: "2026-07-29T08:45:52Z", et_day: "2026-07-29" },
    ],
    ...overrides,
  };

  /** The registry's declared aliases, exactly as Brick 1 stores them. */
  const ALIASES: Record<string, string> = {
    jake_divljak: "jake",
    "jake divijak": "jake",
    rrf: "jake",
    jake: "jake",
    tyson_sonnek: "tyson",
    tyson: "tyson",
    antwan: "antwan",
    keith: "keith",
  };

  const db = {
    rpc(fn: string, args: unknown) {
      calls.rpc.push({ fn, args });
      // registry_resolve_entity returns a SCALAR, not a row set, and returns
      // null for a name the registry does not know rather than a near miss.
      if (fn === "registry_resolve_entity" && !overrides.registry_resolve_entity) {
        const alias = String((args as { p_alias?: string })?.p_alias ?? "").trim().toLowerCase();
        return Promise.resolve({ data: ALIASES[alias] ?? null, error: null });
      }
      let data = rpcData[fn] ?? [];
      // The real function filters on p_keys, so the fake must too: this is what
      // proves the door quotes ONLY the metrics its answer actually names.
      if (fn === "question_door_definitions" && !overrides.question_door_definitions) {
        const keys = (args as { p_keys?: string[] | null })?.p_keys;
        if (keys) data = (data as Array<{ key: string }>).filter((d) => keys.includes(d.key));
      }
      return Promise.resolve({ data, error: null });
    },
    from(table: string) {
      const filters: Record<string, unknown> = {};
      const chain = {
        select() {
          return chain;
        },
        eq(col: string, val: unknown) {
          filters[col] = val;
          return chain;
        },
        order() {
          return chain;
        },
        // The two Brick 2 logs write through here. breakInserts proves the
        // door survives a logging failure, including one thrown synchronously
        // before any promise exists.
        insert(row: Record<string, unknown>) {
          if (fakeOpts.breakInserts) throw new TypeError("the log table is unreachable");
          calls.inserts.push({ table, row });
          return Promise.resolve({ data: null, error: null });
        },
        maybeSingle() {
          if (table === "adsv2_meta") {
            return Promise.resolve({ data: { value: DATA_VERSION }, error: null });
          }
          if (table === "registry_entities") {
            return Promise.resolve({ data: { kind: "creator" }, error: null });
          }
          const hit = SAVED_WINDOWS.find(
            (w) =>
              w.account === filters.account &&
              w.date_from === filters.date_from &&
              w.date_to === filters.date_to &&
              w.status === filters.status,
          );
          if (!hit) return Promise.resolve({ data: null, error: null });
          return Promise.resolve({
            data: {
              ...hit,
              data_version: DATA_VERSION,
              computed_at: "2026-07-29T09:25:23.228Z",
              payload: payload({ spendCents: 31316, messages: 28, collectedCents: 199900 }),
            },
            error: null,
          });
        },
        // listLiveWindows and the Brick 2 table reads resolve the builder
        // directly (no maybeSingle), so this stays table-aware rather than
        // handing every caller the saved-window list.
        then(resolve: (v: unknown) => void) {
          if (table in tableData) {
            resolve({ data: tableData[table], error: null });
            return;
          }
          resolve({ data: SAVED_WINDOWS, error: null });
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as Db, calls };
}

const OPTS = { clients: ["tyson", "jake"] as const, now: new Date("2026-07-29T13:00:00Z") };
const ask = (question_key: unknown, params: Record<string, unknown> = {}) =>
  askQuestion({ question_key, params }, { db: fakeDb().db, ...OPTS, caller: "test" });

// ── Law 1: off-list questions are refused, never improvised ──────────────

test("a question that is not on the list is refused, with the nearest named", async () => {
  const r = await ask("what is our roas");
  assert.ok(isRefusal(r));
  assert.match(r.reason, /not on the list/);
  assert.deepEqual(r.allowed_questions, [...QUESTION_KEYS]);
  // It suggests rather than substitutes.
  assert.ok(Array.isArray(r.nearest));
});

test("an empty question is refused rather than defaulted", async () => {
  const r = await ask("");
  assert.ok(isRefusal(r));
  assert.match(r.reason, /No question was named/);
});

test("the nearest-question helper points a near miss at the real key", () => {
  const near = nearestQuestions("metric_value");
  assert.equal(near[0].question_key, "metric_value");
});

test("every question on the list is described for a caller", () => {
  const described = describeDoor();
  assert.equal(described.length, QUESTIONS.length);
  for (const d of described) {
    assert.ok(d.description.length > 20, `${d.question_key} needs a plain description`);
    assert.ok(d.params.length > 3, `${d.question_key} needs its params described`);
    assert.ok(d.sources.length > 0, `${d.question_key} must name its sources`);
  }
});

test("every declared source and freshness source is a real stored place", () => {
  for (const q of QUESTIONS) {
    for (const s of q.sources) assert.ok(ALL_KNOWN_SOURCES.includes(s), `${q.key}: unknown source ${s}`);
    for (const s of q.freshnessSources) {
      assert.ok(ALL_KNOWN_SOURCES.includes(s), `${q.key}: unknown freshness source ${s}`);
    }
  }
});

// ── Law 2: malformed parameters are refused, never repaired ──────────────

test("a malformed day is refused", async () => {
  const r = await ask("metric_value", { client: "tyson", date_from: "28-07-2026", date_to: "2026-07-28" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /YYYY-MM-DD/);
});

test("a day that does not exist is refused", async () => {
  const r = await ask("metric_value", { client: "tyson", date_from: "2026-02-31", date_to: "2026-02-31" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /not a real calendar day/);
});

test("a backwards date range is refused", async () => {
  const r = await ask("metric_value", { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-01" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /cannot be after/);
});

test("a former creator is refused by name, with the reason", async () => {
  const r = await ask("metric_value", { client: "antwan", date_from: "2026-07-28", date_to: "2026-07-28" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /active roster/);
});

test("an unknown parameter is refused rather than silently ignored", async () => {
  const r = await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    keyword: "fit",
  });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /does not take keyword/);
});

test("a metric that is not a number is refused by name, with the reason", async () => {
  const r = await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    metrics: ["budget"],
  });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /daily dial/);
  assert.ok(NON_METRIC_KEYS.budget);
});

test("a metric that does not exist is refused", async () => {
  const r = await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    metrics: ["profit"],
  });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /not one of the defined metrics/);
});

// ── Law 3: an unsaved window is refused, never computed ──────────────────

test("a window that was never saved is refused, and the saved ones are listed", async () => {
  const r = await ask("metric_value", { client: "tyson", date_from: "2026-01-01", date_to: "2026-01-31" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /No saved answer exists/);
  assert.match(r.reason, /will not build this window/);
  assert.match(r.reason, /2026-07-28/);
});

// ── Laws 4 and 5, and the answers themselves ────────────────────────────

test("metric_value returns the saved total, with definitions and a real as-of", async () => {
  const r = (await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    metrics: ["spend", "messages", "collected", "collectedRoi"],
  })) as DoorAnswer;
  assert.ok(!isRefusal(r));
  const a = r.answers as Record<string, Record<string, number>>;
  // Straight from the saved payload, not recounted.
  assert.equal(a.total.spend, 31316);
  assert.equal(a.total.messages, 28);
  assert.equal(a.total.collected, 199900);
  // The one calculated value uses the tab's own formula over those saved bases.
  assert.equal(a.total.collectedRoi, 199900 / 31316);
  assert.equal(r.definitions_quoted.length, 4);
  assert.equal(r.as_of[0].source, "warehouse.answers");
  assert.equal(r.as_of[0].last_written_at, "2026-07-29T09:25:50.041Z");
});

test("metric_value per_ad returns one row per ad from the saved tree", async () => {
  const r = (await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    scope: "per_ad",
    metrics: ["spend"],
  })) as DoorAnswer;
  const a = r.answers as { ads: Array<Record<string, unknown>> };
  assert.equal(a.ads.length, 1);
  assert.equal(a.ads[0].keyword, "fit");
  assert.equal(a.ads[0].spend, 31316);
});

test("an unknown scope is refused", async () => {
  const r = await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    scope: "per_campaign",
  });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /scope must be/);
});

test("yesterday_summary reads the saved yesterday window and yesterday's changes", async () => {
  const r = (await ask("yesterday_summary", { client: "tyson" })) as DoorAnswer;
  assert.ok(!isRefusal(r));
  const a = r.answers as Record<string, unknown>;
  assert.equal(a.day, "2026-07-28");
  assert.equal((a.totals as Record<string, number>).spend, 31316);
  assert.equal(a.changes_count, 1);
});

test("a name lookup returns a labelled candidate list and never one silent answer", async () => {
  const r = (await ask("person_lookup", { name: "Hunter Chapman" })) as DoorAnswer;
  assert.ok(!isRefusal(r));
  const a = r.answers as Record<string, unknown>;
  assert.equal(a.answered, false);
  assert.match(String(a.why_not), /never for keying/);
  assert.equal((a.candidates as unknown[]).length, 2);
  assert.equal((a.candidates as Array<Record<string, string>>)[0].match_kind, "exact_name");
});

test("why_unattributed asked by name returns candidates, not a reason", async () => {
  const r = (await ask("why_unattributed", { client: "tyson", kind: "sale", name: "Hunter Chapman" })) as DoorAnswer;
  const a = r.answers as Record<string, unknown>;
  assert.equal(a.answered, false);
  assert.equal((a.candidates as unknown[]).length, 2);
});

test("why_unattributed asked by a hard key returns the stamp verbatim", async () => {
  const r = (await ask("why_unattributed", { client: "tyson", kind: "booking", fact_key: "appt-1" })) as DoorAnswer;
  const a = r.answers as Record<string, unknown>;
  assert.equal(a.looked_up_by, "fact_key");
  assert.equal((a.rows as Array<Record<string, string>>)[0].blank_reason, "no_utm_on_booking_link");
});

test("why_unattributed with no way to find the row is refused", async () => {
  const r = await ask("why_unattributed", { client: "tyson", kind: "sale" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /never picks a row for you/);
});

test("kill_scale_inputs returns inputs and says the verdict is not its to give", async () => {
  const r = (await ask("kill_scale_inputs", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    status: "all",
  })) as DoorAnswer;
  assert.ok(!isRefusal(r));
  assert.match(String(r.note), /INPUTS, not a verdict/);
  const a = r.answers as { ads: Array<Record<string, unknown>> };
  assert.equal(a.ads[0].days_live, 12);
  assert.equal(a.ads[0].spend, 31316);
});

test("sales_cycle reports what it could not measure alongside what it could", async () => {
  const r = (await ask("sales_cycle", { client: "tyson", date_from: "2026-06-30", date_to: "2026-07-29" })) as DoorAnswer;
  const a = r.answers as Record<string, Record<string, number>>;
  assert.equal(a.days_from_first_keyword_to_close.measured_sales, 125);
  assert.equal(a.days_from_first_keyword_to_close.could_not_measure, 6);
  assert.equal(a.days_from_first_keyword_to_close.median, 1);
});

test("attribution_share is roster-wide and totals its buckets", async () => {
  const r = (await ask("attribution_share", { date_from: "2026-06-30", date_to: "2026-07-29" })) as DoorAnswer;
  const a = r.answers as Record<string, Record<string, { cash_usd_cents: number }>>;
  assert.equal(a.totals_by_bucket.counted_by_the_tab.cash_usd_cents, 3562900);
  assert.equal(a.totals_by_bucket.no_ad_evidence.cash_usd_cents, 1679700);
});

test("attribution_share refuses a client, because that cash has no creator", async () => {
  const r = await ask("attribution_share", { client: "tyson", date_from: "2026-06-30", date_to: "2026-07-29" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /does not take client/);
});

test("leak_map returns the written reasons and the trend", async () => {
  const r = (await ask("leak_map", { date_from: "2026-06-30", date_to: "2026-07-29" })) as DoorAnswer;
  const a = r.answers as Record<string, unknown[]>;
  assert.equal((a.by_reason as Array<Record<string, string>>)[0].blank_reason, "no_utm_on_booking_link");
  assert.equal(a.keywordless_booking_trend.length, 1);
});

test("data_health returns the latest run verbatim, with its counts", async () => {
  const r = (await ask("data_health")) as DoorAnswer;
  const a = r.answers as Record<string, unknown>;
  assert.equal(a.checks, 1);
  assert.equal((a.counts as Record<string, number>).green, 1);
});

test("data_health takes no parameters and says so", async () => {
  const r = await ask("data_health", { client: "tyson" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /does not take client/);
});

test("define quotes every stored meaning when asked for everything", async () => {
  const r = (await ask("define")) as DoorAnswer;
  const a = r.answers as { count: number };
  assert.equal(a.count, DEFINITIONS.length);
});

test("define refuses a number this system does not define", async () => {
  const db = fakeDb({ question_door_definitions: [] }).db;
  const r = await askQuestion({ question_key: "define", params: { metric: "profit" } }, { db, ...OPTS });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /not a number this system defines/);
});

test("ad_setup needs a keyword or an ad id", async () => {
  const r = await ask("ad_setup", { client: "tyson" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /keyword or ad_id/);
});

test("change_history refuses a level it does not know", async () => {
  const r = await ask("change_history", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    level: "creative",
  });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /level must be one of/);
});

test("change_history refuses a limit outside its stated range", async () => {
  const r = await ask("change_history", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    limit: 99999,
  });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /whole number between/);
});

// ── The door itself ─────────────────────────────────────────────────────

test("a template that throws is reported as a refusal, never as a number", async () => {
  const brokenDb = {
    rpc() {
      return Promise.resolve({ data: null, error: { message: "the database said no" } });
    },
    from() {
      const chain = {
        select: () => chain,
        eq: () => chain,
        order: () => chain,
        maybeSingle: () => Promise.resolve({ data: { value: DATA_VERSION }, error: null }),
      };
      return chain;
    },
  } as unknown as Db;
  const r = await askQuestion({ question_key: "data_health", params: {} }, { db: brokenDb, ...OPTS });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /no number is being returned/);
});

// ─────────────────────────────────────────────────────────────────────────
// BRICK 2: THE RECEIPT.
//
// The laws this section pins:
//   6.  Every answer carries a receipt, and every MONEY answer's receipt
//       carries a coverage block whose four buckets sum EXACTLY to its totals.
//   7.  A creator named by any declared alias is answered, not refused.
//   8.  Every refusal is written to the miss log, and the refusal itself is
//       never changed by whether that write succeeded.
//   9.  A source past its threshold is named on the answer, in writing.
//   10. A window ending inside the sales lag says so, without being asked.
// ─────────────────────────────────────────────────────────────────────────

const receiptOf = (r: DoorAnswer) => r.receipt;

test("every answer carries a receipt, and a money answer's coverage block sums exactly", async () => {
  const r = (await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
  })) as DoorAnswer;
  assert.ok(!isRefusal(r));
  const rec = receiptOf(r);
  assert.equal(rec.contract_version, 2);
  assert.equal(rec.question_key, "metric_value");
  assert.equal(rec.question_version, 1);
  assert.equal(rec.caller, "test");
  assert.deepEqual(rec.window, { from: "2026-07-28", to: "2026-07-28", kind: "saved_window" });
  assert.equal(rec.data_version, DATA_VERSION);

  // LAW 6, the invariant that makes coverage impossible to fudge.
  const c = rec.coverage;
  assert.ok(c, "a money answer must carry a coverage block");
  const b = c.buckets;
  assert.equal(
    b.ad.wins + b.organic.wins + b.misc_chat.wins + b.awaiting_review.wins,
    c.window_wins_total,
    "the four buckets must account for every win, with none left over",
  );
  assert.equal(
    b.ad.cash_usd_cents + b.organic.cash_usd_cents + b.misc_chat.cash_usd_cents + b.awaiting_review.cash_usd_cents,
    c.window_cash_usd_cents_total,
    "the four buckets must account for every cent",
  );
  assert.equal(c.classified_pct_wins, 94.7); // 18 of 19
  assert.equal(c.classified_pct_cash, 93.2); // 2,729,500 of 2,929,400
  assert.match(c.note, /only bucket that counts as a gap/);
});

test("the gap is stated as a caveat, not just left sitting in a number", async () => {
  const r = (await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
  })) as DoorAnswer;
  const rec = receiptOf(r);
  // The unassigned win is in the block AND said out loud, so a reader who
  // skims the numbers still cannot come away believing coverage was complete.
  assert.match(rec.coverage!.note, /carry no creator at all/);
  assert.ok(
    rec.caveats.some((c) => /awaiting review/i.test(c) && /not a claim of full coverage/.test(c)),
    `the awaiting-review gap must appear in the caveats: ${JSON.stringify(rec.caveats)}`,
  );
});

test("a question that touches no sale row carries no coverage block, and says nothing about coverage", async () => {
  const r = (await ask("define")) as DoorAnswer;
  const rec = receiptOf(r);
  assert.equal(rec.coverage, null);
  assert.equal(rec.window, null);
});

// ── Law 7: every declared alias resolves to the one canonical creator ─────

test("a creator asked for by any declared alias is answered, and the receipt shows the hop", async () => {
  for (const given of ["jake_divljak", "Jake Divijak", "rrf"]) {
    const r = (await ask("metric_value", {
      client: given,
      date_from: "2026-07-28",
      date_to: "2026-07-28",
    })) as DoorAnswer;
    assert.ok(!isRefusal(r), `${given} should have resolved to jake, not been refused`);
    const rec = receiptOf(r);
    assert.equal(rec.params_as_resolved.client, "jake", `${given} must resolve to jake`);
    assert.deepEqual(
      rec.aliases_resolved,
      [{ given: given.toLowerCase(), resolved_to: "jake" }],
      `${given} must be recorded as a resolved alias`,
    );
  }
});

test("a name already canonical is not reported as an alias that was resolved", async () => {
  const r = (await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
  })) as DoorAnswer;
  assert.deepEqual(receiptOf(r).aliases_resolved, []);
});

test("a former creator is refused BY NAME once the registry has identified them", async () => {
  const r = await ask("metric_value", { client: "keith", date_from: "2026-07-28", date_to: "2026-07-28" });
  assert.ok(isRefusal(r));
  // The refusal names who they are, rather than claiming the word is unknown.
  assert.match(r.reason, /is keith, who is not on the active roster/);
});

test("a name the registry has never heard of is still refused, never repaired by guessing", async () => {
  const r = await ask("metric_value", { client: "tysonn", date_from: "2026-07-28", date_to: "2026-07-28" });
  assert.ok(isRefusal(r));
  assert.match(r.reason, /not a creator this door serves/);
  assert.match(r.reason, /not a spelling problem/);
});

// ── Law 8: every refusal lands in the miss log ───────────────────────────

test("a refused question is written to the miss log, with the caller", async () => {
  const { db, calls } = fakeDb();
  const r = await askQuestion(
    { question_key: "what is our roas", params: { client: "tyson" } },
    { db, ...OPTS, caller: "utari" },
  );
  assert.ok(isRefusal(r));
  // The refusal itself is unchanged: same shape, same list, same nearest.
  assert.deepEqual(r.allowed_questions, [...QUESTION_KEYS]);

  const missed = calls.inserts.filter((i) => i.table === "door_miss_log");
  assert.equal(missed.length, 1);
  assert.equal(missed[0].row.asked, "what is our roas");
  assert.equal(missed[0].row.caller, "utari");
  assert.match(String(missed[0].row.reason), /not on the list/);
  assert.deepEqual(missed[0].row.params, { client: "tyson" });
});

test("an answered question is written to the ask log", async () => {
  const { db, calls } = fakeDb();
  const r = await askQuestion(
    { question_key: "define", params: {} },
    { db, ...OPTS, caller: "app" },
  );
  assert.ok(!isRefusal(r));
  const asks = calls.inserts.filter((i) => i.table === "door_ask_log");
  assert.equal(asks.length, 1);
  assert.equal(asks[0].row.question_key, "define");
  assert.equal(asks[0].row.caller, "app");
  assert.equal(asks[0].row.ok, true);
  assert.ok(typeof asks[0].row.ms === "number");
});

test("a logging failure never costs the caller their answer or their refusal", async () => {
  // The insert throws SYNCHRONOUSLY here, which is the case a bare .catch()
  // on the returned promise would miss entirely.
  const { db } = fakeDb({}, { breakInserts: true });
  const answered = await askQuestion({ question_key: "define", params: {} }, { db, ...OPTS });
  assert.ok(!isRefusal(answered), "a broken log must not break a good answer");
  const refused = await askQuestion({ question_key: "nonsense", params: {} }, { db, ...OPTS });
  assert.ok(isRefusal(refused), "a broken log must not break an honest refusal");
  assert.match(refused.reason, /not on the list/);
});

test("the caller defaults to unknown rather than to a guess", async () => {
  const r = (await askQuestion({ question_key: "define", params: {} }, { db: fakeDb().db, ...OPTS })) as DoorAnswer;
  assert.equal(receiptOf(r).caller, "unknown");
});

// ── Law 9: a source past its threshold is named on the answer ────────────

test("a source past its threshold is named in the receipt and in the caveats", async () => {
  resetReceiptCaches();
  const { db } = fakeDb({}, {
    tables: {
      // The same source, with the threshold shrunk to an hour. The saved
      // answer in this fixture was written 3.6 hours before "now".
      door_freshness_thresholds: [
        { source: "warehouse.answers", threshold_hours: 1, note: "shrunk for this test" },
      ],
    },
  });
  const r = (await askQuestion(
    { question_key: "metric_value", params: { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-28" } },
    { db, ...OPTS },
  )) as DoorAnswer;
  const rec = receiptOf(r);
  assert.equal(rec.stale.length, 1);
  assert.equal(rec.stale[0].source, "warehouse.answers");
  assert.equal(rec.stale[0].threshold_hours, 1);
  assert.match(rec.stale[0].note, /past its 1 hour threshold/);
  assert.ok(rec.caveats.includes(rec.stale[0].note), "a stale source must also be said out loud");
  resetReceiptCaches();
});

test("a source inside its threshold is not flagged", async () => {
  resetReceiptCaches();
  const r = (await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
  })) as DoorAnswer;
  assert.deepEqual(receiptOf(r).stale, []);
  resetReceiptCaches();
});

// ── Law 10: the sales lag caveat lands without being asked for ───────────

test("a window ending inside the sales lag carries the understatement caveat", async () => {
  // "now" in these tests is 2026-07-29; the window ends 2026-07-28.
  const r = (await ask("metric_value", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
  })) as DoorAnswer;
  const rec = receiptOf(r);
  assert.ok(
    rec.caveats.some((c) => /sales_lag v1/.test(c)),
    "the signed sales_lag definition must be quoted, not paraphrased",
  );
  assert.ok(rec.caveats.some((c) => /never on its own a reason to kill an ad/.test(c)));
  assert.ok(rec.definitions_cited.some((d) => d.name === "sales_lag" && d.registry === "registry_definitions"));
});

test("asking about jake carries the AUD conversion note, because his ad account bills in AUD", async () => {
  const r = (await ask("metric_value", {
    client: "jake",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
  })) as DoorAnswer;
  const rec = receiptOf(r);
  assert.ok(rec.caveats.some((c) => /pricing_currency v1/.test(c)));
  assert.ok(rec.caveats.some((c) => /bills in AUD/.test(c) && /sale money was already USD/.test(c)));
});

test("a standing note stays on note AND appears in the caveats, so no caller loses a field", async () => {
  const r = (await ask("kill_scale_inputs", {
    client: "tyson",
    date_from: "2026-07-28",
    date_to: "2026-07-28",
    status: "all",
  })) as DoorAnswer;
  assert.match(String(r.note), /INPUTS, not a verdict/);
  assert.ok(receiptOf(r).caveats.some((c) => /INPUTS, not a verdict/.test(c)));
  // A decision read off a lagging window is directional, however exact each
  // individual number in it is.
  assert.equal(receiptOf(r).certainty, "directional");
});

// ── The declarations themselves ─────────────────────────────────────────

test("every question declares a receipt, and every money question can produce coverage", async () => {
  for (const q of QUESTIONS) {
    assert.ok(q.receipt, `${q.key} must declare a receipt`);
    assert.ok(q.receipt.version >= 1, `${q.key} needs a question version`);
    if (q.receipt.money) {
      assert.ok(
        q.receipt.windowKind,
        `${q.key} is a money question, so it must have a window to compute coverage over`,
      );
    }
  }
});

test("a money answer is REFUSED rather than shipped when its coverage cannot be read", async () => {
  // An empty coverage read is not "nothing to report": it is a read that did
  // not happen. Shipping it as null would look identical to full coverage.
  const { db } = fakeDb({ door_coverage_block: [] });
  const r = await askQuestion(
    { question_key: "metric_value", params: { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-28" } },
    { db, ...OPTS },
  );
  assert.ok(isRefusal(r));
  assert.match(r.reason, /cannot state what it covered/);
});

test("the roster comes from the registry when the caller does not supply one", async () => {
  resetReceiptCaches();
  const { db, calls } = fakeDb();
  const r = (await askQuestion(
    { question_key: "metric_value", params: { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-28" } },
    { db, now: OPTS.now },
  )) as DoorAnswer;
  assert.ok(!isRefusal(r));
  // Read from registry_entities, so no fallback caveat is present.
  assert.ok(!receiptOf(r).caveats.some((c) => /built-in list was used instead/.test(c)));
  assert.ok(calls.inserts.length > 0);
  resetReceiptCaches();
});

test("a registry the door cannot read falls back, and the answer SAYS it fell back", async () => {
  resetReceiptCaches();
  const { db } = fakeDb({}, { tables: { registry_entities: [] } });
  const r = (await askQuestion(
    { question_key: "metric_value", params: { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-28" } },
    { db, now: OPTS.now },
  )) as DoorAnswer;
  assert.ok(!isRefusal(r), "a registry outage must degrade, not refuse everything");
  assert.ok(
    receiptOf(r).caveats.some((c) => /built-in list was used instead/.test(c)),
    "an answer computed against a fallback roster must not look like a certified one",
  );
  resetReceiptCaches();
});

test("describeDoor now reports each question's version", () => {
  for (const d of describeDoor()) assert.equal(d.question_version, 1);
});

test("every answer carries quoted definitions or names why it has none, and a real as-of", async () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["metric_value", { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-28" }],
    ["yesterday_summary", { client: "tyson" }],
    ["change_history", { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-28" }],
    ["ad_setup", { client: "tyson", keyword: "fit" }],
    ["sales_cycle", { client: "tyson", date_from: "2026-06-30", date_to: "2026-07-29" }],
    ["attribution_share", { date_from: "2026-06-30", date_to: "2026-07-29" }],
    ["leak_map", { date_from: "2026-06-30", date_to: "2026-07-29" }],
    ["kill_scale_inputs", { client: "tyson", date_from: "2026-07-28", date_to: "2026-07-28", status: "all" }],
    ["data_health", {}],
    ["define", {}],
  ];
  for (const [key, params] of cases) {
    const r = (await ask(key, params)) as DoorAnswer;
    assert.ok(!isRefusal(r), `${key} should have answered`);
    assert.ok(r.as_of.length > 0, `${key} must carry an as-of`);
    assert.ok(r.sources.length > 0, `${key} must name its sources`);
    assert.equal(r.question_key, key);
  }
});
