"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STEPS = ["Text", "Call", "$97 offer", "3 month"];

/**
 * Retention panel actions. "Mark asked" flips the extension milestone to
 * attempted through the existing coaching action (which also mirrors to the
 * sheet). Next step and note are saved as one client note prefixed
 * "Retention" so no new table is needed.
 */
export default function RenewalPanel({
  clientName,
  milestoneId,
  asked,
  done,
  nextStep,
  note,
  canMark,
}: {
  clientName: string;
  milestoneId: number | null;
  asked: boolean;
  done: boolean;
  nextStep: string | null;
  note: string | null;
  canMark: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<string | null>(nextStep);
  const [text, setText] = useState(note ?? "");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function markAsked() {
    if (!milestoneId) { setMsg("No milestone row for this client yet. Open the Coaching tab once to create it."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/coaching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update_milestone_checkbox", payload: { milestoneId, field: "retentionCompleted", status: "failed" } }) });
      if (!res.ok) throw new Error((await res.json()).error || "Could not save");
      setMsg("Marked as asked."); router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  async function save(nextStepValue: string | null, noteValue: string) {
    setBusy(true); setMsg(null);
    try {
      const body = `Retention · ${nextStepValue ?? "–"} · ${noteValue.trim()}`;
      const res = await fetch("/api/coaching/client-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientName, note: body }) });
      if (!res.ok) throw new Error((await res.json()).error || "Could not save");
      setMsg("Saved."); router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <span className="kk">Extension ask</span>
      <span className="v">
        {done ? "Extended" : asked ? "Asked" : <span className="h2-a">Not asked yet</span>}
        {!done && !asked && canMark && (
          <button className="h2-lk" style={{ marginLeft: 10, background: "none", border: "none", padding: 0, font: "inherit" }} onClick={markAsked} disabled={busy}>Mark asked</button>
        )}
      </span>
      <span className="kk">Next step</span>
      <span className="v">
        <span className="h2-seg">
          {STEPS.map((s) => (
            <button key={s} className={step === s ? "on" : ""} disabled={busy} onClick={() => { setStep(s); void save(s, text); }}>{s}</button>
          ))}
        </span>
      </span>
      <span className="kk">Note</span>
      <span className="v">
        <input
          placeholder="Where this stands, one line. Press Enter to save."
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void save(step, text); }}
        />
      </span>
      {msg && (<><span className="kk" /><span className="v h2-m" style={{ fontSize: 12 }}>{msg}</span></>)}
    </>
  );
}
