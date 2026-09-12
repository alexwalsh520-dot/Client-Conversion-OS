// This bridge is limited to the CCOS origin and one authenticated endpoint.
const CCOS_ORIGIN = "https://client-conversion-os.vercel.app";
window.addEventListener("message", async (event) => {
  if (
    event.source !== window ||
    event.origin !== CCOS_ORIGIN ||
    event.data?.channel !== "ccos-everfit-request"
  )
    return;
  const { id, command } = event.data;
  if (
    typeof id !== "string" ||
    id.length > 100 ||
    !["PING", "START", "STATUS", "CANCEL"].includes(command)
  )
    return;
  try {
    const value = await chrome.runtime.sendMessage({
      type: "CCOS_CONTROL",
      command,
    });
    window.postMessage(
      { channel: "ccos-everfit-response", id, value },
      CCOS_ORIGIN,
    );
  } catch {
    window.postMessage(
      {
        channel: "ccos-everfit-response",
        id,
        value: { error: "Reconnect the Everfit browser connector." },
      },
      CCOS_ORIGIN,
    );
  }
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  if (
    sender.id !== chrome.runtime.id ||
    !sender.url?.startsWith(chrome.runtime.getURL("runner.html"))
  )
    return;
  if (message.type !== "CCOS_API") return;
  const actions = [
    "preflight",
    "resume",
    "start",
    "status",
    "capture",
    "failure",
    "finish",
    "cancel",
  ];
  if (!actions.includes(message.body?.action)) {
    reply({ error: "Unsupported action." });
    return;
  }
  fetch("/api/coaching/everfit/sync", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(message.body),
  })
    .then(async (response) => ({
      ok: response.ok,
      status: response.status,
      ...(await response.json()),
    }))
    .then(reply)
    .catch(() =>
      reply({
        error: "CCOS connection lost. Keep the CCOS tab open and signed in.",
      }),
    );
  return true;
});
