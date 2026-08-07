// ─────────────────────────────────────────────────────────────────────────
// kill_scale_read, against a CONSTRUCTED database.
//
// THE LAWS THIS FILE PINS:
//   1. FACTS MODE IS PURE. It carries no verdict field and none of the verdict
//      vocabulary. A mode built for outside advisors must not lead the witness.
//   2. EVERY VERDICT IS LABELLED with the ruleset that produced it, and an
//      unknown ruleset is refused with the known ones listed.
//   3. WATCH MODE MAY NOT PRESCRIBE. Its output is scanned for the forbidden
//      verbs the OWNER wrote down in decision_cadence, not a list invented here.
//   4. THRESHOLDS COME FROM THE REGISTRY. With a definition missing, the answer
//      says cannot_answer and NAMES it, rather than falling back to a built-in
//      default and returning a confident number nobody signed.
// ─────────────────────────────────────────────────────────────────────────

import { test } from "node:test";
import assert from "node:assert/strict";
import { askQuestion } from "./service";
import { resetReceiptCaches } from "./receipts";
import { ZAKK_VERDICTS } from "./verdict-engine";
import { isRefusal, type DoorAnswer, type Db } from "./types";

const DATA_VERSION = 400;

/** The signed rules, in the shape registry_definitions_current returns. */
const SIGNED = [
  {
    name: "ruleset_zakk",
    version: 1,
    status: "signed",
    statement: "Ruleset zakk_v1 is the standing kill/scale lens.",
    details: {
      ruleset_key: "zakk_v1",
      components: ["verdict_floors_kill_tree", "scaling_ladder"],
      protect_min_collected_roi: 3,
      kpi_line_min_collected_roi: 2,
      cac_pct_of_ticket: 20,
      standard_ticket_price_book_key: "6mo_standard",
      expected_bookings_rounding: "nearest",
      close_rate_trailing_days: 90,
      close_rate_min_taken_calls: 20,
      cost_per_dm_baseline_days: 28,
      cost_per_dm_flag_multiple: 2,
      spend_pace_flag_pct: 25,
    },
  },
  {
    name: "verdict_floors_kill_tree",
    version: 1,
    status: "signed",
    statement: "Evidence floor, per ad: no verdict of any kind under $100 total spend on that ad.",
    details: { evidence_floor_cents: 10000, kill_requires_expected_bookings: 3 },
  },
  {
    name: "scaling_ladder",
    version: 1,
    status: "signed",
    statement: "Launch at $50/day. Steps are WEEKLY.",
    details: {
      launch_daily_cents: 5000,
      bottom_ladder_cents: [5000, 10000, 20000],
      above_threshold_cents: 20000,
      above_threshold_step_pct: [20, 33],
      budget_is_floor_at_cash_roi: 2,
      step_cadence: "weekly",
    },
  },
  {
    name: "decision_cadence",
    version: 1,
    status: "signed",
    statement: "Watch daily, decide weekly on a trailing 14 days.",
    details: {
      decide_window_days: 14,
      watch_allowed_closers: ["monitor", "queued for weekly decide"],
      watch_forbidden_verbs: ["reduce", "pause", "kill", "scale", "increase"],
    },
  },
  { name: "daily_run_rate", version: 1, status: "signed", statement: "Last-7-day pace.", details: {} },
  { name: "touch_floor_72h", version: 1, status: "signed", statement: "72 hours sustained.", details: { min_signal_age_hours: 72 } },
  {
    name: "learning_phase_awareness",
    version: 1,
    status: "signed",
    statement: "No verdict before 7 days.",
    details: { min_days_before_verdict: 7 },
  },
  { name: "structure_rules", version: 1, status: "signed", statement: "Group by adset_id and ad_id.", details: {} },
  { name: "roi_window", version: 1, status: "signed", statement: "Same window both sides.", details: {} },
  { name: "sales_lag", version: 1, status: "signed", statement: "Median 2 days, p90 13 days.", details: {} },
  { name: "unit_economics", version: 1, status: "signed", statement: "Breakeven collected ROAS about 1.35.", details: {} },
  { name: "pricing_currency", version: 1, status: "signed", statement: "Revenue reports in USD.", details: {} },
];

