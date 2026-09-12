const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { JSDOM } = require("jsdom");
const vm = require("node:vm");
function setup(html) {
  const dom = new JSDOM(html);
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, "innerText", {
    get() {
      return this.textContent;
    },
  });
  w.HTMLElement.prototype.getClientRects = () => [{}];
  const context = {
    document: w.document,
    getComputedStyle: w.getComputedStyle.bind(w),
    module: { exports: {} },
    chrome: {
      runtime: {
        onMessage: { addListener() {} },
        getURL: (p) => "chrome-extension://test/" + p,
        id: "test",
      },
    },
    Date,
    setTimeout,
  };
  vm.runInNewContext(
    readFileSync(__dirname + "/collector.js", "utf8"),
    context,
  );
  return { dom, exports: context.module.exports };
}
test("sender direction is read from row alignment and stable IDs are preserved", () => {
  const { dom, exports } = setup(
    `<div id="chat"><div>Friday, 11 Sep 2026</div><div id="coach-1" style="align-items:flex-end"><div><div id="content-coach-1">How was training?</div></div><div data-for="message-time1">09:00 AM</div></div><div id="client-1" style="align-items:flex-start"><div><div id="content-client-1">It went well</div></div></div><div>Today</div><div id="unknown-1"><div><div id="content-unknown-1"><audio></audio></div></div></div></div>`,
  );
  const rows = exports.messageRows(dom.window.document.querySelector("#chat"));
  assert.equal(rows.length, 3);
  assert.equal(rows[0].sender, "coach");
  assert.equal(rows[1].sender, "client");
  assert.equal(rows[2].sender, "unknown");
  assert.equal(rows[1].date, "Friday, 11 Sep 2026");
  assert.equal(rows[2].date, "Today");
  assert.equal(rows[2].attachments, true);
});
test("roster parser does not turn missing activity into zero or include unrelated links", () => {
  const { exports } = setup(
    `<div class="table__row"><a class="name-client" href="/home/client/${"a".repeat(24)}?segment=example">Example Client</a><div class="trainer_name">Shaun Lundall</div><div class="training_completed_percent">80% 4/5</div><div class="training_completed_percent">--</div><div class="training_completed_percent">0%</div><div class="last_activity">2d</div></div><div class="table__row"><a href="/elsewhere">Other</a></div>`,
  );
  const rows = exports.rosterRows();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].training7, 80);
  assert.equal(rows[0].training30, null);
  assert.equal(rows[0].tasks7, 0);
  assert.equal(rows[0].owner, "Shaun Lundall");
});
test("manifest limits site access and has no cookie or all-sites permission", () => {
  const m = JSON.parse(readFileSync(__dirname + "/manifest.json", "utf8"));
  assert.deepEqual(m.host_permissions, [
    "https://app.everfit.io/*",
    "https://client-conversion-os.vercel.app/*",
  ]);
  assert.deepEqual(m.permissions, ["storage"]);
});
