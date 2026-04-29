"use client";

/**
 * Phase B6a — minimal debug UI for the v2 nutrition pipeline.
 *
 * Hardcoded form controls — no production polish, no auto-suggest, no
 * distribution editor. Just enough to fire the pipeline against a real
 * client and observe each pipeline stage transition + final outcome.
 *
 * Production coach UI is B6b.
 */

import React, { useState, useEffect, useRef, useCallback } from "react";

const ALL_BUILDS = ["recomp", "shred", "bulk", "lean_gain", "endurance", "maintain"];
const ALL_DISTS = [
  "standard_3_meal",
  "lunch_centered_3_meal",
  "standard_4_meal",
  "athlete_5_meal",
  "bodybuilder_6_meal",
  "endurance_5_meal_training_day",
  "endurance_3_meal_rest_day",
];
const ALL_DIETS = ["omnivore", "vegetarian", "pescatarian", "vegan"];
const ALL_ALLERGIES = [
  "allergy_dairy",
  "allergy_eggs",
  "allergy_fish",
  "allergy_gluten",
  "allergy_peanuts",
  "allergy_sesame",
  "allergy_shellfish",
  "allergy_soy",
  "allergy_sulfites",
  "allergy_tree_nuts",
  "intolerance_lactose",
];
const ALL_MEDICAL = [
  "medical_hbp",
  "medical_diabetes_t2",
  "medical_kidney",
  "medical_ibs",
  "medical_pregnant_nursing",
  "medical_gout",
  "medical_reflux",
  "medical_pcos",
];
const ALL_ACTIVITY = ["sedentary", "light", "moderate", "high", "very_high"];

interface JobState {
  id: number;
  status: "pending" | "running" | "complete" | "failed" | "cancelled";
  current_step: string | null;
  plan_id: number | null;
  pdf_signed_url: string | null;
  audit_summary: unknown;
  error_kind: string | null;
  error_details: unknown;
  worker_started_at: string | null;
  worker_finished_at: string | null;
  generation_diagnostics: unknown;
  created_at: string;
  updated_at: string;
}

