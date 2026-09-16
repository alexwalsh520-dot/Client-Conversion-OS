"use client";

/**
 * V3 · Onboarding · New Client modal.
 *
 * All fields required (MAS 2026-09-16 spec):
 *   name, email, phone, coach, program, offer, start date, end date,
 *   amount paid, closer, payment platform.
 *
 * Posts to the existing V1 upsert_client action so we keep the same
 * side-effects that the coaching team already relies on (Slack "new
 * client" ping, sheet row, GHL upsert). Phase 6 will move the endpoint
 * under /api/coaching-v3/.
 */

import { useCallback, useEffect, useState } from "react";
import { X } from "lucide-react";

const OFFERS = ["Freedom Formula", "The Blueprint", "The Alpha", "Other"];
const PROGRAMS = ["12 week", "16 week", "6 week", "8 week", "Other"];
const PLATFORMS = ["Stripe", "Adminity Splits", "PayPal", "Zelle", "Other"];

type Props = {
  activeCoaches: string[];
  onClose: () => void;
  onSaved: () => void;
};

export default function NewClientModal({ activeCoaches, onClose, onSaved }: Props) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState({
    name: "",
    email: "",
    phoneNumber: "",
    coachName: activeCoaches[0] ?? "",
    program: "",
    offer: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: "",
    amountPaid: "",
    salesPerson: "",
    paymentPlatform: "Stripe",
  });

  const set = <K extends keyof typeof f>(k: K, v: string) =>
    setF((s) => ({ ...s, [k]: v }));

  // Esc-to-close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  const submit = useCallback(async () => {
    // Every field must be non-empty. Amount paid must be a number > 0.
    const required: Array<[string, string]> = [
      ["name", f.name],
      ["email", f.email],
      ["phone", f.phoneNumber],
      ["coach", f.coachName],
      ["program", f.program],
      ["offer", f.offer],
      ["start date", f.startDate],
      ["end date", f.endDate],
      ["amount paid", f.amountPaid],
      ["closer (sales person)", f.salesPerson],
      ["payment platform", f.paymentPlatform],
    ];
    for (const [label, value] of required) {
      if (!value || !value.trim()) {
        setErr(`Please fill in the ${label}.`);
        return;
      }
    }
    const amount = Number(f.amountPaid);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErr("Amount paid must be a positive number.");
      return;
    }
    if (f.endDate <= f.startDate) {
      setErr("End date must be after start date.");
      return;
    }

    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/coaching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert_client",
          payload: {
            name: f.name.trim(),
            email: f.email.trim(),
            phoneNumber: f.phoneNumber.trim(),
            coachName: f.coachName,
            program: f.program,
            offer: f.offer,
            startDate: f.startDate,
            endDate: f.endDate,
            amountPaid: amount,
            salesPerson: f.salesPerson.trim(),
            paymentPlatform: f.paymentPlatform,
            status: "active",
            onboardingStatus: "scheduled",
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [f, onSaved]);

  return (
    <div
      onClick={() => !busy && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.6)",
        zIndex: 100,
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "60px 20px 20px",
        overflowY: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-primary)",
          border: "1px solid var(--border-primary)",
          borderRadius: 12,
          width: "100%",
          maxWidth: 560,
          maxHeight: "calc(100vh - 80px)",
          overflowY: "auto",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}
      >
        <div
          style={{
            padding: "14px 20px",
            borderBottom: "1px solid var(--border-primary)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>New client</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
              All fields required · triggers Slack + sheet + GHL upserts
            </div>
          </div>
          <button
            onClick={() => !busy && onClose()}
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-muted)",
              cursor: "pointer",
              padding: 4,
              display: "inline-flex",
            }}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ padding: 20, display: "grid", gap: 12 }}>
          <Field label="Name">
            <input
              className="h3-in"
              value={f.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Full name"
              autoFocus
            />
          </Field>
          <Row>
            <Field label="Email">
              <input
                className="h3-in"
                type="email"
                value={f.email}
                onChange={(e) => set("email", e.target.value)}
                placeholder="client@example.com"
              />
            </Field>
            <Field label="Phone">
              <input
                className="h3-in"
                value={f.phoneNumber}
                onChange={(e) => set("phoneNumber", e.target.value)}
                placeholder="+1 555 555 5555"
              />
            </Field>
          </Row>
          <Row>
            <Field label="Coach">
              <select
                className="h3-in"
                value={f.coachName}
                onChange={(e) => set("coachName", e.target.value)}
              >
                <option value="">Unassigned</option>
                {activeCoaches.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Program">
              <select
                className="h3-in"
                value={f.program}
                onChange={(e) => set("program", e.target.value)}
              >
                <option value="">Select…</option>
                {PROGRAMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </Row>
          <Row>
            <Field label="Offer">
              <select
                className="h3-in"
                value={f.offer}
                onChange={(e) => set("offer", e.target.value)}
              >
                <option value="">Select…</option>
                {OFFERS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Closer (sales person)">
              <input
                className="h3-in"
                value={f.salesPerson}
                onChange={(e) => set("salesPerson", e.target.value)}
                placeholder="Who closed the sale"
              />
            </Field>
          </Row>
          <Row>
            <Field label="Start date">
              <input
                className="h3-in"
                type="date"
                value={f.startDate}
                onChange={(e) => set("startDate", e.target.value)}
              />
            </Field>
            <Field label="End date">
              <input
                className="h3-in"
                type="date"
                value={f.endDate}
                onChange={(e) => set("endDate", e.target.value)}
              />
            </Field>
          </Row>
          <Row>
            <Field label="Amount paid ($)">
              <input
                className="h3-in"
                type="number"
                min={0}
                value={f.amountPaid}
                onChange={(e) => set("amountPaid", e.target.value)}
                placeholder="1200"
              />
            </Field>
            <Field label="Payment platform">
              <select
                className="h3-in"
                value={f.paymentPlatform}
                onChange={(e) => set("paymentPlatform", e.target.value)}
              >
                {PLATFORMS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Field>
          </Row>
          {err && (
            <div style={{ fontSize: 12, color: "var(--danger)", padding: "6px 0" }}>{err}</div>
          )}
        </div>
        <div
          style={{
            padding: "12px 20px",
            borderTop: "1px solid var(--border-primary)",
            display: "flex",
            justifyContent: "flex-end",
            gap: 8,
          }}
        >
          <button className="h3-btn" onClick={() => !busy && onClose()} disabled={busy}>
            Cancel
          </button>
          <button className="h3-btn p" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Add client"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 4 }}>
      <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.4 }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}
