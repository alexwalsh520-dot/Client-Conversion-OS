import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseImport,
  lastCompletedSaturdayWindow,
  daysUntil,
  isRetentionWindow,
} from "./validation";
import { matchReport } from "./matching";
import { canReadCoach, scopeReport } from "./access";
import type { ClientSnapshot } from "./types";

export function fixture() {
  return {
    timezone: "Asia/Karachi",
    review_date: "2026-09-12",
    coverage: { notes: ["Voice attachments not reviewed."] },
    clients: [
      {
        everfit_id: "aaaaaaaaaaaaaaaaaaaaaaaa",
        name: "Demo Client",
        everfit_owner: "Shaun Lundall",
        ccos_candidate_id: "101",
        matched_email: " DEMO@example.com ",
        match_status: "Email verified",
        linked_client_id: 999,
        summary: "Client requests a schedule adjustment.",
        next_step: "Confirm the new schedule.",
        issue: "Program follow-up",
        priority: "Follow up",
        action_owner: "Shaun",
        suggested_due: "Within 48 hours",
        end_date: "2026-09-15",
        training_7d_pct: 0,
        training_30d_pct: null,
        tasks_7d_pct: 100,
        last_app_access_display: "2h",
        activity_observed_minimum: {
          workout_log_events: 0,
          added_meal_events: 0,
          task_completion_events: 2,
          community_posts: 0,
        },
      },
    ],
  };
}
const client: ClientSnapshot = {
  id: 101,
  name: "Demo Client",
  email: "demo@example.com",
  coach_name: "Shiraad",
  program: "12 weeks",
  start_date: "2026-06-01",
  end_date: "2026-09-15",
  status: "active",
};
test("untrusted match claims and foreign keys cannot produce a verified link", () => {
  const r = parseImport(fixture(), "Shiraad");
  assert.equal(r.clients[0].linked_client_id, null);
  assert.equal(r.clients[0].match_status, "Name candidate");
  assert.equal(r.clients[0].email, "demo@example.com");
  assert.equal(r.preliminary, true);
});
test("email verification joins to the database and preserves zero vs missing", () => {
  const r = matchReport(parseImport(fixture(), "Shiraad"), [client]);
  assert.equal(r.clients[0].linked_client_id, 101);
  assert.equal(r.clients[0].training_7d_pct, 0);
  assert.equal(r.clients[0].training_30d_pct, null);
});
test("conflicting emails, duplicate emails, and a conflicting candidate do not merge", () => {
  for (const roster of [
    [{ ...client, email: "other@example.com" }],
    [client, { ...client, id: 102 }],
    [{ ...client, id: 102 }],
  ]) {
    const c = matchReport(parseImport(fixture(), "Shiraad"), roster).clients[0];
    assert.equal(c.linked_client_id, null);
    assert.equal(c.match_status, "Email conflict");
  }
});
test("duplicate Everfit clients and malformed measurements reject the complete import", () => {
  const f = fixture();
  f.clients.push(f.clients[0]);
  assert.throws(() => parseImport(f, "Shiraad"), /Duplicate/);
  const bad = fixture();
  bad.clients[0].training_7d_pct = -1;
  assert.throws(() => parseImport(bad, "Shiraad"), /Percentages/);
  assert.throws(
    () => parseImport({ ...fixture(), review_date: "2026-02-30" }, "Shiraad"),
    /date/,
  );
});
test("explicit timestamp window validates duration and cannot cover the future", () => {
  const report = {
    ...fixture(),
    window_start: "2026-08-01T18:00:00+05:00",
    window_end: "2026-08-08T18:00:00+05:00",
    preliminary: false,
  };
  assert.equal(parseImport(report, "Shiraad").preliminary, false);
  assert.throws(
    () =>
      parseImport(
        { ...report, window_end: "2026-08-07T18:00:00+05:00" },
        "Shiraad",
      ),
    /seven days/,
  );
  assert.throws(
    () => parseImport({ ...report, window_end: null }, "Shiraad"),
    /Both/,
  );
});
test("retention includes both ten-day boundaries and excludes older expirations", () => {
  for (const d of [-10, -1, 0, 1, 10]) assert.equal(isRetentionWindow(d), true);
  for (const d of [-11, 11, null]) assert.equal(isRetentionWindow(d), false);
});
test("Saturday 18:00 PKT is the exact report closing boundary", () => {
  assert.equal(
    lastCompletedSaturdayWindow(new Date("2026-09-12T12:59:59Z")).end,
    "2026-09-05T13:00:00.000Z",
  );
  assert.deepEqual(
    lastCompletedSaturdayWindow(new Date("2026-09-12T13:00:00Z")),
    { start: "2026-09-05T13:00:00.000Z", end: "2026-09-12T13:00:00.000Z" },
  );
  assert.equal(daysUntil("2026-09-15", "2026-09-12"), 3);
  assert.equal(daysUntil(null, "2026-09-12"), null);
});
test("coach access does not grant access to other coaches or transferred clients", () => {
  const access = {
    admin: false,
    email: "coach@example.com",
    coaches: ["Shiraad"],
  };
  assert.equal(canReadCoach(access, "Stef"), false);
  const r = matchReport(parseImport(fixture(), "Shiraad"), [client]);
  assert.equal(scopeReport(r, access, [client]).clients.length, 1);
  assert.equal(
    scopeReport(r, access, [{ ...client, coach_name: "Stef" }]).clients.length,
    0,
  );
  assert.equal(scopeReport(r, access, []).clients.length, 0);
  r.clients[0].everfit_owner = "Ahmad Saeed";
  assert.equal(scopeReport(r, access, [client]).clients.length, 0);
  assert.equal(
    scopeReport(r, { ...access, admin: true }, [client]).clients.length,
    1,
  );
});
