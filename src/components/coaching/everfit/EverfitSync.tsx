"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import styles from "./everfit.module.css";
type Job = {
  failures?:{name:string;coach:string;error:string}[];
  status: string;
  done: number;
  total: number;
  failed?: number;
  message: string;
  runId?: string;
  cancelRequested?: boolean;
};
type Reply = { connected?: boolean; error?: string; job?: Job | null };
function connector(command: string): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => {
      window.removeEventListener("message", receive);
      reject(
        new Error(
          "The Everfit browser connector is not connected. Complete its one-time installation in Chrome, then refresh CCOS.",
        ),
      );
    }, 4000);
    function receive(event: MessageEvent) {
      if (
        event.origin !== location.origin ||
        event.source !== window ||
        event.data?.channel !== "ccos-everfit-response" ||
        event.data.id !== id
      )
        return;
      clearTimeout(timer);
      window.removeEventListener("message", receive);
      if (event.data.value?.error) reject(new Error(event.data.value.error));
      else resolve(event.data.value);
    }
    window.addEventListener("message", receive);
    window.postMessage(
      { channel: "ccos-everfit-request", id, command },
      location.origin,
    );
  });
}
export default function EverfitSync({ onSaved }: { onSaved: () => void }) {
  const [connected, setConnected] = useState(false),
    [job, setJob] = useState<Job | null>(null),
    [error, setError] = useState(""),
    [starting, setStarting] = useState(false);
  const lastFinished = useRef("");
  const refresh = useCallback(async () => {
    try {
      const reply = await connector("STATUS");
      setConnected(!!reply.connected);
      setJob(reply.job ?? null);
      if (
        reply.job &&
        ["completed", "partial"].includes(reply.job.status) &&
        `${reply.job.runId}:${reply.job.status}:${reply.job.done}` !== lastFinished.current
      ) {
        lastFinished.current = `${reply.job.runId}:${reply.job.status}:${reply.job.done}`;
        onSaved();
      }
    } catch {
      setConnected(false);
    }
  }, [onSaved]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [refresh]);
  const busy =
    starting || job?.status === "running" || job?.status === "starting";
  return (
    <div className={styles.panel}>
      <div className={styles.toolbar}>
        <div>
          <h3>Keep every coach up to date</h3>
          <p>
            Read Everfit conversations and recent activity, combine them with
            CCOS, and save the reports automatically.
          </p>
        </div>
        <button
          className={styles.primary}
          disabled={busy}
          onClick={async () => {
            setStarting(true);
            setError("");
            try {
              await connector("START");
              await refresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setStarting(false);
            }
          }}
        >
          <RefreshCw size={14} style={{ display: "inline", marginRight: 7 }} />
          {busy
            ? "Syncing…"
            : ["interrupted", "partial"].includes(job?.status || "")
              ? "Resume sync"
              : "Sync all coaches"}
        </button>
      </div>
      <p className={styles.hint}>
        {connected
          ? "Browser connected. Keep Chrome, Everfit and CCOS open while syncing."
          : "Browser connector not connected. A one-time Chrome installation is needed for automatic reading."}
      </p>
      {job && (
        <div aria-live="polite">
          <p>{job.message}</p>
          {job.total > 0 && (
            <>
              <progress
                style={{ width: "100%" }}
                max={job.total}
                value={job.done}
              />
              <p>
                {job.done} of {job.total} clients saved
                {job.failed ? ` · ${job.failed} need attention` : ""}
              </p>
            </>
          )}
          {!!job.failures?.length && <details><summary>Clients needing attention</summary><ul>{job.failures.map((f,i)=><li key={`${f.name}-${i}`}>{f.name} · {f.coach}: {f.error}</li>)}</ul></details>}
          {busy && (
            <button
              disabled={job.cancelRequested}
              onClick={async () => {
                try {
                  await connector("CANCEL");
                  await refresh();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              {job.cancelRequested ? "Stopping…" : "Stop and save progress"}
            </button>
          )}
        </div>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
