"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import EverfitClientQuestion from "./everfit/EverfitClientQuestion";
import EverfitDashboard from "./everfit/EverfitDashboard";
import type { Client } from "@/lib/types";
import type { ReportDetail, StoredReport } from "@/lib/everfit/types";
import EverfitSync from "./everfit/EverfitSync";
import styles from "./everfit/everfit.module.css";

async function jsonResponse(response: Response) {
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "The request failed. Please try again.");
  return value;
}
export default function EverfitTab({
  clients,
  isAdmin,
}: {
  clients: Client[];
  isAdmin: boolean;
}) {
  const [reports, setReports] = useState<StoredReport[]>([]);
  const [coach, setCoach] = useState("");
  const [id, setId] = useState("");
  const [detail, setDetail] = useState<ReportDetail | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [accessMessage, setAccessMessage] = useState("");
  const [accessEmail, setAccessEmail] = useState("");
  const [accessCoach, setAccessCoach] = useState("Shiraad");
  const [refresh, setRefresh] = useState(0);
  const sequence = useRef(0);
  const coaches = [...new Set(reports.map((r) => r.coach_name))].sort();
  const importCoaches = [
    ...new Set(["Shiraad", ...clients.map((c) => c.coachName).filter(Boolean)]),
  ].sort();
  const filtered = reports.filter((r) => !coach || r.coach_name === coach);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const value = await jsonResponse(
        await fetch("/api/coaching/everfit/reports", { cache: "no-store" }),
      );
      setReports(value.reports);
      setId((old) =>
        value.reports.some((r: StoredReport) => r.id === old)
          ? old
          : (value.reports[0]?.id ?? ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to load reports.");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load, refresh]);
  useEffect(() => {
    const controller = new AbortController();
    const requestId = ++sequence.current;
    setDetail(null);
    if (!id) return () => controller.abort();
    fetch(`/api/coaching/everfit/reports?id=${encodeURIComponent(id)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(jsonResponse)
      .then((value) => {
        if (requestId === sequence.current) setDetail(value);
      })
      .catch((e) => {
        if (e.name !== "AbortError" && requestId === sequence.current)
          setError(e.message);
      });
    return () => controller.abort();
  }, [id, refresh]);
  return (
    <section>
      <div className={styles.toolbar}>
        <div>
          <h2>Everfit</h2>
          <p>Weekly client context, activity, and follow-through.</p>
        </div>
        <div className={styles.history}>
          <select
            aria-label="Coach view"
            value={coach}
            onChange={(e) => {
              const next = e.target.value;
              setCoach(next);
              setId(
                reports.find((r) => !next || r.coach_name === next)?.id ?? "",
              );
            }}
          >
            <option value="">All coaches</option>
            {coaches.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            aria-label="Report history"
            value={id}
            onChange={(e) => {
              setId(e.target.value);
            }}
          >
            <option value="" disabled>
              Select a report
            </option>
            {filtered.map((r) => (
              <option key={r.id} value={r.id}>
                {r.review_date} · {r.coach_name} ·{" "}
                {r.preliminary ? "Preliminary" : "Weekly"} ·{" "}
                {new Date(r.imported_at).toLocaleTimeString("en-GB", {
                  timeZone: "Asia/Karachi",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </option>
            ))}
          </select>
          <button disabled={loading} onClick={() => setRefresh((v) => v + 1)}>
            <RefreshCw
              size={14}
              style={{ display: "inline", marginRight: 6 }}
            />
            {loading ? "Loading…" : "Refresh reports"}
          </button>
        </div>
      </div>
      {error && (
        <div role="alert" className={styles.error}>
          {error}
        </div>
      )}
      <EverfitClientQuestion
        key={`chat-${coach}-${refresh}`}
        coachName={coach || undefined}
      />
      {isAdmin && <EverfitSync onSaved={load} />}
      {!detail && (
        <div className={styles.panel}>
          {loading ? (
            "Loading report history…"
          ) : id ? (
            "Loading the selected report…"
          ) : (
            <>
              <h3>No reports available yet</h3>
              <p>
                {isAdmin
                  ? "Click Sync all coaches to create your first reports."
                  : "Your reviews will appear here after your team runs a sync."}
              </p>
              <p className={styles.hint}>
                Each sync saves a dated review. Earlier reports remain available
                in the report history.
              </p>
            </>
          )}
        </div>
      )}
      {detail && <EverfitDashboard key={id} detail={detail} />}
      {isAdmin && (
        <details className={styles.details}>
          <summary>Coach access settings</summary>
          <div className={styles.panel}>
            <h3>Link a coach&apos;s CCOS login</h3>
            <p>
              Existing recognized coach logins are supported. Use this for
              alternate login emails; the user must already have Coaching
              access.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setAccessMessage("Saving…");
                try {
                  await jsonResponse(
                    await fetch("/api/coaching/everfit/access", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        email: accessEmail,
                        coachName: accessCoach,
                      }),
                    }),
                  );
                  setAccessMessage("Coach view access saved.");
                } catch (e) {
                  setAccessMessage(
                    e instanceof Error ? e.message : "Unable to save.",
                  );
                }
              }}
            >
              <label>
                CCOS login email
                <input
                  type="email"
                  required
                  value={accessEmail}
                  onChange={(e) => setAccessEmail(e.target.value)}
                />
              </label>
              <label>
                Coach
                <select
                  value={accessCoach}
                  onChange={(e) => setAccessCoach(e.target.value)}
                >
                  {importCoaches.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <button type="submit">Save coach access</button>
            </form>
            <p aria-live="polite">{accessMessage}</p>
          </div>
        </details>
      )}
    </section>
  );
}
