"use client";
import { useState } from "react";
import styles from "./everfit.module.css";
export default function EverfitClientQuestion({
  reportId,
  everfitId,
}: {
  reportId: string;
  everfitId: string;
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <div className={styles.panel}>
      <h3>Ask about this client</h3>
      <p className={styles.hint}>
        Uses this report and verified current CCOS context. Answers are saved
        with the report; no messages or client edits are made.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          setAnswer("");
          try {
            const response = await fetch("/api/coaching/everfit/ask", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ reportId, everfitId, question }),
            });
            const data = await response.json();
            if (!response.ok)
              throw new Error(data.error || "Unable to answer.");
            setAnswer(data.answer);
          } catch (e) {
            setError(e instanceof Error ? e.message : "Unable to answer.");
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Question
          <input
            required
            maxLength={1500}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What should we follow up on before renewal?"
          />
        </label>
        <button disabled={busy || !question.trim()}>
          {busy ? "Reading context…" : "Ask"}
        </button>
      </form>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      {answer && (
        <div role="status" className={styles.prose}>
          {answer}
        </div>
      )}
    </div>
  );
}
