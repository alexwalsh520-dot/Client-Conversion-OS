"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// The page is a pure renderer. It reads STORED measurement rows and never
// computes a check at request time; the numbers on screen are exactly the
// numbers the daily job wrote, which is the whole point of the paper trail.

type Status = "green" | "amber" | "red" | "error";

interface Row {
  run_id: string;
  et_day: string;
  check_key: string;
  plain_english_name: string;
  status: Status;
  left_label: string | null;
  left_value: string | null;
  right_label: string | null;
  right_value: string | null;
  diff_value: string | null;
  tolerance_note: string | null;
  what_to_do: string | null;
  ran_at: string;
}

interface HistoryPoint {
  check_key: string;
  et_day: string;
  status: Status;
}

interface Payload {
  lastRunAt: string | null;
  etDay: string | null;
  counts: Partial<Record<Status, number>>;
  rows: Row[];
  history: HistoryPoint[];
}

const STATUS_WORD: Record<Status, string> = {
  green: "agrees",
  amber: "needs a look",
  red: "disagrees",
  error: "could not run",
};

function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function whenLabel(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function AccuracyClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/accuracy", { cache: "no-store" });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      setData((await res.json()) as Payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the checks");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const runNow = useCallback(async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/accuracy", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await load();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The run failed");
    } finally {
      setRunning(false);
    }
  }, [load]);

  // 30 days of squares per check, oldest first, from the stored history.
  const stripByCheck = useMemo(() => {
    const map = new Map<string, Map<string, Status>>();
    for (const h of data?.history || []) {
      if (!map.has(h.check_key)) map.set(h.check_key, new Map());
      map.get(h.check_key)!.set(h.et_day, h.status);
    }
    const today = data?.etDay;
    const days = today
      ? Array.from({ length: 30 }, (_, i) => shiftDay(today, -(29 - i)))
      : [];
    return { map, days };
  }, [data]);

  const counts = data?.counts || {};
  const rows = data?.rows || [];

  return (
    <div className="acc">
      <div className="acc-head">
        <div>
          <h1>Accuracy</h1>
          <p className="acc-sub">
            Every day the money system is re-checked from independent directions. Each row shows the
            two numbers that were compared and how far apart they were. Green means they agree.
          </p>
        </div>
        <div className="acc-actions">
          <span className="acc-when">Last run {whenLabel(data?.lastRunAt || null)}</span>
          <button className="acc-run" onClick={runNow} disabled={running}>
            {running ? "Running the checks..." : "Run now"}
          </button>
        </div>
      </div>

      {error ? <div className="acc-empty">{error}</div> : null}

      {rows.length > 0 ? (
        <div className="acc-tally">
          <span className="acc-pill">
            <span className="acc-dot green" /> <b>{counts.green || 0}</b> agree
          </span>
          <span className="acc-pill">
            <span className="acc-dot amber" /> <b>{counts.amber || 0}</b> need a look
          </span>
          <span className="acc-pill">
            <span className="acc-dot red" /> <b>{counts.red || 0}</b> disagree
          </span>
          {counts.error ? (
            <span className="acc-pill">
              <span className="acc-dot error" /> <b>{counts.error}</b> could not run
            </span>
          ) : null}
        </div>
      ) : null}

      {rows.length === 0 && !error ? (
        <div className="acc-empty">
          No checks have been recorded yet. Press Run now to take the first reading.
        </div>
      ) : null}

      {rows.length > 0 ? (
        <div className="acc-list">
          {rows.map((r) => {
            const squares = stripByCheck.map.get(r.check_key);
            return (
              <div key={r.check_key} className={`acc-row ${r.status}`}>
                <span className={`acc-dot ${r.status}`} title={STATUS_WORD[r.status]} />

                <div>
                  <span className="acc-name">{r.plain_english_name}</span>
                  {r.tolerance_note ? (
                    <span className="acc-tol" title={r.tolerance_note}>
                      {r.tolerance_note.length > 130
                        ? `${r.tolerance_note.slice(0, 130)}...`
                        : r.tolerance_note}
                    </span>
                  ) : null}
                  <div className="acc-strip">
                    {stripByCheck.days.map((day) => (
                      <span
                        key={day}
                        className={`acc-sq ${squares?.get(day) || ""}`}
                        title={`${day}: ${squares?.get(day) || "no run"}`}
                      />
                    ))}
                  </div>
                </div>

                <div className="acc-side">
                  <span className="acc-label">{r.left_label || ""}</span>
                  <span className="acc-val">{r.left_value || ""}</span>
                </div>

                <div className="acc-side">
                  <span className="acc-label">{r.right_label || ""}</span>
                  <span className="acc-val">{r.right_value || ""}</span>
                </div>

                <div className={`acc-diff ${r.status === "red" ? "hot" : ""}`}>
                  {r.diff_value || ""}
                </div>

                {r.status !== "green" && r.what_to_do ? (
                  <div className="acc-todo">{r.what_to_do}</div>
                ) : null}
              </div>
            );
          })}
        </div>
      ) : null}

      <p className="acc-foot">
        This page only shows readings that were already taken and saved; it never works anything out
        while you are looking at it. The small squares are the last 30 days, oldest on the left. The
        grey line under each name is the rule that decides green from amber from red, written out so
        no judgement call is hidden.
      </p>
    </div>
  );
}
