"use client";

import { useEffect, useState } from "react";

/** Pause or resume the coach's daily Slack digest. Same endpoints the Coach Performance tab uses. */
export default function DigestToggle({ coach }: { coach: string }) {
  const [state, setState] = useState<"loading" | "on" | "off" | "none" | "error">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(`/api/daily-coacher/recipients?coach=${encodeURIComponent(coach)}`)
      .then(async (r) => { if (r.status === 404) return { recipient: null }; if (!r.ok) throw new Error(); return r.json(); })
      .then((j) => setState(j.recipient ? (j.recipient.enabled ? "on" : "off") : "none"))
      .catch(() => setState("error"));
  }, [coach]);
  async function flip() {
    if (state !== "on" && state !== "off") return;
    setBusy(true);
    try {
      const res = await fetch(`/api/daily-coacher/recipients/${encodeURIComponent(coach)}/toggle`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled: state === "off" }) });
      if (!res.ok) throw new Error();
      setState(state === "on" ? "off" : "on");
    } catch { setState("error"); }
    finally { setBusy(false); }
  }
  if (state === "loading") return <button className="h2-btn" disabled>Digest</button>;
  if (state === "none") return <button className="h2-btn" disabled title="No digest set up for this coach">No digest set up</button>;
  if (state === "error") return <button className="h2-btn" disabled>Digest unavailable</button>;
  return <button className="h2-btn" onClick={flip} disabled={busy}>{state === "on" ? "Pause digest" : "Resume digest"}</button>;
}