/** Two ads: one clear protect, one clear kill, in two ad sets. */
function leaves() {
  const base = {
    client_key: "tyson",
    campaign_id: "camp-1",
    campaign_status: "ACTIVE",
    ad_status: "ACTIVE",
    impressions: 10_000,
    clicks: 100,
    upcoming: 0,
    taken_rows: 0,
    contracted_usd_cents: 0,
  };
  return [
    {
      ...base,
      keyword: "fit",
      ad_id: "ad-fit",
      ad_name: "FIT",
      adset_id: "adset-fit",
      adset_name: "FIT - Warm Audience Stack",
      spend_cents: 152_500,
      messages: 100,
      booked: 6,
      showed_people: 5,
      taken_people: 6,
      new_clients: 5,
      collected_usd_cents: 629_900,
    },
    {
      ...base,
      keyword: "roster",
      ad_id: "ad-roster",
      ad_name: "ROSTER",
      adset_id: "adset-roster",
      adset_name: "TEST - Direct CTA - 50",
      spend_cents: 120_400,
      messages: 40,
      booked: 1,
      showed_people: 0,
      taken_people: 0,
      new_clients: 0,
      collected_usd_cents: 0,
    },
  ];
}

interface FakeOpts {
  /** Definition names to withhold, for the registry-threshold law. */
  withhold?: string[];
}

