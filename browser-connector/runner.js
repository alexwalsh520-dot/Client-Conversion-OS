const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let workerId;
async function job() {
  return (await chrome.storage.session.get("job")).job;
}
async function update(values) {
  const next = { ...(await job()), ...values };
  await chrome.storage.session.set({ job: next });
  render(next);
}
function render(state) {
  document.querySelector("#message").textContent = state.message || "";
  document.querySelector("#progress").max = state.total || 1;
  document.querySelector("#progress").value = state.done || 0;
  document.querySelector("#counts").textContent = state.total
    ? `${state.done} of ${state.total} clients saved · ${state.failed || 0} need attention`
    : "";
  document.querySelector("h1").textContent =
    state.status === "completed"
      ? "Sync complete"
      : state.status === "partial"
        ? "Sync needs attention"
        : state.status === "interrupted"
          ? "Sync interrupted"
          : "Sync in progress";
  document.querySelector("#cancel").disabled = ![
    "running",
    "starting",
  ].includes(state.status);
}
document
  .querySelector("#cancel")
  .addEventListener("click", () =>
    update({
      cancelRequested: true,
      message: "Stopping after the current client…",
    }),
  );
async function api(body) {
  const state = await job();
  const response = await chrome.tabs.sendMessage(state.ccosTab, {
    type: "CCOS_API",
    body,
  });
  if (!response?.ok)
    throw new Error(
      response?.error || "CCOS did not respond. Keep it open and signed in.",
    );
  return response;
}
async function read(action, client) {
  const response = await chrome.tabs.sendMessage(workerId, {
    type: "EVERFIT_READ",
    action,
    client,
  });
  if (!response?.ok)
    throw new Error(response?.error || "Everfit did not respond.");
  return response;
}
async function navigate(url) {
  await chrome.tabs.update(workerId, { url });
  for (let i = 0; i < 60; i++) {
    await sleep(500);
    const tab = await chrome.tabs.get(workerId);
    if (tab.status === "complete" && tab.url?.startsWith(url)) {
      try {
        await read("ping");
        return;
      } catch {
        /* The content script may still be attaching. */
      }
    }
  }
  throw new Error("Everfit could not be opened. Sign in, then retry the sync.");
}
async function main() {
  await api({ action: "preflight" });
  await update({
    status: "running",
    message: "Discovering all coaches and clients…",
  });
  const worker = await chrome.tabs.create({
    url: "https://app.everfit.io/home/client",
    active: false,
  });
  workerId = worker.id;
  await navigate("https://app.everfit.io/home/client");
  let state = await job(),
    runId = state.runId,
    status;
  if (runId) {
    await api({action:"resume",runId});
    status = await api({ action: "status", runId });
  } else {
    const { plan } = await read("roster");
    const started = await api({ action: "start", plan });
    runId = started.runId;
    await update({ runId });
    status = await api({ action: "status", runId });
  }
  const doneIds = new Set(
    status.items
      .filter((i) => i.status === "completed")
      .map((i) => i.everfit_id),
  );
  let done = doneIds.size,
    failed = 0;
  await update({ total: status.plan.length, done, failed });
  for (const client of status.plan) {
    state = await job();
    if (state.cancelRequested) {
      const result=await api({action:'finish',runId});
      await update({status:result.status,done:result.saved,message:`Stopped. Saved ${result.saved} of ${result.total} clients. Resume to collect the remaining clients.`});
      return;
    }
    if (doneIds.has(client.id)) continue;
    await update({ message: `${client.owner} · Reading ${client.name}…` });
    try {
      await navigate("https://app.everfit.io/home/client/" + client.id);
      const profile = await read("profile", client);
      await navigate("https://app.everfit.io/home/inbox/" + client.id);
      const conversation = await read("conversation", {...client, historySince:status.historySince});
      const capture = {
        id: client.id,
        email: profile.email,
        owner: profile.owner,
        capturedAt: new Date().toISOString(),
        updates: profile.updates,
        messages: conversation.messages,
        notes: [...profile.notes, ...conversation.notes],
        historyComplete: conversation.historyComplete,
      };
      await update({ message: `${client.owner} · Saving ${client.name}…` });
      await api({ action: "capture", runId, capture });
      done++;
    } catch (error) {
      failed++;
      const previous=await job();
      await update({failures:[...(previous.failures||[]),{name:client.name,coach:client.owner,error:error.message}].slice(-30)});
      await api({
        action: "failure",
        runId,
        clientId: client.id,
        error: error.message,
      });
    }
    await update({ done, failed });
  }
  await update({ message: "Saving coach reports…" });
  const result = await api({ action: "finish", runId });
  await update({
    status: result.status,
    done: result.saved,
    failed: result.total - result.saved,
    message:
      result.status === "completed"
        ? `Saved reports for all ${result.saved} clients. Return to CCOS to review.`
        : `Saved ${result.saved} of ${result.total} clients. The report is partial; failed clients are not counted as synced.`,
  });
}
main()
  .catch(async (error) => {
    await update({
      status: "interrupted",
      message: error.message + " Click Sync all coaches in CCOS to resume.",
    });
  })
  .finally(async () => {
    if (workerId) await chrome.tabs.remove(workerId).catch(() => {});
  });
