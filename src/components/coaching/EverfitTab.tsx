"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw, Upload } from "lucide-react";
import EverfitDashboard from "./everfit/EverfitDashboard";
import type { Client } from "@/lib/types";
import type { ReportDetail, StoredReport } from "@/lib/everfit/types";
import { MAX_IMPORT_BYTES, parseImport } from "@/lib/everfit/validation";
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
  const [preview, setPreview] = useState<ReportDetail | null>(null);
  const [source, setSource] = useState<unknown>(null);
  const [importCoach, setImportCoach] = useState("Shiraad");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
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
  async function readFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setPreview(null);
    setSource(null);
    try {
      if (file.size > MAX_IMPORT_BYTES)
        throw new Error("Choose a JSON report smaller than 2 MB.");
      const raw = JSON.parse(await file.text());
      const document = parseImport(raw, importCoach);
      setSource(raw);
      setPreview({
        report: {
          id: "local-preview",
          coach_name: importCoach,
          review_date: document.review_date,
          imported_at: "",
          preliminary: true,
          client_count: document.clients.length,
          document,
        },
        currentClients: [],
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Invalid report file.");
    }
  }
  async function saveReport() {
    if (!source || !preview) return;
    setSaving(true);
    setError("");
    try {
      const result = await jsonResponse(
        await fetch("/api/coaching/everfit/reports", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ coachName: importCoach, report: source }),
        }),
      );
      setPreview(null);
      setSource(null);
      setCoach("");
      await load();
      setId(result.id);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the report.");
    } finally {
      setSaving(false);
    }
  }
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
              setPreview(null);
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
              setPreview(null);
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
      {isAdmin && (
        <details className={styles.details}>
          <summary>
            <Upload size={13} style={{ display: "inline", marginRight: 5 }} />{" "}
            Import a reviewed report
          </summary>
          <div className={styles.panel}>
            <h3>Preview, verify, then save</h3>
            <p>
              Upload the reviewed JSON export. CCOS will check email matches
              against Supabase before storing a new report. No client roster
              fields are changed.
            </p>
            <form onSubmit={(e) => e.preventDefault()}>
              <label>
                CCOS coach
                <select
                  value={importCoach}
                  onChange={(e) => {
                    setImportCoach(e.target.value);
                    setSource(null);
                    setPreview(null);
                  }}
                >
                  {importCoaches.map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label>
                Report JSON
                <input
                  type="file"
                  accept="application/json,.json"
                  onChange={(e) => {
                    void readFile(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
              </label>
            </form>
            <div className={styles.buttonRow}>
              <button
                className={styles.primary}
                disabled={!preview || saving}
                onClick={saveReport}
              >
                {saving ? "Saving…" : "Save reviewed report to Supabase"}
              </button>
              {preview && (
                <button
                  onClick={() => {
                    setPreview(null);
                    setSource(null);
                  }}
                >
                  Discard local preview
                </button>
              )}
            </div>
            <p className={styles.hint}>
              Preview data stays in this browser until you save. Re-importing
              the same report is safe and does not create a duplicate.
            </p>
          </div>
        </details>
      )}
      {!preview && !detail && (
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
                  ? "Import the reviewed Shaun pilot to create the first report."
                  : "Your weekly reviews will appear here after an administrator imports them."}
              </p>
              <p className={styles.hint}>
                Requested cadence: Saturday at 18:00 Pakistan time. Automatic
                capture has not been enabled.
              </p>
            </>
          )}
        </div>
      )}
      {(preview || detail) && (
        <EverfitDashboard
          key={preview ? "preview" : id}
          detail={(preview || detail)!}
          localPreview={!!preview}
        />
      )}
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