function fakeDb(opts: FakeOpts = {}): Db {
  const withheld = new Set(opts.withhold || []);
  const tables: Record<string, unknown[]> = {
    registry_entities: [{ canonical_key: "tyson" }, { canonical_key: "jake" }],
    registry_definitions_current: SIGNED.filter((d) => !withheld.has(d.name)),
    door_freshness_thresholds: [{ source: "adsv2_sale_facts", threshold_hours: 4, note: "the stamped sale facts" }],
    ad_creative_copy: [
      { ad_id: "ad-fit", client_key: "tyson", primary_text: "copy", on_image_text: "words", extracted_at: "2026-08-01T00:00:00Z" },
    ],
    adsv2_sale_facts: [
      {
        client_key: "tyson",
        keyword_normalized: "fit",
        prospect_name: "Hunter Chapman",
        sale_et_day: "2026-08-01",
        collected_usd_cents: 629_900,
        closer: "BROZ",
        is_win: true,
        is_organic: false,
        awaiting_review: false,
      },
    ],
    ads_meta_insights_daily: [],
  };

  const rpcs: Record<string, unknown[]> = {
    adsv2_window_leaves: leaves(),
    adsv2_budget_asof: [
      { entity_level: "adset", entity_id: "adset-fit", campaign_id: "camp-1", daily_usd_cents: 11_500, lifetime_usd_cents: null, holds: true, effective_status: "ACTIVE" },
      { entity_level: "adset", entity_id: "adset-roster", campaign_id: "camp-1", daily_usd_cents: 5_000, lifetime_usd_cents: null, holds: true, effective_status: "ACTIVE" },
    ],
    question_door_ad_run_dates: [
      { ad_id: "ad-fit", days_live: 30, first_active_day: "2026-07-01", last_active_day: "2026-08-06" },
      { ad_id: "ad-roster", days_live: 45, first_active_day: "2026-06-20", last_active_day: "2026-08-06" },
    ],
    question_door_definitions: ["spend", "messages", "booked", "taken", "newClients", "collected", "collectedRoi"].map(
      (key, i) => ({
        key,
        label: `Label for ${key}`,
        meaning: `The stored meaning of ${key}.`,
        source: `Where ${key} comes from.`,
        format: "int",
        is_calculated: false,
        sort_order: i,
        refreshed_at: "2026-08-06T00:00:00Z",
      }),
    ),
    question_door_freshness: [
      { source: "adsv2_sale_facts", last_written_at: "2026-08-07T05:00:00Z", note: "the stamped sale facts" },
    ],
    door_coverage_block: [
      {
        window_wins_total: 6,
        window_cash_usd_cents: 729_900,
        ad_wins: 5,
        ad_cash_usd_cents: 629_900,
        organic_wins: 0,
        organic_cash_usd_cents: 0,
        misc_chat_wins: 0,
        misc_chat_cash_usd_cents: 0,
        awaiting_wins: 1,
        awaiting_cash_usd_cents: 100_000,
        unassigned_awaiting_wins: 1,
        misc_chat_awaiting_overlap: 0,
      },
    ],
  };

  const db = {
    rpc(fn: string, args: unknown) {
      if (fn === "registry_resolve_entity") {
        const a = String((args as { p_alias?: string })?.p_alias ?? "").toLowerCase();
        return Promise.resolve({ data: ["tyson", "jake"].includes(a) ? a : null, error: null });
      }
      return Promise.resolve({ data: rpcs[fn] ?? [], error: null });
    },
    from(table: string) {
      const chain: Record<string, unknown> = {};
      const self = () => chain;
      for (const m of ["select", "eq", "in", "gte", "lte", "order", "limit", "not"]) chain[m] = self;
      chain.insert = () => Promise.resolve({ data: null, error: null });
      chain.maybeSingle = () => {
        if (table === "adsv2_meta") return Promise.resolve({ data: { value: DATA_VERSION }, error: null });
        if (table === "registry_entities") return Promise.resolve({ data: { kind: "creator" }, error: null });
        return Promise.resolve({ data: null, error: null });
      };
      chain.then = (resolve: (v: unknown) => void) => {
        if (table === "registry_entities") {
          // The economics read wants price books; the roster read wants keys.
          resolve({
            data: [
              { canonical_key: "tyson", price_book: { "3mo": 120_000, "6mo_standard": 240_000 } },
              { canonical_key: "jake", price_book: { "3mo": 120_000, "6mo_standard": 240_000 } },
            ],
            error: null,
          });
          return;
        }
        resolve({ data: tables[table] ?? [], error: null });
      };
      return chain;
    },
  } as unknown as Db;
  return db;
}

const ASK = { clients: ["tyson"] as const, caller: "test", now: new Date("2026-08-07T12:00:00Z") };

function ask(params: Record<string, unknown>, opts: { withhold?: string[] } = {}) {
  resetReceiptCaches();
  return askQuestion(
    { question_key: "kill_scale_read", params },
    { db: fakeDb(opts), clients: [...ASK.clients], caller: ASK.caller, now: ASK.now },
  );
}

