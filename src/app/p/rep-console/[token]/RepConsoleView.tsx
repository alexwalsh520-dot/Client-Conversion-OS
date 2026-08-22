"use client";

// Rep console (public token link, no CCOS login) — built phone-first for
// closers.
//
// Two sections:
//   * Leaderboard — every rep ranked by cash collected over the selected
//     range (Today / WTD / MTD / Custom, default MTD), plus a Team total row.
//   * Calls — a sheet-like table of the last 14 + next 7 ET days of
//     appointments (fixed server-side window), enriched with lead, sheet
//     outcome and manual entries. Column visibility is a per-device
//     preference (localStorage).
//
// View-only by default: when the token's can_edit is false, zero editing UI
// renders. When true, each row gets compact controls (outcome select, cash
// input, note) that POST manual entries to /api/public/rep-console/<token>
// and optimistically update.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ── API payload types (mirror /api/public/rep-console/[token]) ──────────────

interface ManualEntry {
  id: string;
  entry_type: string;
  value: Record<string, unknown> | null;
  rep_name: string | null;
  entered_at: string;
  applied: boolean;
}

interface Appointment {
  appointment_id: string;
  client: string;
  calendar_name: string;
  side: string;
  channel: string;
  rep_key: string | null;
  rep_name: string | null;
  contact_name: string | null;
  start_time: string | null;
  start_et_day: string | null;
  status: string | null;
  cancelled: boolean;
  upcoming: boolean;
  lead: {
    lead_key: string;
    display_name: string | null;
    ig_handle: string | null;
    origin_source: string;
    conversion_source: string | null;
    lm_optin_at: string | null;
    acquired_et_day: string;
  } | null;
  sheet_outcome: {
    status: string | null;
    outcome: string | null;
    closer: string | null;
    date: string;
    cash_collected_cents: number;
  } | null;
  manual_entries: ManualEntry[];
}

interface LeaderboardRow {
  rep_key: string;
  rep_name: string;
  cash_collected_cents: number;
  shows: number;
  calls_due: number;
  show_rate: number | null;
  closes: number;
  close_rate: number | null;
}

interface Payload {
  clientLabel: string;
  client: string;
  can_edit: boolean;
  rep_scope: string | null;
  appointments_window: { from: string; to: string };
  appointments: Appointment[];
  leaderboard_range: { from: string; to: string };
  leaderboard: { rows: LeaderboardRow[]; total: LeaderboardRow };
  migration_pending: boolean;
  generatedAt: string;
}

// ── ET date presets: Today / WTD / MTD / Custom (default MTD) ───────────────

function etToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

function startOfWeek(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(dateStr, -((dow + 6) % 7)); // Monday
}

type PresetKey = "today" | "wtd" | "mtd" | "custom";

const PRESETS: { key: PresetKey; label: string }[] = [
  { key: "today", label: "Today" },
  { key: "wtd", label: "WTD" },
  { key: "mtd", label: "MTD" },
  { key: "custom", label: "Custom" },
];

function presetRange(key: PresetKey): { from: string; to: string } {
  const today = etToday();
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "wtd":
      return { from: startOfWeek(today), to: today };
    case "mtd":
      return { from: today.slice(0, 8) + "01", to: today };
    default:
      return { from: today, to: today };
  }
}

// ── Formatting ──────────────────────────────────────────────────────────────

function fmtCents(cents: number | null): string {
  if (cents === null || !Number.isFinite(cents)) return "—";
  const dollars = cents / 100;
  const showCents = Math.abs(dollars) < 100 && dollars !== 0;
  return dollars.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: showCents ? 2 : 0,
  });
}

