"use client";

import { useState } from "react";
import { MAX_IMPORT_BYTES, parseImport } from "@/lib/everfit/validation";
import styles from "./everfit.module.css";

export default function EverfitManualReport({ coaches, onSaved }: {
  coaches: string[];
  onSaved: (id: string) => void;
}) {
  const [coach, setCoach] = useState(coaches.includes("Shiraad") ? "Shiraad" : coaches[0] ?? "");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  return <details className={styles.details}>
    <summary>Save an assistant-prepared review</summary>
    <div className={styles.panel}>
      <h3>Weekly manual review</h3>
      <p>Ask your assistant to review a coach in Everfit and save the completed review here. Earlier reports remain available.</p>
      <form onSubmit={async (event) => {
        event.preventDefault();
        setError(""); setMessage(""); setBusy(true);
        try {
          if (new TextEncoder().encode(text).length > MAX_IMPORT_BYTES) throw new Error("Report exceeds 2 MB.");
          const report = JSON.parse(text);
          const parsed = parseImport(report, coach);
          setMessage(`Saving ${parsed.clients.length} client reviews…`);
          const response = await fetch("/api/coaching/everfit/reports", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ coachName: coach, report }),
          });
          const saved = await response.json();
          if (!response.ok) throw new Error(saved.error || "Unable to save report.");
          if (typeof saved.id !== "string") throw new Error("Save response did not include a report ID.");
          const check = await fetch(`/api/coaching/everfit/reports?id=${encodeURIComponent(saved.id)}`, { cache: "no-store" });
          const detail = await check.json();
          if (!check.ok || detail.report?.id !== saved.id || detail.report?.client_count !== parsed.clients.length)
            throw new Error("The save was submitted, but read-back verification failed. Retrying the same report is safe.");
          setText("");
          setMessage(`Saved and verified ${parsed.clients.length} client reviews for ${coach}. Report ID: ${saved.id}`);
          onSaved(saved.id);
        } catch (e) {
          setMessage(""); setError(e instanceof Error ? e.message : "Unable to save report.");
        } finally { setBusy(false); }
      }}>
        <label>Review coach<select aria-label="Review coach" value={coach} disabled={busy} onChange={e => setCoach(e.target.value)}>
          {coaches.map(c => <option key={c}>{c}</option>)}
        </select></label>
        <label>Prepared report<textarea aria-label="Prepared report" value={text} disabled={busy} onChange={e => setText(e.target.value)} required rows={5} spellCheck={false} autoComplete="off" style={{width:"100%",padding:12,borderRadius:8,background:"var(--bg-secondary)",color:"var(--text-primary)",border:"1px solid var(--border-primary)",fontFamily:"monospace"}} /></label>
        <button disabled={busy || !text.trim() || !coach} type="submit">{busy ? "Saving and verifying…" : "Save completed review"}</button>
      </form>
      {message && <p role="status">{message}</p>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </div>
  </details>;
}
