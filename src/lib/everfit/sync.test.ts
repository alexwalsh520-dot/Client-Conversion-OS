import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCapture, parseSyncPlan } from "./sync-validation";
import { everfitCoach } from "./owners";
import { scopeReport } from "./access";
import { fixture } from "./everfit.test";
import { parseImport } from "./validation";
const client = {
  id: "a".repeat(24),
  name: "Example Client",
  owner: "Shaun Lundall",
  training7: 80,
  training30: null,
  tasks7: 0,
  lastAccess: "2h",
};
const capture = {
  id: client.id,
  owner: client.owner,
  email: " Example@invalid.test ",
  capturedAt: new Date().toISOString(),
  messages: [
    {
      id: "one",
      date: "Today",
      time: "10:00 AM",
      sender: "client",
      text: "Hello",
      attachments: false,
    },
  ],
  updates: [],
  notes: [],
  historyComplete: false,
};
test("sync plan rejects duplicate identities and impossible metrics", () => {
  assert.equal(parseSyncPlan([client])[0].tasks7, 0);
  assert.throws(() => parseSyncPlan([client, client]));
  assert.throws(() => parseSyncPlan([{ ...client, training7: 101 }]));
  assert.throws(() => parseSyncPlan([{ ...client, id: "not-a-client" }]));
});
test("capture preserves evidence gaps and rejects duplicate messages and stale timestamps", () => {
  const parsed = parseCapture(capture);
  assert.equal(parsed.email, "example@invalid.test");
  assert.equal(parsed.historyComplete, false);
  assert.throws(() =>
    parseCapture({
      ...capture,
      messages: [capture.messages[0], capture.messages[0]],
    }),
  );
  assert.throws(() =>
    parseCapture({ ...capture, capturedAt: "2020-01-01T00:00:00Z" }),
  );
  assert.throws(() =>
    parseCapture({
      ...capture,
      messages: [{ ...capture.messages[0], sender: "system" }],
    }),
  );
});
test("coach mapping is exact and distinct accounts are not merged by a first name", () => {
  assert.equal(everfitCoach("Shaun Lundall"), "Shiraad");
  assert.equal(everfitCoach("Shiraad Lundall"), null);
  assert.equal(everfitCoach("Mark Smith"), "Farrukh");
  assert.equal(everfitCoach("Mark Jones"), null);
});
test("full Everfit owner names are visible only in their authorized coach view", () => {
  const value = fixture();
  value.clients[0].everfit_owner = "Waleed Ahmed";
  const doc = parseImport(value, "Waleed");
  assert.equal(
    scopeReport(
      doc,
      { email: "test@example.com", admin: false, coaches: ["Waleed"] },
      [],
    ).clients.length,
    1,
  );
  assert.throws(() =>
    scopeReport(
      doc,
      { email: "test@example.com", admin: false, coaches: ["Stef"] },
      [],
    ),
  );
});
