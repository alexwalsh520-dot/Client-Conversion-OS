"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Adds a client through the existing upsert_client action (which also writes the sheet, pings Slack, and upserts GHL). */
export default function AddClientModal({ coaches, defaultCoach }: { coaches: string[]; defaultCoach: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [f, setF] = useState({ name: "", email: "", phoneNumber: "", coachName: defaultCoach, program: "", offer: "", startDate: new Date().toISOString().slice(0, 10), endDate: "", amountPaid: "", salesPerson: "", paymentPlatform: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((s) => ({ ...s, [k]: e.target.value }));

  async function save() {
    if (!f.name.trim() || !f.startDate || !f.endDate) { setMsg("Name, start date, and end date are required."); return; }
    setBusy(true); setMsg(null);
    try {
      const res = await fetch("/api/coaching", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "upsert_client", payload: { ...f, name: f.name.trim(), status: "active", amountPaid: Number(f.amountPaid) || 0 } }) });
      if (!res.ok) throw new Error((await res.json()).error || "Could not save");
      setMsg("Added."); router.refresh(); setTimeout(() => setOpen(false), 700);
    } catch (e) { setMsg(e instanceof Error ? e.message : "Could not save"); }
    finally { setBusy(false); }
  }

  const field = (label: string, k: keyof typeof f, type = "text", placeholder = "") => (
    <>
      <span className="kk">{label}</span>
      <span><input className="h2-in" style={{ width: "100%" }} type={type} value={f[k]} onChange={set(k)} placeholder={placeholder} /></span>
    </>
  );

  return (
    <>
      <button className="h2-btn p" onClick={() => setOpen(true)}>Add client</button>
      {open && (
        <div className="h2-modal" onClick={() => !busy && setOpen(false)}>
          <div className="mb" onClick={(e) => e.stopPropagation()}>
            <div className="hd">Add client</div>
            <div className="bd">
              <div className="h2-fact" style={{ gridTemplateColumns: "120px 1fr", rowGap: 8 }}>
                {field("Name", "name")}
                {field("Email", "email", "email")}
                {field("Phone", "phoneNumber")}
                <span className="kk">Coach</span>
                <span><select className="h2-in" style={{ width: "100%" }} value={f.coachName} onChange={set("coachName")}><option value="">Unassigned</option>{coaches.map((c) => <option key={c}>{c}</option>)}</select></span>
                {field("Program", "program", "text", "12 week")}
                {field("Offer", "offer")}
                {field("Start", "startDate", "date")}
                {field("End", "endDate", "date")}
                {field("Paid", "amountPaid", "number", "1200")}
                {field("Closer", "salesPerson")}
                {field("Platform", "paymentPlatform", "text", "Stripe")}
              </div>
              {msg && <p className="h2-quiet" style={{ margin: "12px 0 0" }}>{msg}</p>}
            </div>
            <div className="ft">
              <button className="h2-btn" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
              <button className="h2-btn p" onClick={save} disabled={busy}>{busy ? "Saving" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
