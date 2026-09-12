const CCOS = "https://client-conversion-os.vercel.app";
let starting = false;
chrome.action.onClicked.addListener(() =>
  chrome.tabs.create({ url: CCOS + "/coaching" }),
);
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    message.type !== "CCOS_CONTROL" ||
    sender.id !== chrome.runtime.id ||
    !sender.tab?.id ||
    !sender.url?.startsWith(CCOS + "/")
  )
    return;
  (async () => {
    const { job } = await chrome.storage.session.get("job");
    if (message.command === "PING")
      return { connected: true, version: chrome.runtime.getManifest().version };
    if (message.command === "STATUS") {
      if (
        job?.runnerId &&
        ["running", "starting"].includes(job.status) &&
        !(await chrome.tabs.get(job.runnerId).catch(() => null))
      ) {
        const interrupted = {
          ...job,
          status: "interrupted",
          message:
            "The sync tab was closed. Resume to continue from saved clients.",
        };
        await chrome.storage.session.set({ job: interrupted });
        return { connected: true, job: interrupted };
      }
      return { connected: true, job: job ?? null };
    }
    if (message.command === "CANCEL") {
      if (job)
        await chrome.storage.session.set({
          job: { ...job, cancelRequested: true },
        });
      return { connected: true };
    }
    if (message.command === "START") {
      if (starting) return { connected: true, starting: true };
      starting = true;
      try {
        // Reattach after a CCOS reload; never launch two collectors.
        if (job?.runnerId) {
          const existing = await chrome.tabs
            .get(job.runnerId)
            .catch(() => null);
          if (existing && ["running", "starting"].includes(job.status)) {
            await chrome.storage.session.set({
              job: { ...job, ccosTab: sender.tab.id },
            });
            return { connected: true, job };
          }
        }
        const next = {
          status: "starting",
          ccosTab: sender.tab.id,
          runId: ["interrupted", "partial"].includes(job?.status) ? job.runId : null,
          done: 0,
          total: 0,
          message: "Connecting to Everfit…",
          cancelRequested: false,
        };
        await chrome.storage.session.set({ job: next });
        const tab = await chrome.tabs.create({
          url: chrome.runtime.getURL("runner.html"),
          active: false,
        });
        const { job: fresh } = await chrome.storage.session.get("job");
        await chrome.storage.session.set({
          job: { ...fresh, runnerId: tab.id },
        });
        return { connected: true };
      } finally {
        starting = false;
      }
    }
    return { error: "Unknown connector command." };
  })()
    .then(reply)
    .catch(() => reply({ error: "Could not start the connector." }));
  return true;
});
