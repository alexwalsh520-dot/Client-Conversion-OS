"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useHub } from "./HubShell";

type Props = {
  clientId: number;
  clientName: string;
  coach: string;
  primary: { label: string; action: "extend" | "reply" | "call" | "video" | "plan" };
  extendAllowed: boolean;
};

/**
 * The split action button on the client record. Left half is the suggested
 * action for this client's situation. The chevron opens every action.
 * Every write goes through an API the Coaching tab already uses.
 */
export default function ClientActions({ clientId, clientName, coach, primary, extendAllowed }: Props) {
  const router = useRouter();
  const { openAsk } = useHub();
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<null | "call" | "note" | "referral" | "extend" | "close">(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const [call, setCall] = useState({ date: new Date().toISOString().slice(0, 10), minutes: "", notes: "", link: "" });
  const [note, setNote] = useState("");
  const [ref, setRef] = useState({ name: "", phone: "" });
  const [why, setWhy] = useState("");

  async function post(url: string, body: unknown, ok: string) {
    setBusy(true); setMsg(null);
    try {
      const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Could not save");
      setMsg(ok); router.refresh(); setTimeout(() => { setModal(null); setMsg(null); }, 800);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  const doPrimary = () => {
    if (primary.action === "extend") setModal("extend");
    else if (primary.action === "call") setModal("call");
    else if (primary.action === "reply") window.open("https://app.everfit.io/", "_blank", "noreferrer");
    else if (primary.action === "video") void navigator.clipboard?.writeText(`${location.origin}/testimonials/record`).then(() => { setMsg("Recording link copied."); setTimeout(() => setMsg(null), 1500); });
    else router.push("#nutrition");
  };

  const item = (label: string, on: () => void, danger = false) => (
    <button className={danger ? "danger" : ""} onClick={() => { setMenu(false); on(); }}>{label}</button>
  );

  return (
    <div ref={wrap} style={{ position: "relative" }}>
      <span className="h2-split">
        <button className="h2-btn" onClick={doPrimary}>{primary.label}</button>
        <button className="h2-btn chev" aria-label="All actions" onClick={() => setMenu((m) => !m)}>▾</button>
      </span>
      {msg && !modal && <span className="h2-m" style={{ fontSize: 12, marginLeft: 10 }}>{msg}</span>}
      {menu && (
        <div className="h2-menu">
          <div className="lbl">Record</div>
          {item("Log a call", () => setModal("call"))}
          {item("Add a note", () => setModal("note"))}
          {item("Log a referral", () => setModal("referral"))}
          <div className="rule" />
          <div className="lbl">Program</div>
          {item("Extend program", () => setModal("extend"))}
          {item("Close program", () => setModal("close"), true)}
          <div className="rule" />
          <Link href="/coaching">Edit details in the Coaching tab</Link>
          {item("Ask Ahmad about this client", () => openAsk(clientName))}
        </div>
      )}

      {modal && (
        <div className="h2-modal" onClick={() => !busy && setModal(null)}>
          <div className="mb" onClick={(e) => e.stopPropagation()} style={{ width: 480 }}>
            <div className="hd">
              {modal === "call" ? "Log a call" : modal === "note" ? "Add a note" : modal === "referral" ? "Log a referral" : modal === "extend" ? "Extend program" : "Close program"}
              <span className="h2-m" style={{ fontWeight: 400, fontSize: 12 }}>{clientName}</span>
            </div>
            <div className="bd">
              {modal === "call" && (
                <div className="h2-fact" style={{ gridTemplateColumns: "100px 1fr", rowGap: 8 }}>
                  <span className="kk">Date</span><span><input className="h2-in" type="date" value={call.date} onChange={(e) => setCall({ ...call, date: e.target.value })} /></span>
                  <span className="kk">Minutes</span><span><input className="h2-in" style={{ width: 80 }} value={call.minutes} onChange={(e) => setCall({ ...call, minutes: e.target.value })} placeholder="30" /></span>
                  <span className="kk">Notes</span><span><input className="h2-in" style={{ width: "100%" }} value={call.notes} onChange={(e) => setCall({ ...call, notes: e.target.value })} placeholder="What was covered" /></span>
                  <span className="kk">Recording</span><span><input className="h2-in" style={{ width: "100%" }} value={call.link} onChange={(e) => setCall({ ...call, link: e.target.value })} placeholder="Fathom link, counts toward the weekly score" /></span>
                </div>
              )}
              {modal === "note" && <input className="h2-in" style={{ width: "100%" }} value={note} onChange={(e) => setNote(e.target.value)} placeholder="One line" autoFocus />}
              {modal === "referral" && (
                <div className="h2-fact" style={{ gridTemplateColumns: "100px 1fr", rowGap: 8 }}>
                  <span className="kk">Referee</span><span><input className="h2-in" style={{ width: "100%" }} value={ref.name} onChange={(e) => setRef({ ...ref, name: e.target.value })} placeholder="Full name" /></span>
                  <span className="kk">Phone</span><span><input className="h2-in" style={{ width: "100%" }} value={ref.phone} onChange={(e) => setRef({ ...ref, phone: e.target.value })} placeholder="+1" /></span>
                  <span className="kk" /><span className="h2-quiet" style={{ margin: 0 }}>Goes to the referral tracker and pings the closers.</span>
                </div>
              )}
              {modal === "extend" && (
                extendAllowed
                  ? <p className="h2-quiet" style={{ margin: 0 }}>Adds the weeks to the current end date and records the extension. Pick one.</p>
                  : <p className="h2-quiet" style={{ margin: 0 }}>This client has no end date, so there is nothing to extend. Set one in the Coaching tab first.</p>
              )}
              {modal === "close" && (
                <div>
                  <p className="h2-quiet" style={{ margin: "0 0 10px" }}>Marks the retention as lost and records why. The client stays on the roster until the Coaching tab moves them to completed.</p>
                  <input className="h2-in" style={{ width: "100%" }} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why, one line" />
                </div>
              )}
              {msg && <p className="h2-quiet" style={{ margin: "12px 0 0" }}>{msg}</p>}
            </div>
            <div className="ft">
              <button className="h2-btn" onClick={() => setModal(null)} disabled={busy}>Cancel</button>
              {modal === "call" && <button className="h2-btn p" disabled={busy} onClick={() => post("/api/coaching", { action: "upsert_meeting", payload: { clientId, clientName, coachName: coach, meetingDate: call.date, durationMinutes: Number(call.minutes) || 0, notes: call.notes, fathomLink: call.link } }, "Call logged.")}>Save</button>}
              {modal === "note" && <button className="h2-btn p" disabled={busy || !note.trim()} onClick={() => post("/api/coaching/client-notes", { clientName, note: note.trim() }, "Note saved.")}>Save</button>}
              {modal === "referral" && <button className="h2-btn p" disabled={busy || !ref.name.trim() || !ref.phone.trim()} onClick={() => post("/api/referrals", { existingClientId: clientId, refereeName: ref.name, refereePhone: ref.phone }, "Referral logged.")}>Save</button>}
              {modal === "extend" && extendAllowed && (
                <>
                  <button className="h2-btn" disabled={busy} onClick={() => post("/api/coaching/retention", { action: "extend", clientId, weeks: 4 }, "Extended 4 weeks.")}>4 weeks</button>
                  <button className="h2-btn p" disabled={busy} onClick={() => post("/api/coaching/retention", { action: "extend", clientId, weeks: 12 }, "Extended 12 weeks.")}>12 weeks</button>
                </>
              )}
              {modal === "close" && <button className="h2-btn p" disabled={busy} onClick={async () => { if (why.trim()) await fetch("/api/coaching/client-notes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientName, note: `Closed · ${why.trim()}` }) }); void post("/api/coaching/retention", { action: "mark_opp_lost", clientId }, "Recorded as lost."); }}>Record</button>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