/** Every string in a value, with the paths, skipping verbatim proper nouns. */
function strings(value: unknown, path = "", skipVerbatim = true): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === "string") out.push([p, v]);
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`));
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        // A name Meta assigned is a proper noun, not a word this answer chose.
        // Tyson genuinely has an ad set called "SCALE - Revived Winners", and
        // renaming it in the output would break the reconciliation to Ads
        // Manager that carrying it verbatim exists to provide.
        if (skipVerbatim && k.endsWith("_verbatim")) continue;
        walk(x, `${p}.${k}`);
      }
    }
  };
  walk(value, path);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────
// (a0) FACTS MODE PURITY.
// ─────────────────────────────────────────────────────────────────────────

test("FACTS MODE IS PURE: no verdict field, and none of the verdict vocabulary", async () => {
  const r = await ask({ client: "tyson", mode: "facts" });
  assert.ok(!isRefusal(r));
  const body = (r as DoorAnswer).answers;

  for (const [path] of strings(body, "", false)) {
    assert.ok(!/\.verdict/i.test(path), `facts mode leaked a verdict field at ${path}`);
    assert.ok(!/under_ruleset/i.test(path), `facts mode leaked a ruleset stamp at ${path}`);
  }
  const json = JSON.stringify(body);
  assert.ok(!/"verdict"/.test(json), "facts mode must carry no verdict field at all");
  assert.ok(!/"under_ruleset"/.test(json), "facts mode must not stamp a ruleset");

  // And none of the verdict WORDS, so it cannot lead the witness by vocabulary
  // either. "too_early" and the rest are this ruleset's language, not a fact.
  for (const [path, s] of strings(body)) {
    for (const v of ZAKK_VERDICTS) {
      assert.ok(
        !s.toLowerCase().includes(v.replace(/_/g, " ")) && !s.includes(v),
        `facts mode used the verdict word "${v}" at ${path}: ${s.slice(0, 120)}`,
      );
    }
  }

  // It must still be COMPLETE: an advisor has to be able to conclude anything
  // the data supports without a second query.
  const b = body as Record<string, unknown>;
  for (const key of ["economics", "ads", "ad_sets", "budget_map", "closes_named", "window", "run_rate_window"]) {
    assert.ok(b[key] !== undefined, `facts mode is missing ${key}, so it is not a complete pack`);
  }
  const ads = b.ads as Array<Record<string, unknown>>;
  assert.equal(ads.length, 2);
  for (const key of ["history", "copy_pointer", "fatigue", "daily_run_rate_usd_cents", "cost_per_call_target_usd_cents"]) {
    assert.ok(key in ads[0], `facts mode ads are missing ${key}`);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// (a1) RULESET LABELLING.
// ─────────────────────────────────────────────────────────────────────────

test("every verdict in a decide answer carries under_ruleset", async () => {
  const r = await ask({ client: "tyson", mode: "decide" });
  assert.ok(!isRefusal(r));
  const b = (r as DoorAnswer).answers as Record<string, unknown>;
  assert.equal(b.under_ruleset, "zakk_v1");
  const ads = b.ad_verdicts as Array<Record<string, unknown>>;
  const sets = b.ad_set_verdicts as Array<Record<string, unknown>>;
  assert.ok(ads.length > 0 && sets.length > 0);
  for (const v of [...ads, ...sets]) {
    assert.equal(v.under_ruleset, "zakk_v1", "a verdict without its lens reads as a fact");
    assert.ok(String(v.basis).length > 40);
  }
  // The two ads reach the two verdicts the fixtures say they should.
  const byKeyword = Object.fromEntries(ads.map((v) => [v.keyword, v.verdict]));
  assert.equal(byKeyword.fit, "protect");
  assert.equal(byKeyword.roster, "kill");
});

test("an unknown ruleset is REFUSED, and the refusal lists the ones that exist", async () => {
  const r = await ask({ client: "tyson", mode: "decide", ruleset: "nonexistent_v9" });
  assert.ok(isRefusal(r), "an unknown ruleset must not be quietly answered under another one");
  assert.match(r.reason, /nonexistent_v9/);
  assert.match(r.reason, /zakk_v1/, "the refusal must list the rulesets that do exist");
  assert.match(r.reason, /no other ruleset's rules were substituted/);
});

test("a ruleset cannot be smuggled into a mode that returns no verdicts", async () => {
  for (const mode of ["facts", "watch"]) {
    const r = await ask({ client: "tyson", mode, ruleset: "zakk_v1" });
    assert.ok(isRefusal(r), `${mode} mode must refuse a ruleset rather than ignore it`);
    assert.match(r.reason, /ruleset only applies to decide mode/);
  }
});

// ─────────────────────────────────────────────────────────────────────────
// (c) WATCH MODE MAY NOT PRESCRIBE.
// ─────────────────────────────────────────────────────────────────────────

test("WATCH MODE VERB SCAN: not one forbidden verb anywhere in the output", async () => {
  const r = await ask({ client: "tyson", mode: "watch" });
  assert.ok(!isRefusal(r));
  const answer = r as DoorAnswer;
  const body = answer.answers as Record<string, unknown>;

  // The forbidden list comes from the OWNER's signed decision_cadence details,
  // read out of the same fixture the code reads, not written again here.
  const cadence = SIGNED.find((d) => d.name === "decision_cadence")!;
  const forbidden = (cadence.details as { watch_forbidden_verbs: string[] }).watch_forbidden_verbs;
  assert.deepEqual(forbidden, ["reduce", "pause", "kill", "scale", "increase"]);

  // SCOPE: the answer BODY, which is what "watch-mode output" means. The
  // envelope carries the question's own name (kill_scale_read) and the receipt
  // quotes signed definitions verbatim (sales_lag v1 contains the word "kill"),
  // and neither is watch mode choosing to prescribe.
  for (const [path, s] of strings(body)) {
    for (const verb of forbidden) {
      assert.ok(
        !s.toLowerCase().includes(verb),
        `watch mode used the forbidden verb "${verb}" at ${path}: ${s.slice(0, 140)}`,
      );
    }
  }

  // And it must actually be flag-shaped.
  const flags = body.flags as Array<Record<string, unknown>>;
  assert.ok(Array.isArray(flags));
  const allowed = (cadence.details as { watch_allowed_closers: string[] }).watch_allowed_closers;
  for (const f of flags) {
    for (const key of ["signal", "magnitude", "duration", "since", "closer"]) {
      assert.ok(f[key] !== undefined, `a flag is missing ${key}`);
    }
    assert.ok(allowed.includes(String(f.closer)), `"${f.closer}" is not one of the two allowed closers`);
  }
  // Watch mode never carries verdicts.
  assert.equal(JSON.stringify(body).includes('"verdict"'), false);
});

test("the fatigue flag ships LABELLED as an unvalidated rule", async () => {
  const r = await ask({ client: "tyson", mode: "watch" });
  const body = (r as DoorAnswer).answers as Record<string, unknown>;
  assert.match(String(body.fatigue_rule_status), /UNVALIDATED/);
  assert.match(String(body.fatigue_rule_status), /never been backtested/);
});

// ─────────────────────────────────────────────────────────────────────────
// (e) THE REGISTRY THRESHOLD LAW.
// ─────────────────────────────────────────────────────────────────────────

test("REGISTRY THRESHOLD LAW: a missing definition means cannot_answer, naming it", async () => {
  const r = await ask({ client: "tyson", mode: "decide" }, { withhold: ["verdict_floors_kill_tree"] });
  assert.ok(!isRefusal(r), "this is an answer that declines to compute, not a malformed question");
  const answer = r as DoorAnswer;

  // The receipt is where a machine reads how much to trust this.
  assert.equal(answer.receipt.certainty, "cannot_answer");

  const body = answer.answers as Record<string, unknown>;
  assert.equal(body.answered, false);
  const ca = body.cannot_answer as { missing: string[]; why: string };
  assert.ok(ca.missing.includes("verdict_floors_kill_tree"), "the missing definition must be NAMED");
  assert.match(ca.why, /SIGNED definition/);
  assert.match(ca.why, /no numbers are being returned/);

  // The whole point: no threshold was substituted, so no verdicts and no
  // decision numbers came back at all.
  const json = JSON.stringify(body);
  assert.ok(!/"ad_verdicts"/.test(json));
  assert.ok(!/"ads"/.test(json));
});

test("a missing definition FIELD is reported as precisely as a missing definition", async () => {
  const r = await ask({ client: "tyson", mode: "decide" }, { withhold: ["learning_phase_awareness"] });
  const body = (r as DoorAnswer).answers as Record<string, unknown>;
  const ca = body.cannot_answer as { missing: string[] };
  assert.ok(ca.missing.includes("learning_phase_awareness"));
});

// ─────────────────────────────────────────────────────────────────────────
// THE REST OF THE CONTRACT.
// ─────────────────────────────────────────────────────────────────────────

test("every signed rule the answer APPLIED is cited in the receipt, with its real version", async () => {
  // Brick 2 let a question declare the rules it leaned on and then never read
  // the declaration, so eight questions named their rules and none reached a
  // receipt. Brick 3's threshold law makes that unacceptable: a verdict that
  // applies a signed threshold without citing it cannot be audited.
  for (const mode of ["facts", "decide", "watch"]) {
    const r = await ask({ client: "tyson", mode });
    const cited = (r as DoorAnswer).receipt.definitions_cited;
    const registry = cited.filter((c) => c.registry === "registry_definitions");
    const names = new Set(registry.map((c) => c.name));
    for (const needed of [
      "ruleset_zakk",
      "verdict_floors_kill_tree",
      "scaling_ladder",
      "decision_cadence",
      "touch_floor_72h",
      "learning_phase_awareness",
      "structure_rules",
      "daily_run_rate",
    ]) {
      assert.ok(names.has(needed), `${mode} mode applied ${needed} without citing it`);
    }
    // Versions are resolved from the registry, not assumed to be 1 forever.
    // A rule that is genuinely not signed is cited WITHOUT a version, which is
    // the honest thing to do, so only the signed ones are checked here.
    const signedNames = new Set(SIGNED.map((d) => d.name));
    for (const c of registry) {
      if (!signedNames.has(c.name)) continue;
      assert.equal(typeof c.version, "number", `${c.name} is signed but was cited without a version`);
    }
    // And nothing is cited twice.
    assert.equal(new Set(cited.map((c) => `${c.registry}|${c.name}`)).size, cited.length);
  }
});

test("decide mode carries a coverage block, because it is a money answer", async () => {
  const r = await ask({ client: "tyson", mode: "decide" });
  const receipt = (r as DoorAnswer).receipt;
  assert.ok(receipt.coverage, "a money answer without coverage is the exact bug Brick 2 killed");
  const b = receipt.coverage!.buckets;
  assert.equal(b.ad.wins + b.organic.wins + b.misc_chat.wins + b.awaiting_review.wins, receipt.coverage!.window_wins_total);
  assert.ok(receipt.coverage!.classified_pct_wins < 100);
});

test("the window defaults to the trailing 14 days ending yesterday, from decision_cadence", async () => {
  const r = await ask({ client: "tyson", mode: "decide" });
  const w = (r as DoorAnswer).receipt.window;
  // now is 2026-08-07, so yesterday is 2026-08-06 and 14 days back is 07-24.
  assert.deepEqual(w, { from: "2026-07-24", to: "2026-08-06", kind: "trailing_decision_window" });
});

test("an unknown mode is refused, and an unknown parameter is never silently ignored", async () => {
  const bad = await ask({ client: "tyson", mode: "guess" });
  assert.ok(isRefusal(bad));
  assert.match(bad.reason, /mode must be one of/);

  const extra = await ask({ client: "tyson", mode: "decide", limit: 5 });
  assert.ok(isRefusal(extra));
  assert.match(extra.reason, /does not take limit/);
});

test("the answer states what it excludes: keywordless ads, organic, and awaiting review", async () => {
  const r = await ask({ client: "tyson", mode: "facts" });
  const ex = (r as DoorAnswer).receipt.exclusions;
  const what = ex.map((e) => e.what).join(" | ");
  assert.match(what, /carrying no keyword/);
  assert.match(what, /organic keyword traffic and rows still awaiting review/);
});

test("nothing in any mode claims to have executed anything", async () => {
  for (const mode of ["watch", "facts", "decide"]) {
    const r = await ask({ client: "tyson", mode });
    const json = JSON.stringify((r as DoorAnswer).answers).toLowerCase();
    for (const word of ["we have paused", "budget was moved", "we killed", "applied the change"]) {
      assert.ok(!json.includes(word), `${mode} mode implied an action: ${word}`);
    }
  }
});