export default function DebugNutritionV2Page() {
  // Form state
  const [clientId, setClientId] = useState("35593");
  const [sex, setSex] = useState<"male" | "female">("male");
  const [activity, setActivity] = useState("moderate");
  const [build, setBuild] = useState("recomp");
  const [diet, setDiet] = useState<string>("omnivore");
  const [allergies, setAllergies] = useState<string[]>([]);
  const [medical, setMedical] = useState<string[]>([]);
  const [complexity, setComplexity] = useState("intermediate");
  const [distribution, setDistribution] = useState("standard_3_meal");
  const [reason, setReason] = useState("");

  // Job state
  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState<number | null>(null);
  const [job, setJob] = useState<JobState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  useEffect(() => () => stopPolling(), [stopPolling]);

  const toggle = (arr: string[], setArr: (s: string[]) => void, val: string) => {
    setArr(arr.includes(val) ? arr.filter((x) => x !== val) : [...arr, val]);
  };

  const submit = async () => {
    setError(null);
    setJob(null);
    setJobId(null);
    setSubmitting(true);
    try {
      const body = {
        client_id: parseInt(clientId, 10),
        sex,
        activity_level: activity,
        build_type: build,
        allergy_flags: allergies,
        medical_flags: medical,
        dietary_style: diet || null,
        plan_complexity: complexity,
        distribution_template: distribution,
        reason_for_generation: reason || undefined,
      };
      const r = await fetch("/api/nutrition/generate-plan-v2", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data.error || "request failed");
        setSubmitting(false);
        return;
      }
      setJobId(data.jobId);
      // Start polling
      pollRef.current = setInterval(async () => {
        const sr = await fetch(`/api/nutrition/generate-plan-v2/${data.jobId}`);
        const sd = await sr.json();
        if (sr.ok && sd.job) {
          setJob(sd.job);
          if (sd.job.status === "complete" || sd.job.status === "failed" || sd.job.status === "cancelled") {
            stopPolling();
            setSubmitting(false);
          }
        }
      }, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSubmitting(false);
    }
  };

  const cancel = async () => {
    if (!jobId) return;
    await fetch(`/api/nutrition/generate-plan-v2/${jobId}`, { method: "DELETE" });
  };

  const elapsed =
    job?.worker_started_at
      ? Math.floor(
          (new Date(job.worker_finished_at || new Date()).getTime() -
            new Date(job.worker_started_at).getTime()) /
            1000,
        )
      : null;

  return (
    <div style={{ padding: 24, fontFamily: "system-ui, sans-serif", maxWidth: 1100 }}>
      <h1 style={{ marginBottom: 4 }}>Nutrition v2 — debug pipeline runner</h1>
      <p style={{ color: "#666", marginTop: 0, fontSize: 13 }}>
        Hardcoded form. Fires the full v2 pipeline against a real client. Polls every 1.5s.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, marginTop: 24 }}>
        {/* ---- LEFT: Form ---- */}
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 6 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>Inputs</h2>

          <Row label="client_id">
            <input value={clientId} onChange={(e) => setClientId(e.target.value)} style={inp} />
          </Row>

          <Row label="sex">
            <select value={sex} onChange={(e) => setSex(e.target.value as "male" | "female")} style={inp}>
              <option value="male">male</option>
              <option value="female">female</option>
            </select>
          </Row>

          <Row label="activity">
            <select value={activity} onChange={(e) => setActivity(e.target.value)} style={inp}>
              {ALL_ACTIVITY.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </Row>

          <Row label="build">
            <select value={build} onChange={(e) => setBuild(e.target.value)} style={inp}>
              {ALL_BUILDS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </Row>

          <Row label="dietary style">
            <select value={diet} onChange={(e) => setDiet(e.target.value)} style={inp}>
              <option value="">(none)</option>
              {ALL_DIETS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Row>

          <Row label="distribution">
            <select value={distribution} onChange={(e) => setDistribution(e.target.value)} style={inp}>
              {ALL_DISTS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </Row>

          <Row label="complexity">
            <select value={complexity} onChange={(e) => setComplexity(e.target.value)} style={inp}>
              <option value="beginner">beginner (5)</option>
              <option value="intermediate">intermediate (7)</option>
              <option value="advanced">advanced (10)</option>
            </select>
          </Row>

          <Row label="allergies">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ALL_ALLERGIES.map((a) => (
                <label key={a} style={chip(allergies.includes(a))}>
                  <input
                    type="checkbox"
                    checked={allergies.includes(a)}
                    onChange={() => toggle(allergies, setAllergies, a)}
                    style={{ marginRight: 4 }}
                  />
                  {a.replace(/^(allergy_|intolerance_)/, "")}
                </label>
              ))}
            </div>
          </Row>

          <Row label="medical">
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {ALL_MEDICAL.map((m) => (
                <label key={m} style={chip(medical.includes(m))}>
                  <input
                    type="checkbox"
                    checked={medical.includes(m)}
                    onChange={() => toggle(medical, setMedical, m)}
                    style={{ marginRight: 4 }}
                  />
                  {m.replace(/^medical_/, "")}
                </label>
              ))}
            </div>
          </Row>

          <Row label="reason">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="optional — surfaced in diagnostics"
              style={inp}
            />
          </Row>

          <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
            <button
              onClick={submit}
              disabled={submitting}
              style={{
                padding: "8px 16px",
                background: submitting ? "#999" : "#2563eb",
                color: "white",
                border: 0,
                borderRadius: 4,
                cursor: submitting ? "wait" : "pointer",
              }}
            >
              {submitting ? "Generating..." : "Generate Plan (v2)"}
            </button>
            {jobId && job?.status !== "complete" && job?.status !== "failed" && (
              <button
                onClick={cancel}
                style={{
                  padding: "8px 16px",
                  background: "white",
                  color: "#dc2626",
                  border: "1px solid #dc2626",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Cancel job {jobId}
              </button>
            )}
          </div>
        </div>

        {/* ---- RIGHT: Job status ---- */}
        <div style={{ border: "1px solid #ddd", padding: 16, borderRadius: 6 }}>
          <h2 style={{ fontSize: 14, marginTop: 0 }}>
            Job status {jobId ? `· #${jobId}` : ""}
          </h2>

          {error && (
            <div style={{ background: "#fee", border: "1px solid #fcc", padding: 8, borderRadius: 4 }}>
              <strong>Submit error:</strong> {error}
            </div>
          )}

          {!jobId && !error && (
            <div style={{ color: "#999" }}>No job yet. Submit a request to start.</div>
          )}

          {jobId && !job && (
            <div style={{ color: "#999" }}>Job {jobId} created. Polling…</div>
          )}

          {job && (
            <div>
              <div style={{ fontSize: 13, marginBottom: 12 }}>
                <StatusPill status={job.status} />
                {job.current_step && (
                  <span style={{ marginLeft: 8, color: "#555" }}>
                    {job.current_step}
                  </span>
                )}
                {elapsed !== null && (
                  <span style={{ marginLeft: 8, color: "#888" }}>· {elapsed}s elapsed</span>
                )}
              </div>

              {job.status === "complete" && job.pdf_signed_url && (
                <div style={{ background: "#efe", border: "1px solid #cfc", padding: 12, borderRadius: 4 }}>
                  <strong>✓ Plan complete.</strong>{" "}
                  <a href={job.pdf_signed_url} target="_blank" rel="noopener noreferrer" style={{ color: "#2563eb" }}>
                    Download PDF (v2_v?_…pdf)
                  </a>
                  <div style={{ fontSize: 12, color: "#555", marginTop: 4 }}>
                    plan_id: {job.plan_id} · 2hr signed URL
                  </div>
                </div>
              )}

              {(job.status === "failed" || job.status === "cancelled") && (
                <div style={{ background: "#fff5f5", border: "1px solid #fcc", padding: 12, borderRadius: 4 }}>
                  <strong>{job.status === "cancelled" ? "Cancelled" : "Failed"}</strong>
                  {job.error_kind && <span> — kind: <code>{job.error_kind}</code></span>}
                  {job.error_details !== null && (
                    <pre style={pre}>{JSON.stringify(job.error_details, null, 2)}</pre>
                  )}
                </div>
              )}

              {job.audit_summary !== null && (
                <details style={{ marginTop: 12 }}>
                  <summary style={{ cursor: "pointer", color: "#2563eb" }}>Audit summary</summary>
                  <pre style={pre}>{JSON.stringify(job.audit_summary, null, 2)}</pre>
                </details>
              )}

              {job.generation_diagnostics !== null && (
                <details style={{ marginTop: 8 }}>
                  <summary style={{ cursor: "pointer", color: "#2563eb" }}>Generation diagnostics</summary>
                  <pre style={pre}>{JSON.stringify(job.generation_diagnostics, null, 2)}</pre>
                </details>
              )}

              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", color: "#2563eb" }}>Raw job row</summary>
                <pre style={pre}>{JSON.stringify(job, null, 2)}</pre>
              </details>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ----- Helpers -----

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 12, marginBottom: 10, alignItems: "flex-start" }}>
      <label style={{ flex: "0 0 110px", fontSize: 12, color: "#555", paddingTop: 4 }}>{label}</label>
      <div style={{ flex: 1 }}>{children}</div>
    </div>
  );
}

function StatusPill({ status }: { status: JobState["status"] }) {
  const colors: Record<JobState["status"], { bg: string; fg: string }> = {
    pending: { bg: "#fef3c7", fg: "#92400e" },
    running: { bg: "#dbeafe", fg: "#1e3a8a" },
    complete: { bg: "#d1fae5", fg: "#065f46" },
    failed: { bg: "#fee2e2", fg: "#991b1b" },
    cancelled: { bg: "#e5e7eb", fg: "#374151" },
  };
  const { bg, fg } = colors[status];
  return (
    <span
      style={{
        display: "inline-block",
        background: bg,
        color: fg,
        padding: "2px 8px",
        borderRadius: 4,
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
      }}
    >
      {status}
    </span>
  );
}

const inp: React.CSSProperties = {
  width: "100%",
  padding: "6px 8px",
  fontSize: 13,
  border: "1px solid #ccc",
  borderRadius: 4,
};

const pre: React.CSSProperties = {
  background: "#f5f5f5",
  padding: 8,
  fontSize: 11,
  overflow: "auto",
  maxHeight: 280,
  borderRadius: 4,
};

function chip(active: boolean): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 11,
    padding: "3px 6px",
    background: active ? "#dbeafe" : "#f3f4f6",
    color: active ? "#1e3a8a" : "#444",
    border: `1px solid ${active ? "#93c5fd" : "#e5e7eb"}`,
    borderRadius: 12,
    cursor: "pointer",
    userSelect: "none",
  };
}
