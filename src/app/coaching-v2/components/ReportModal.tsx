"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Level } from "@/lib/coaching-v2/types";
import { Dot } from "./bits";

type Row = { id: number; name: string; health: Level };

/**
 * End of day report. Posts through the existing submit_eod action, which
 * stores the report and posts it to the coaching Slack channel, where Ahmad
 * comments by hand.
 */
export default function ReportModal({ coach, clients }: { coach: string; clients: Row[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hours, setHours] = useState("");
  const [feeling, setFeeling] = useState("Good");
  const [summary, setSummary] = useState("");
  const [questions, setQuestions] = useState("");
  const [checked, setChecked] = useState<Record<number, { on: boolean; note: string }>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const n = Object.values(checked).filter((x) => x.on).length;

  async function submit() {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "submit_eod",
          payload: {
            submittedBy: coach,
            role: "coach",
            date: new Date().toISOString().slice(0, 10),
            activeClientCount: clients.length,
            hoursLogged: Number(hours) || 0,
            feelingToday: feeling,
            summary,
            questionsForManagement: questions,
            clientCheckins: clients.map((c) => ({ clientName: c.name, checkedIn: !!checked[c.id]?.on, notes: checked[c.id]?.note ?? "" })),
          },
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error || "Could not submit");
      setMsg("Submitted and posted to Slack."); router.refresh();
      setTimeout(() => setOpen(false), 900);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not submit"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <button className="h2-btn p" onClick={() => setOpen(true)}>Submit report</button>
      {open && (
        <div className="h2-modal" onClick={() => !busy && setOpen(false)}>
          <div className="mb" onClick={(e) => e.stopPropagation()}>
            <div className="hd">End of day · {coach} · {new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}<span className="h2-m" style={{ fontWeight: 400, fontSize: 12 }}>{n} of {clients.length} checked</span></div>
            <div className="bd">
              <div className="h2-fact" style={{ gridTemplateColumns: "110px 1fr", marginBottom: 12 }}>
                <span className="kk">Hours</span><span><input className="h2-in" style={{ width: 70 }} value={hours} onChange={(e) => setHours(e.target.value)} placeholder="6.5" /></span>
                <span className="kk">How was today</span>
                <span><span className="h2-seg">{["Good", "Okay", "Rough"].map((f) => <button key={f} className={feeling === f ? "on" : ""} onClick={() => setFeeling(f)}>{f}</button>)}</span></span>
              </div>
              <div className="h2-h">Clients you spoke to</div>
              {clients.map((c) => (
                <div key={c.id} className="ck">
                  <input type="checkbox" checked={!!checked[c.id]?.on} onChange={(e) => setChecked((s) => ({ ...s, [c.id]: { on: e.target.checked, note: s[c.id]?.note ?? "" } }))} />
                  <span><Dot lvl={c.health} /> {c.name}</span>
                  <input className="h2-in" placeholder="One line" value={checked[c.id]?.note ?? ""} onChange={(e) => setChecked((s) => ({ ...s, [c.id]: { on: s[c.id]?.on ?? true, note: e.target.value } }))} />
                </div>
              ))}
              <div className="h2-h" style={{ marginTop: 14 }}>Summary</div>
              <input className="h2-in" style={{ width: "100%" }} value={summary} onChange={(e) => setSummary(e.target.value)} placeholder="Two lines on the day" />
              <div className="h2-h" style={{ marginTop: 14 }}>Anything for management</div>
              <input className="h2-in" style={{ width: "100%" }} value={questions} onChange={(e) => setQuestions(e.target.value)} placeholder="Optional" />
              {msg && <p className="h2-quiet" style={{ margin: "12px 0 0" }}>{msg}</p>}
            </div>
            <div className="ft">
              <button className="h2-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="h2-btn p" onClick={submit} disabled={busy}>{busy ? "Submitting" : "Submit report"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
