import { test } from "node:test";
import assert from "node:assert/strict";
import { runAccuracyChecks } from "./run";
import type { AccuracyCheck, Db } from "./types";

// ─────────────────────────────────────────────────────────────────────────
// ISOLATION is the law this file pins: one broken check must never stop the
// others running, and must never stop the run being recorded. Everything here
// uses a fake database and constructed checks; no real data is touched.
// ─────────────────────────────────────────────────────────────────────────

interface Recorded {
  rpcCalls: Array<{ fn: string; args: unknown }>;
  alerts: unknown[];
}

function fakeDb(): { db: Db; recorded: Recorded } {
  const recorded: Recorded = { rpcCalls: [], alerts: [] };
  const db = {
    rpc(fn: string, args: unknown) {
      recorded.rpcCalls.push({ fn, args });
      const rows = (args as { p_rows?: unknown[] })?.p_rows;
      return Promise.resolve({ data: Array.isArray(rows) ? rows.length : 0, error: null });
    },
    from(table: string) {
      return {
        insert() {
          return {
            select() {
              return { maybeSingle: () => Promise.resolve({ data: { id: "sync-run-1" }, error: null }) };
            },
          };
        },
        update() {
          return { eq: () => Promise.resolve({ data: null, error: null }) };
        },
        upsert(rows: unknown) {
          if (table === "adsv2_alerts") recorded.alerts.push(rows);
          return Promise.resolve({ data: null, error: null });
        },
      };
    },
  };
  // The real client can be pointed at a different schema and hands back the same
  // query surface. The Semantic Layer consolidation moved adsv2_alerts into the
  // warehouse schema, so production now says .schema("warehouse").from(...).
  // The fake has to model that, or it has stopped modelling the client.
  (db as unknown as { schema: () => unknown }).schema = () => db;
  return { db: db as unknown as Db, recorded };
}

function check(key: string, behaviour: "green" | "red" | "throw" | "hang"): AccuracyCheck {
  return {
    key,
    name: `check ${key}`,
    toleranceNote: "constructed for the test",
    budgetMs: behaviour === "hang" ? 50 : 5_000,
    async run() {
      if (behaviour === "throw") throw new Error("this check is deliberately broken");
      if (behaviour === "hang") await new Promise(() => {});
      return {
        status: behaviour === "red" ? ("red" as const) : ("green" as const),
        leftValue: "1",
        rightValue: behaviour === "red" ? "2" : "1",
      };
    },
  };
}

test("a check that throws becomes its own error row and the others still run", async () => {
  const { db } = fakeDb();
  const result = await runAccuracyChecks(new Date("2026-07-26T12:00:00Z"), {
    db,
    clients: ["tyson"],
    checks: [check("before", "green"), check("broken", "throw"), check("after", "green")],
  });

  assert.equal(result.rows.length, 3, "every check produced a row");
  assert.equal(result.rows.find((r) => r.check_key === "broken")?.status, "error");
  assert.equal(result.rows.find((r) => r.check_key === "before")?.status, "green");
  assert.equal(result.rows.find((r) => r.check_key === "after")?.status, "green");
  assert.equal(result.counts.error, 1);
  assert.equal(result.counts.green, 2);
  assert.equal(result.recorded, 3, "the whole run was still recorded");
});

test("a check that hangs is abandoned at its budget and does not take the run down", async () => {
  const { db } = fakeDb();
  const result = await runAccuracyChecks(new Date("2026-07-26T12:00:00Z"), {
    db,
    clients: ["tyson"],
    checks: [check("hangs", "hang"), check("after", "green")],
  });

  const hung = result.rows.find((r) => r.check_key === "hangs");
  assert.equal(hung?.status, "error");
  assert.match(String(hung?.left_value), /budget/);
  assert.equal(result.rows.find((r) => r.check_key === "after")?.status, "green");
  assert.equal(result.recorded, 2);
});

test("an errored check carries plain-English words about what it means", async () => {
  const { db } = fakeDb();
  const result = await runAccuracyChecks(new Date("2026-07-26T12:00:00Z"), {
    db,
    clients: ["tyson"],
    checks: [check("broken", "throw")],
  });
  assert.match(String(result.rows[0].what_to_do), /proved nothing today/);
});

test("red and errored checks raise an alert; green ones do not", async () => {
  const { db, recorded } = fakeDb();
  await runAccuracyChecks(new Date("2026-07-26T12:00:00Z"), {
    db,
    clients: ["tyson"],
    checks: [check("fine", "green"), check("bad", "red"), check("broken", "throw")],
  });
  const raised = recorded.alerts.flat() as Array<{ dedupe_key: string }>;
  assert.equal(raised.length, 2);
  assert.ok(raised.some((a) => a.dedupe_key.includes("bad")));
  assert.ok(raised.some((a) => a.dedupe_key.includes("broken")));
  assert.ok(!raised.some((a) => a.dedupe_key.includes("fine")));
});

test("every row carries the run id, the day, and its written tolerance", async () => {
  const { db } = fakeDb();
  const result = await runAccuracyChecks(new Date("2026-07-26T12:00:00Z"), {
    db,
    clients: ["tyson"],
    checks: [check("one", "green"), check("two", "green")],
  });
  for (const row of result.rows) {
    assert.equal(row.run_id, result.runId);
    assert.equal(row.et_day, "2026-07-26");
    assert.equal(row.tolerance_note, "constructed for the test");
  }
});

test("if recording fails the run still returns its findings instead of vanishing", async () => {
  const { db } = fakeDb();
  const broken = {
    ...(db as unknown as Record<string, unknown>),
    rpc: () => Promise.resolve({ data: null, error: { message: "database is down" } }),
  } as unknown as Db;
  const result = await runAccuracyChecks(new Date("2026-07-26T12:00:00Z"), {
    db: broken,
    clients: ["tyson"],
    checks: [check("one", "red")],
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].status, "red");
  assert.equal(result.recorded, 0);
});
