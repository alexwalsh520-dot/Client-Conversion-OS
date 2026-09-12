// Reads the rendered Everfit UI only. No cookies, private APIs, or message composer access.
(() => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const text = (el) => el?.innerText?.trim() || "";
  const visible = (el) => !!el?.getClientRects().length;
  async function wait(read, description, timeout = 25000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const value = read();
      if (value) return value;
      await sleep(350);
    }
    throw new Error(description);
  }
  const exact = (selector, label) =>
    [...document.querySelectorAll(selector)].find(
      (el) => visible(el) && text(el) === label,
    );
  const percent = (el) => {
    const m = text(el).match(/(\d+(?:\.\d+)?)%/);
    return m ? Number(m[1]) : null;
  };
  function rosterRows() {
    return [...document.querySelectorAll(".table__row")].flatMap((row) => {
      const a = row.querySelector("a.name-client"),
        m = a?.getAttribute("href")?.match(/\/home\/client\/([a-f0-9]{24})/);
      if (!m) return [];
      const metrics = row.querySelectorAll(".training_completed_percent");
      return [
        {
          id: m[1],
          name: text(a),
          owner: text(row.querySelector(".trainer_name")),
          training7: percent(metrics[0]),
          training30: percent(metrics[1]),
          tasks7: percent(metrics[2]),
          lastAccess: text(row.querySelector(".last_activity")) || null,
        },
      ];
    });
  }
  async function roster() {
    const team = await wait(
      () => exact("div,span,p", "Your Entire Team"),
      "Open Everfit and sign in to the team account.",
    );
    team.click();
    await wait(
      () =>
        /Your Entire Team\s*\(\d+\)/.test(document.body.innerText) &&
        rosterRows().length,
      "Entire team roster did not load.",
    );
    const count = Number(
      document.body.innerText.match(/Your Entire Team\s*\((\d+)\)/)?.[1],
    );
    if (!count || count > 2000)
      throw new Error("Unexpected team count. Sync stopped.");
    const collected = new Map();
    for (let page = 0; page < 150; page++) {
      const rows = rosterRows();
      for (const row of rows) {
        if (!row.owner) throw new Error("Everfit owner missing.");
        collected.set(row.id, row);
      }
      const next = document.querySelector("button.next");
      if (!next)
        throw new Error("Everfit pagination changed. Sync needs an update.");
      if (next.disabled || next.getAttribute("aria-disabled") === "true") break;
      const first = rows[0]?.id;
      next.click();
      await wait(
        () => rosterRows()[0]?.id !== first && rosterRows().length,
        "Next roster page did not load.",
      );
    }
    if (collected.size !== count)
      throw new Error(
        `Roster incomplete: found ${collected.size} of ${count}. Nothing will be reported as a full sync.`,
      );
    return [...collected.values()].sort((a,b) => Number(b.owner === "Shaun Lundall") - Number(a.owner === "Shaun Lundall") || a.owner.localeCompare(b.owner) || a.name.localeCompare(b.name));
  }
  function updateRows() {
    return [
      ...document.querySelectorAll(".update-panel .panel-body li.panel-item"),
    ]
      .map((el) => ({
        text: text(el.querySelector(".message")),
        age: text(el.querySelector(".time")),
      }))
      .filter((u) => u.text);
  }
  async function profile(client) {
    await wait(
      () =>
        location.pathname.includes("/client/" + client.id) &&
        document.querySelector('a[href^="mailto:"]'),
      "Client profile or email is unavailable.",
    );
    const ownerMatch = document.body.innerText.match(/Owner:\s*([^\n]+)/);
    const owner = ownerMatch?.[1]?.trim();
    if (owner !== client.owner)
      throw new Error("Profile owner changed or could not be verified.");
    const email = document
      .querySelector('a[href^="mailto:"]')
      .getAttribute("href")
      .slice(7)
      .split("?")[0]
      .trim();
    const panel = await wait(
      () => document.querySelector(".update-panel .panel-body"),
      "Recent activity panel is unavailable.",
    );
    let stable = 0,
      previous = "",
      updates = [];
    for (let i = 0; i < 100; i++) {
      updates = updateRows();
      const oldest = updates.at(-1)?.age || "";
      if (
        /\b([2-9]\d*\s*w|\d+\s*mo|\d+\s*y)\b/.test(oldest) ||
        /^(?:[89]|[1-9]\d+)d$/.test(oldest)
      )
        break;
      const signature = JSON.stringify(updates);
      stable = signature === previous ? stable + 1 : 0;
      if (stable >= 3) break;
      previous = signature;
      panel.scrollTop = panel.scrollHeight;
      await sleep(900);
    }
    return {
      email,
      owner,
      updates,
      notes: [
        "Recent activity uses relative labels. Counts exclude ambiguous week-old entries and are observed minimums.",
      ],
    };
  }
  function coachControl() {
    return [...document.querySelectorAll(".evfSelectBox__control")].find(
      (el) => visible(el) && el.querySelector("input[readonly]"),
    );
  }
  function selectedCoach() {
    return text(coachControl()?.querySelector("p"));
  }
  function room(id) {
    return [...document.querySelectorAll(".inbox-item")].find((el) =>
      [...el.querySelectorAll('[data-for^="room-action-tooltip-"]')].some(
        (node) =>
          node
            .getAttribute("data-for")
            .slice("room-action-tooltip-".length)
            .split("_")
            .includes(id),
      ),
    );
  }
  function scrollerFor(el) {
    let parent = el?.parentElement;
    while (parent && parent !== document.body) {
      const s = getComputedStyle(parent);
      if (
        /auto|scroll/.test(s.overflowY) &&
        parent.scrollHeight > parent.clientHeight
      )
        return parent;
      parent = parent.parentElement;
    }
    return null;
  }
  function messageRows(container) {
    const bubbles = [...container.querySelectorAll('[id^="content-"]')];
    const result = [];
    for (const bubble of bubbles) {
      const row =
        bubble.closest("[id]") === bubble
          ? bubble.parentElement?.parentElement
          : null;
      if (!row?.id) continue;
      let date = "",
        previous = row.previousElementSibling;
      while (previous) {
        if (
          !previous.querySelector('[id^="content-"]') &&
          /^(Today|Yesterday|(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday),)/.test(
            text(previous),
          )
        ) {
          date = text(previous);
          break;
        }
        previous = previous.previousElementSibling;
      }
      const align = getComputedStyle(row).alignItems;
      result.push({
        id: row.id,
        date,
        time: text(row.querySelector('[data-for^="message-time"]')),
        sender:
          align === "flex-end"
            ? "coach"
            : align === "flex-start"
              ? "client"
              : "unknown",
        text: text(bubble),
        attachments:
          !!bubble.querySelector("audio,video,img,canvas") || !text(bubble),
      });
    }
    return result;
  }
  async function conversation(client) {
    const control = await wait(coachControl, "Everfit inbox did not load.");
    if (selectedCoach() !== client.owner) {
      control.click();
      const option = await wait(
        () => exact('[class*="option"] p,[class*="option"],p', client.owner),
        "This coach inbox is unavailable.",
      );
      option.click();
      await wait(
        () => selectedCoach() === client.owner,
        "Coach switch was not confirmed.",
      );
      await sleep(800);
    }
    let target = room(client.id);
    const list = scrollerFor(document.querySelector(".inbox-item"));
    if (!target && list) {
      list.scrollTop = 0;
      await sleep(700);
      for (let i = 0; i < 150 && !target; i++) {
        target = room(client.id);
        if (target) break;
        const before = list.scrollTop;
        list.scrollTop += Math.max(300, list.clientHeight - 50);
        await sleep(800);
        if (list.scrollTop === before) {
          await sleep(900);
          target = room(client.id);
          break;
        }
      }
    }
    if (!target)
      throw new Error(
        "Client was not found in the selected coach inbox; no empty-conversation claim was made.",
      );
    target.click();
    const container = await wait(
      () =>
        selectedCoach() === client.owner &&
        location.pathname === "/home/inbox/" + client.id &&
        document.getElementById("detail-content-" + client.id),
      "Conversation identity could not be verified.",
    );
    await sleep(700);
    const messages = new Map();
    let stable = 0,
      previous = "",
      boundary = false;
    // Collect until a date safely before the trailing week. Older saved captures stay in CCOS.
    const cutoff = Number.isFinite(Date.parse(client.historySince)) ? Date.parse(client.historySince) : Date.now() - 9 * 86400000;
    for (let i = 0; i < 150; i++) {
      if (
        selectedCoach() !== client.owner ||
        location.pathname !== "/home/inbox/" + client.id
      )
        throw new Error("Everfit page changed during capture.");
      const rows = messageRows(container);
      for (const m of rows) messages.set(m.id, m);
      boundary = rows.some(
        (m) =>
          /^\w+,/.test(m.date) &&
          Number.isFinite(Date.parse(m.date)) &&
          Date.parse(m.date) < cutoff,
      );
      if (boundary) break;
      const signature = rows.map((m) => m.id).join(",");
      stable = signature === previous ? stable + 1 : 0;
      if (stable >= 4) break;
      previous = signature;
      container.scrollTop = 0;
      await sleep(1000);
      if (messages.size > 3500) break;
    }
    if (!messages.size)
      throw new Error(
        "No readable messages found; conversation completeness cannot be verified.",
      );
    return {
      messages: [...messages.values()].sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
      historyComplete: boundary,
      notes: [
        boundary
          ? "Captured messages reach before the weekly review window."
          : "Start of history could not be verified; do not conclude no retention outreach.",
        "Everfit display dates may use the viewer or client timezone; attachments were not transcribed.",
      ],
    };
  }
  if (typeof module !== "undefined")
    module.exports = { messageRows, rosterRows, roster };
  let busy = false;
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (
      sender.id !== chrome.runtime.id ||
      !sender.url?.startsWith(chrome.runtime.getURL("runner.html")) ||
      message.type !== "EVERFIT_READ"
    )
      return;
    if (busy) {
      reply({ error: "Everfit reader is busy." });
      return;
    }
    if (!["roster", "profile", "conversation", "ping"].includes(message.action))
      return;
    busy = true;
    (async () => {
      if (message.action === "ping") return { ready: true };
      if (message.action === "roster") return { plan: await roster() };
      if (
        !/^[a-f0-9]{24}$/.test(message.client?.id) ||
        typeof message.client?.owner !== "string"
      )
        throw new Error("Invalid client identity.");
      return message.action === "profile"
        ? await profile(message.client)
        : await conversation(message.client);
    })()
      .then((value) => reply({ ok: true, ...value }))
      .catch((e) => reply({ error: e.message }))
      .finally(() => {
        busy = false;
      });
    return true;
  });
})();