function fmtRate(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${Math.round(v * 100)}%`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmtRangeLabel(from: string, to: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  });
  const f = fmt.format(new Date(`${from}T00:00:00Z`));
  const t = fmt.format(new Date(`${to}T00:00:00Z`));
  return from === to ? f : `${f} – ${t}`;
}

// ── Calls table columns (visibility persisted per device) ───────────────────

type ColId = "when" | "lead" | "client" | "channel" | "rep" | "outcome" | "cash";

const COLUMNS: { id: ColId; label: string }[] = [
  { id: "when", label: "Date / Time" },
  { id: "lead", label: "Lead" },
  { id: "client", label: "Client" },
  { id: "channel", label: "Channel" },
  { id: "rep", label: "Rep" },
  { id: "outcome", label: "Outcome" },
  { id: "cash", label: "Cash" },
];

const COLS_STORAGE_KEY = "rep-console-columns-v1";

function readHiddenCols(): ColId[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(COLS_STORAGE_KEY) || "[]");
    return Array.isArray(parsed)
      ? parsed.filter((c): c is ColId => COLUMNS.some((col) => col.id === c))
      : [];
  } catch {
    return [];
  }
}

// ── Row status derivation ───────────────────────────────────────────────────

interface RowStatus {
  label: string;
  cls: string;
}

function latestManual(appt: Appointment, types: string[]): ManualEntry | null {
  let latest: ManualEntry | null = null;
  for (const e of appt.manual_entries) {
    if (!types.includes(e.entry_type)) continue;
    if (!latest || e.entered_at > latest.entered_at) latest = e;
  }
  return latest;
}

function statusFor(appt: Appointment): RowStatus {
  const manual = latestManual(appt, ["outcome", "reschedule"]);
  if (manual) {
    if (manual.entry_type === "reschedule") return { label: "Rescheduled", cls: "resched" };
    const outcome = manual.value?.outcome;
    if (outcome === "close") return { label: "Closed", cls: "closed" };
    if (outcome === "no_show") return { label: "No Show", cls: "no" };
    if (outcome === "show") return { label: "No Close", cls: "taken" };
  }
  if (appt.cancelled) return { label: "Cancelled", cls: "cancelled" };
  const sheet = appt.sheet_outcome?.status;
  if (sheet === "closed") return { label: "Closed", cls: "closed" };
  if (sheet === "taken") return { label: "Showed", cls: "taken" };
  if (sheet === "no_show") return { label: "No Show", cls: "no" };
  if (appt.upcoming) return { label: "Upcoming", cls: "upcoming" };
  return { label: "—", cls: "taken" };
}

function cashFor(appt: Appointment): number | null {
  const manualCash = latestManual(appt, ["cash"]);
  if (manualCash && Number.isFinite(Number(manualCash.value?.amount_cents))) {
    return Number(manualCash.value?.amount_cents);
  }
  const manualOutcome = latestManual(appt, ["outcome"]);
  if (manualOutcome && Number.isFinite(Number(manualOutcome.value?.cash_cents))) {
    return Number(manualOutcome.value?.cash_cents);
  }
  const sheetCash = appt.sheet_outcome?.cash_collected_cents ?? 0;
  return sheetCash > 0 ? sheetCash : null;
}

const REFRESH_MS = 5 * 60_000;

// ── View ────────────────────────────────────────────────────────────────────

export default function RepConsoleView({ token }: { token: string }) {
  const [preset, setPreset] = useState<PresetKey>("mtd");
  const [customFrom, setCustomFrom] = useState(() => etToday());
  const [customTo, setCustomTo] = useState(() => etToday());
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [hiddenCols, setHiddenCols] = useState<ColId[]>([]);
  const [colsOpen, setColsOpen] = useState(false);
  const [saving, setSaving] = useState<string | null>(null); // appointment_id being saved
  const [cashDrafts, setCashDrafts] = useState<Record<string, string>>({});
  const inFlight = useRef<string | null>(null);
  const colsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setHiddenCols(readHiddenCols());
  }, []);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (colsRef.current && !colsRef.current.contains(e.target as Node)) setColsOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const range = useMemo(
    () => (preset === "custom" ? { from: customFrom, to: customTo } : presetRange(preset)),
    [preset, customFrom, customTo],
  );

  const load = useCallback(
    async (opts?: { silent?: boolean }) => {
      if (!range.from || !range.to || range.from > range.to) return;
      const url = `/api/public/rep-console/${token}?from=${range.from}&to=${range.to}`;
      if (inFlight.current === url) return;
      inFlight.current = url;
      if (!opts?.silent) setLoading(true);
      try {
        const res = await fetch(url, { cache: "no-store" });
        const body = await res.json();
        if (inFlight.current !== url) return; // superseded
        if (!res.ok) throw new Error(body?.error || "Could not load the console.");
        setData(body as Payload);
        setError("");
      } catch (err) {
        if (inFlight.current !== url) return;
        setError(err instanceof Error ? err.message : "Could not load the console.");
      } finally {
        if (inFlight.current === url) {
          inFlight.current = null;
          setLoading(false);
        }
      }
    },
    [token, range.from, range.to],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const id = window.setInterval(() => void load({ silent: true }), REFRESH_MS);
    return () => window.clearInterval(id);
  }, [load]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void load({ silent: true });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [load]);

  const toggleCol = (id: ColId) => {
    setHiddenCols((prev) => {
      const next = prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id];
      try {
        localStorage.setItem(COLS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* private mode — visibility just won't persist */
      }
      return next;
    });
  };

  const visibleCols = COLUMNS.filter((c) => !hiddenCols.includes(c.id));

  const scopeName = useMemo(() => {
    if (!data?.rep_scope) return null;
    const row = data.leaderboard.rows.find((r) => r.rep_key === data.rep_scope);
    return row?.rep_name ?? data.rep_scope;
  }, [data]);

  // ── Manual-entry POSTs (only reachable when can_edit) ─────────────────────

  const postEntry = useCallback(
    async (
      appt: Appointment,
      entryType: string,
      value: Record<string, unknown>,
    ): Promise<boolean> => {
      if (!data) return false;
      setSaving(appt.appointment_id);
      // Optimistic: append the entry locally so the row updates immediately.
      const optimistic: ManualEntry = {
        id: `local-${Date.now()}`,
        entry_type: entryType,
        value,
        rep_name: appt.rep_name ?? scopeName,
        entered_at: new Date().toISOString(),
        applied: false,
      };
      setData((prev) =>
        prev
          ? {
              ...prev,
              appointments: prev.appointments.map((a) =>
                a.appointment_id === appt.appointment_id
                  ? { ...a, manual_entries: [...a.manual_entries, optimistic] }
                  : a,
              ),
            }
          : prev,
      );
      try {
        const res = await fetch(`/api/public/rep-console/${token}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            appointment_key: appt.appointment_id,
            client_key: appt.client,
            entry_type: entryType,
            value,
            rep_name: appt.rep_name ?? scopeName,
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body?.error || "Could not save the entry.");
        return true;
      } catch (err) {
        // Roll the optimistic entry back and surface the error.
        setData((prev) =>
          prev
            ? {
                ...prev,
                appointments: prev.appointments.map((a) =>
                  a.appointment_id === appt.appointment_id
                    ? {
                        ...a,
                        manual_entries: a.manual_entries.filter((e) => e.id !== optimistic.id),
                      }
                    : a,
                ),
              }
            : prev,
        );
        setError(err instanceof Error ? err.message : "Could not save the entry.");
        return false;
      } finally {
        setSaving(null);
      }
    },
    [data, token, scopeName],
  );

  const onOutcomeChange = (appt: Appointment, selection: string) => {
    if (!selection) return;
    if (selection === "rescheduled") {
      void postEntry(appt, "reschedule", {});
      return;
    }
    const outcome =
      selection === "closed" ? "close" : selection === "no_show" ? "no_show" : "show";
    void postEntry(appt, "outcome", { outcome });
  };

  const onCashSave = (appt: Appointment) => {
    const draft = (cashDrafts[appt.appointment_id] || "").trim();
    const dollars = Number(draft);
    if (!draft || !Number.isFinite(dollars) || dollars <= 0) return;
    void postEntry(appt, "cash", { amount_cents: Math.round(dollars * 100) }).then((ok) => {
      if (ok) setCashDrafts((prev) => ({ ...prev, [appt.appointment_id]: "" }));
    });
  };

  const onNote = (appt: Appointment) => {
    const note = window.prompt(`Note for ${appt.contact_name || "this call"}:`);
    if (!note || !note.trim()) return;
    void postEntry(appt, "note", { note: note.trim() });
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (loading && !data) {
    return (
      <main className="pub-rc-page">
        <div className="pub-rc-inner">
          <div className="pub-rc-state">Loading the console…</div>
        </div>
      </main>
    );
  }

  if (error && !data) {
    return (
      <main className="pub-rc-page">
        <div className="pub-rc-inner">
          <div className="pub-rc-state pub-rc-state-error">{error}</div>
        </div>
      </main>
    );
  }

  if (!data) return null;

  const lb = data.leaderboard;
  const topRepKey =
    lb.rows.length > 0 && lb.rows[0].cash_collected_cents > 0 ? lb.rows[0].rep_key : null;
  const appts = [...data.appointments].sort((a, b) =>
    (a.start_time || "").localeCompare(b.start_time || ""),
  );

  return (
    <main className="pub-rc-page">
      <div className="pub-rc-inner">
        <header className="pub-rc-header">
          <div>
            <h1>
              {data.clientLabel} — Rep Console
              {scopeName ? <span className="pub-rc-scope">Viewing: {scopeName}</span> : null}
            </h1>
            <p className="pub-rc-sub">
              Leaderboard {fmtRangeLabel(data.leaderboard_range.from, data.leaderboard_range.to)} · calls
              window {fmtRangeLabel(data.appointments_window.from, data.appointments_window.to)} (ET)
              {data.can_edit ? " · editing enabled" : " · view-only"}
            </p>
          </div>
          <button
            type="button"
            className="pub-rc-chipbtn"
            onClick={() => void load()}
            disabled={loading}
          >
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </header>

        {data.migration_pending ? (
          <div className="pub-rc-banner">
            Data engine awaiting database migration — numbers will appear once it runs.
          </div>
        ) : null}

        {/* ── Date presets (drive the leaderboard range) ── */}
        <div className="pub-rc-presets">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              className={`pub-rc-chipbtn${preset === p.key ? " is-active" : ""}`}
              onClick={() => setPreset(p.key)}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" ? (
            <>
              <input
                type="date"
                value={customFrom}
                max={customTo}
                onChange={(e) => e.target.value && setCustomFrom(e.target.value)}
              />
              <span className="pub-rc-dim">to</span>
              <input
                type="date"
                value={customTo}
                min={customFrom}
                onChange={(e) => e.target.value && setCustomTo(e.target.value)}
              />
            </>
          ) : null}
        </div>

        {/* ── Leaderboard ── */}
        <section className="pub-rc-card">
          <div className="pub-rc-card-head">
            <p className="pub-rc-card-title">
              Leaderboard — {fmtRangeLabel(data.leaderboard_range.from, data.leaderboard_range.to)}
            </p>
          </div>
          <div className="pub-rc-scroll">
            <table className="pub-rc-table">
              <thead>
                <tr>
                  <th>Rep</th>
                  <th className="pub-rc-num">Cash Collected</th>
                  <th className="pub-rc-num">Shows</th>
                  <th className="pub-rc-num">Calls Due</th>
                  <th className="pub-rc-num">Show Rate</th>
                  <th className="pub-rc-num">Closes</th>
                  <th className="pub-rc-num">Close Rate</th>
                </tr>
              </thead>
              <tbody>
                {lb.rows.map((r, i) => (
                  <tr key={r.rep_key} className={r.rep_key === topRepKey ? "pub-rc-top" : undefined}>
                    <td className="pub-rc-name">
                      <span className="pub-rc-rank">{i + 1}</span>
                      {r.rep_name}
                      {r.rep_key === topRepKey ? " 👑" : ""}
                    </td>
                    <td className="pub-rc-num">{fmtCents(r.cash_collected_cents)}</td>
                    <td className="pub-rc-num">{r.shows}</td>
                    <td className="pub-rc-num">{r.calls_due}</td>
                    <td className="pub-rc-num">{fmtRate(r.show_rate)}</td>
                    <td className="pub-rc-num">{r.closes}</td>
                    <td className="pub-rc-num">{fmtRate(r.close_rate)}</td>
                  </tr>
                ))}
                <tr className="pub-rc-total">
                  <td className="pub-rc-name">
                    <span className="pub-rc-rank" />
                    Team
                  </td>
                  <td className="pub-rc-num">{fmtCents(lb.total.cash_collected_cents)}</td>
                  <td className="pub-rc-num">{lb.total.shows}</td>
                  <td className="pub-rc-num">{lb.total.calls_due}</td>
                  <td className="pub-rc-num">{fmtRate(lb.total.show_rate)}</td>
                  <td className="pub-rc-num">{lb.total.closes}</td>
                  <td className="pub-rc-num">{fmtRate(lb.total.close_rate)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        {/* ── Calls ── */}
        <section className="pub-rc-card">
          <div className="pub-rc-card-head">
            <p className="pub-rc-card-title">
              Calls — last 14 + next 7 days ({appts.length})
            </p>
            <div className="pub-rc-colwrap" ref={colsRef}>
              <button
                type="button"
                className="pub-rc-chipbtn"
                onClick={() => setColsOpen((o) => !o)}
              >
                Columns
              </button>
              {colsOpen ? (
                <div className="pub-rc-colpop">
                  {COLUMNS.map((c) => (
                    <label key={c.id}>
                      <input
                        type="checkbox"
                        checked={!hiddenCols.includes(c.id)}
                        onChange={() => toggleCol(c.id)}
                      />
                      {c.label}
                    </label>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
          {appts.length === 0 ? (
            <div className="pub-rc-state">No calls in the window.</div>
          ) : (
            <div className="pub-rc-scroll">
              <table className="pub-rc-table">
                <thead>
                  <tr>
                    {visibleCols.map((c) => (
                      <th
                        key={c.id}
                        className={c.id === "cash" ? "pub-rc-num" : undefined}
                      >
                        {c.label}
                      </th>
                    ))}
                    {data.can_edit ? <th>Log</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {appts.map((a) => {
                    const st = statusFor(a);
                    const cash = cashFor(a);
                    const busy = saving === a.appointment_id;
                    const hasPending = a.manual_entries.some((e) => !e.applied);
                    return (
                      <tr key={a.appointment_id}>
                        {visibleCols.map((c) => {
                          switch (c.id) {
                            case "when":
                              return <td key={c.id}>{fmtWhen(a.start_time)}</td>;
                            case "lead":
                              return (
                                <td key={c.id} className="pub-rc-name">
                                  {a.contact_name || a.lead?.display_name || "—"}
                                </td>
                              );
                            case "client":
                              // Business-wide tokens mix clients, so each row
                              // names its own calendar's client.
                              return (
                                <td key={c.id}>
                                  {a.client === "tyson" ? "Tyson" : a.client === "jake" ? "Jake" : a.client || data.clientLabel}
                                </td>
                              );
                            case "channel":
                              return (
                                <td key={c.id} className="pub-rc-dim">
                                  {a.channel === "dm" ? "DM" : "Outbound"}
                                </td>
                              );
                            case "rep":
                              return <td key={c.id}>{a.rep_name || "—"}</td>;
                            case "outcome":
                              return (
                                <td key={c.id}>
                                  <span className={`pub-rc-chip pub-rc-chip-${st.cls}`}>
                                    {st.label}
                                  </span>
                                  {hasPending ? (
                                    <>
                                      {" "}
                                      <span className="pub-rc-pending-note">logged</span>
                                    </>
                                  ) : null}
                                </td>
                              );
                            case "cash":
                              return (
                                <td key={c.id} className="pub-rc-num">
                                  {fmtCents(cash)}
                                </td>
                              );
                            default:
                              return <td key={c.id} />;
                          }
                        })}
                        {data.can_edit ? (
                          <td className="pub-rc-edit">
                            <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                              <select
                                value=""
                                disabled={busy}
                                onChange={(e) => onOutcomeChange(a, e.target.value)}
                                aria-label="Log outcome"
                              >
                                <option value="">Outcome…</option>
                                <option value="closed">Closed</option>
                                <option value="no_close">No Close</option>
                                <option value="no_show">No-Show</option>
                                <option value="rescheduled">Rescheduled</option>
                              </select>
                              <input
                                type="number"
                                inputMode="decimal"
                                min={0}
                                placeholder="Cash $"
                                disabled={busy}
                                value={cashDrafts[a.appointment_id] ?? ""}
                                onChange={(e) =>
                                  setCashDrafts((prev) => ({
                                    ...prev,
                                    [a.appointment_id]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") onCashSave(a);
                                }}
                              />
                              <button
                                type="button"
                                className="pub-rc-savebtn"
                                disabled={busy || !(cashDrafts[a.appointment_id] || "").trim()}
                                onClick={() => onCashSave(a)}
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                className="pub-rc-notebtn"
                                disabled={busy}
                                onClick={() => onNote(a)}
                              >
                                Note
                              </button>
                            </span>
                          </td>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {error ? <div className="pub-rc-state pub-rc-state-error">{error}</div> : null}
      </div>
    </main>
  );
}
