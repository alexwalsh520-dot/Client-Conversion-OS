"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { INTAKE_QUESTIONS } from "@/lib/ads-leaderboard/intake";

// ── Self-contained theme (this is a public page, no CCOS shell) ──────────────
const C = {
  bg: "#0a0a0b",
  bg2: "#0f0f12",
  card: "#15151a",
  line: "#26262e",
  text: "#f4f4f6",
  sub: "#a0a0ad",
  gold: "#c9a96e",
  goldInk: "#1a1205",
  green: "#5fdb8e",
  danger: "#ef6b6b",
};

const STEPS = ["Start", "Your offer", "Your script", "Record", "Done"] as const;

// Rotating motivation shown in the sticky banner so people don't fall off.
const MOTIVATION = [
  "🔥 A great ad can earn you up to $10,000/month. You're minutes away.",
  "💰 We run these ads at 10x ROAS. Your job is just the video — we handle the spend.",
  "🚀 Most people never start. You already did. Keep going.",
  "🎯 One good 30-second video can change your month. Don't stop now.",
  "🏆 The leaderboard rewards the best ad. That could be yours.",
];

type Phase = "loading" | "invalid" | "flow" | "done";

interface EntryState {
  status: string;
  step: number;
  intake: Record<string, string>;
  script: string | null;
  contestant_name: string | null;
}

export default function CompeteFlow({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [step, setStep] = useState(0);
  const [intake, setIntake] = useState<Record<string, string>>({});
  const [name, setName] = useState("");
  const [script, setScript] = useState<string | null>(null);
  const [motivationIdx, setMotivationIdx] = useState(0);

  // ── Load / resume ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/ads-leaderboard/progress?token=${encodeURIComponent(token)}`);
        if (!res.ok) {
          if (!cancelled) setPhase("invalid");
          return;
        }
        const { entry } = (await res.json()) as { entry: EntryState };
        if (cancelled) return;
        if (entry.status === "submitted" || entry.status === "live") {
          setPhase("done");
          return;
        }
        setIntake(entry.intake || {});
        setName(entry.contestant_name || "");
        setScript(entry.script || null);
        setStep(Math.min(entry.step || 0, STEPS.length - 1));
        setPhase("flow");
      } catch {
        if (!cancelled) setPhase("invalid");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  // Rotate motivation every 7s.
  useEffect(() => {
    const id = setInterval(() => setMotivationIdx((i) => (i + 1) % MOTIVATION.length), 7000);
    return () => clearInterval(id);
  }, []);

  const saveProgress = useCallback(
    async (patch: { step?: number; intake?: Record<string, string>; contestantName?: string; status?: string }) => {
      try {
        await fetch("/api/ads-leaderboard/progress", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token, ...patch }),
        });
      } catch {
        /* best-effort; the next save will catch up */
      }
    },
    [token],
  );

  const goTo = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(next, STEPS.length - 1));
      setStep(clamped);
      saveProgress({ step: clamped, intake, contestantName: name });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [intake, name, saveProgress],
  );

  // ── Render gates ─────────────────────────────────────────────────────────────
  if (phase === "loading") {
    return <Shell><Center><p style={{ color: C.sub }}>Loading…</p></Center></Shell>;
  }
  if (phase === "invalid") {
    return (
      <Shell>
        <Center>
          <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>This link isn&apos;t valid</h1>
          <p style={{ color: C.sub, margin: 0, lineHeight: 1.6 }}>
            The contest link may be incorrect or expired. Reach out to your coach for a fresh one.
          </p>
        </Center>
      </Shell>
    );
  }
  if (phase === "done") {
    return <Shell><DoneScreen name={name} /></Shell>;
  }

  return (
    <Shell>
      {/* Sticky motivation banner */}
      <div
        style={{
          position: "sticky",
          top: 0,
          zIndex: 10,
          background: "rgba(201,169,110,0.12)",
          borderBottom: `1px solid ${C.line}`,
          backdropFilter: "blur(8px)",
          padding: "10px 16px",
          textAlign: "center",
          fontSize: 13.5,
          fontWeight: 600,
          color: C.gold,
        }}
      >
        {MOTIVATION[motivationIdx]}
      </div>

      <div style={{ maxWidth: 620, margin: "0 auto", padding: "20px 18px 80px" }}>
        <ProgressBar step={step} />

        {step === 0 && <StartStep onStart={() => goTo(1)} />}
        {step === 1 && (
          <IntakeStep
            intake={intake}
            setIntake={setIntake}
            name={name}
            setName={setName}
            onBack={() => goTo(0)}
            onNext={() => {
              saveProgress({ step: 2, intake, contestantName: name, status: "intake_done" });
              goTo(2);
            }}
          />
        )}
        {step === 2 && (
          <ScriptStep
            token={token}
            intake={intake}
            script={script}
            setScript={setScript}
            onBack={() => goTo(1)}
            onNext={() => goTo(3)}
          />
        )}
        {step === 3 && (
          <RecordStep
            token={token}
            script={script}
            onBack={() => goTo(2)}
            onDone={() => {
              setPhase("done");
            }}
          />
        )}
      </div>
    </Shell>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 0 — Start / ROI hook
// ════════════════════════════════════════════════════════════════════════════
function StartStep({ onStart }: { onStart: () => void }) {
  return (
    <div className="fade-up">
      <div style={{ fontSize: 44, marginBottom: 10 }}>🏆</div>
      <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 12px", letterSpacing: "-0.02em" }}>
        Make one ad. <span style={{ color: C.gold }}>Get paid when it wins.</span>
      </h1>
      <p style={{ color: C.sub, fontSize: 16, lineHeight: 1.65, margin: "0 0 20px" }}>
        You record one short video. We turn it into a real ad, put real money behind it, and run it at the same
        playbook that does <strong style={{ color: C.text }}>10x ROAS</strong>. When your ad performs, you earn a
        commission on the results — up to <strong style={{ color: C.gold }}>$10,000/month</strong> for a great one.
      </p>

      <div style={{ display: "grid", gap: 10, marginBottom: 24 }}>
        {[
          ["1", "Answer a few quick questions about your offer"],
          ["2", "We write you a custom script using our SONNET framework"],
          ["3", "Record it on your phone in one take + a 2-minute edit"],
          ["4", "We launch it. You climb the leaderboard and earn."],
        ].map(([n, t]) => (
          <div key={n} style={{ display: "flex", gap: 12, alignItems: "center", background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px" }}>
            <div style={{ width: 28, height: 28, flexShrink: 0, borderRadius: 8, background: "rgba(201,169,110,0.14)", color: C.gold, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{n}</div>
            <span style={{ fontSize: 14.5, color: C.text }}>{t}</span>
          </div>
        ))}
      </div>

      <p style={{ color: C.sub, fontSize: 13, margin: "0 0 18px", textAlign: "center" }}>
        Takes about 10 minutes. Your progress saves automatically — come back anytime with this link.
      </p>

      <Btn primary onClick={onStart}>Let&apos;s build my ad →</Btn>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — Intake
// ════════════════════════════════════════════════════════════════════════════
function IntakeStep({
  intake, setIntake, name, setName, onBack, onNext,
}: {
  intake: Record<string, string>;
  setIntake: (v: Record<string, string>) => void;
  name: string;
  setName: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [touched, setTouched] = useState(false);
  const set = (id: string, v: string) => setIntake({ ...intake, [id]: v });
  const missing = INTAKE_QUESTIONS.filter((q) => q.required && !(intake[q.id] || "").trim());
  const canNext = missing.length === 0;

  return (
    <div className="fade-up">
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Tell us about your offer</h2>
      <p style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 22px" }}>
        Be specific and real — the more honest your answers, the better your ad. There are no wrong answers.
      </p>

      <Field label="Your name">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First name" style={inputStyle} />
      </Field>

      {INTAKE_QUESTIONS.map((q) => {
        const showErr = touched && q.required && !(intake[q.id] || "").trim();
        return (
          <Field key={q.id} label={q.label + (q.required ? "" : "  (optional)")} help={q.help} error={showErr ? "Required" : undefined}>
            {q.type === "textarea" ? (
              <textarea value={intake[q.id] || ""} onChange={(e) => set(q.id, e.target.value)} placeholder={q.placeholder} rows={3} style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }} />
            ) : q.type === "select" ? (
              <div style={{ display: "grid", gap: 8 }}>
                {q.options!.map((opt) => {
                  const active = intake[q.id] === opt;
                  return (
                    <button key={opt} type="button" onClick={() => set(q.id, opt)} style={{ textAlign: "left", padding: "11px 14px", borderRadius: 10, cursor: "pointer", fontSize: 14.5, fontWeight: active ? 600 : 400, border: `1px solid ${active ? C.gold : C.line}`, background: active ? "rgba(201,169,110,0.12)" : "transparent", color: active ? C.gold : C.text }}>
                      {opt}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input value={intake[q.id] || ""} onChange={(e) => set(q.id, e.target.value)} placeholder={q.placeholder} style={inputStyle} />
            )}
          </Field>
        );
      })}

      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <Btn onClick={onBack}>← Back</Btn>
        <Btn primary onClick={() => { setTouched(true); if (canNext) onNext(); }}>
          {canNext ? "Write my script →" : `Fill ${missing.length} more`}
        </Btn>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — Script (SONNET)
// ════════════════════════════════════════════════════════════════════════════
function ScriptStep({
  token, intake, script, setScript, onBack, onNext,
}: {
  token: string;
  intake: Record<string, string>;
  script: string | null;
  setScript: (v: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  const generate = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const res = await fetch("/api/ads-leaderboard/script", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, intake }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate your script.");
      setScript(data.script);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [token, intake, setScript]);

  // Auto-generate on first arrival if there's no script yet.
  useEffect(() => {
    if (!script && !loading) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fade-up">
      <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Your custom script ✍️</h2>
      <p style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px" }}>
        Written with our in-house <strong style={{ color: C.gold }}>SONNET</strong> framework — the exact structure
        behind our highest-performing ads. Read it to camera. Make it yours.
      </p>

      {loading && (
        <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: 28, textAlign: "center" }}>
          <div className="spin" style={{ width: 28, height: 28, margin: "0 auto 12px", border: `3px solid ${C.line}`, borderTopColor: C.gold, borderRadius: "50%" }} />
          <p style={{ color: C.sub, margin: 0, fontSize: 14 }}>Writing your script…</p>
        </div>
      )}

      {!loading && err && (
        <div style={{ background: "rgba(239,107,107,0.08)", border: `1px solid ${C.danger}`, borderRadius: 12, padding: 16, marginBottom: 14 }}>
          <p style={{ color: C.danger, margin: "0 0 10px", fontSize: 14 }}>{err}</p>
          <Btn onClick={generate}>Try again</Btn>
        </div>
      )}

      {!loading && script && (
        <>
          <div style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 14, padding: "18px 18px", whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.7, color: C.text }}>
            {script}
          </div>
          <button type="button" onClick={generate} style={{ marginTop: 12, background: "transparent", border: "none", color: C.gold, fontSize: 13.5, fontWeight: 600, cursor: "pointer", padding: 0 }}>
            ↻ Not feeling it? Generate a different one
          </button>

          <div style={{ background: "rgba(95,219,142,0.07)", border: `1px solid rgba(95,219,142,0.25)`, borderRadius: 12, padding: "12px 14px", margin: "18px 0", fontSize: 13.5, color: C.text, lineHeight: 1.55 }}>
            💡 Don&apos;t memorize it word-for-word. Glance, look up, talk like a human. Energy beats perfection.
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Btn onClick={onBack}>← Back</Btn>
            <Btn primary onClick={onNext}>I&apos;ve got my script →</Btn>
          </div>
        </>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 3 — Record + edit + upload
// ════════════════════════════════════════════════════════════════════════════
const MAX_SECONDS = 240;

function RecordStep({
  token, script, onBack, onDone,
}: {
  token: string;
  script: string | null;
  onBack: () => void;
  onDone: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    const url = URL.createObjectURL(f);
    const accept = () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setFile(f);
      setPreviewUrl(url);
      setErr("");
    };
    const probe = document.createElement("video");
    probe.preload = "metadata";
    probe.muted = true;
    const finish = (d: number) => {
      if (Number.isFinite(d) && d > MAX_SECONDS + 1) {
        URL.revokeObjectURL(url);
        setErr("That video is over 4 minutes. Keep it short and punchy — under 60 seconds is ideal.");
      } else accept();
    };
    probe.onloadedmetadata = () => {
      if (probe.duration === Infinity || Number.isNaN(probe.duration)) {
        probe.ontimeupdate = () => { probe.ontimeupdate = null; finish(probe.duration); };
        probe.currentTime = 1e101;
      } else finish(probe.duration);
    };
    probe.onerror = accept;
    probe.src = url;
  }

  async function submit() {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    setErr("");
    try {
      const presignRes = await fetch("/api/ads-leaderboard/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, filename: file.name || "ad.mp4", contentType: file.type || "video/mp4" }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok) throw new Error(presign.error || "Could not start the upload.");

      await putWithProgress(presign.uploadUrl, file, presign.headers || {}, setProgress);

      const completeRes = await fetch("/api/ads-leaderboard/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, fileSize: file.size }),
      });
      const complete = await completeRes.json();
      if (!completeRes.ok) throw new Error(complete.error || "Could not finish the upload.");

      if (previewUrl) URL.revokeObjectURL(previewUrl);
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong. Please try again.");
      setUploading(false);
    }
  }

  return (
    <div className="fade-up">
      <input ref={inputRef} type="file" accept="video/*" capture="user" onChange={onFileChange} style={{ display: "none" }} />

      <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>Record &amp; submit 🎥</h2>
      <p style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px" }}>
        Film vertically, in good light, in one take. Hold the phone steady or prop it up. You can re-record as many
        times as you want before submitting.
      </p>

      {/* Collapsible script reminder */}
      {script && (
        <details style={{ background: C.card, border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.gold }}>📜 Show my script</summary>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.65, color: C.text, marginTop: 12 }}>{script}</div>
        </details>
      )}

      {/* CapCut edit guide */}
      <div style={{ background: C.bg2, border: `1px solid ${C.line}`, borderRadius: 14, padding: "16px 16px", marginBottom: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>✂️ Make it pop in CapCut (2 min, free)</h3>
        <ol style={{ margin: "0 0 12px", padding: "0 0 0 18px", color: C.sub, fontSize: 13.5, lineHeight: 1.7 }}>
          <li>Open CapCut → <strong style={{ color: C.text }}>New Project</strong> → add your clip.</li>
          <li>Tap <strong style={{ color: C.text }}>Captions → Auto Captions</strong> so the words show on screen.</li>
          <li>Trim any dead air at the start so it hooks instantly.</li>
          <li>Optional: drop a trending sound low in the background.</li>
          <li>Export at <strong style={{ color: C.text }}>1080p</strong>, then come back and upload below.</li>
        </ol>
        <a href="https://apps.apple.com/app/capcut-video-editor/id1500855883" target="_blank" rel="noopener noreferrer"
          style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "10px 14px", borderRadius: 10, background: "transparent", border: `1px solid ${C.gold}`, color: C.gold, fontSize: 13.5, fontWeight: 600, textDecoration: "none" }}>
           Get CapCut free →
        </a>
      </div>

      {previewUrl && (
        <video src={previewUrl} controls playsInline style={{ width: "100%", borderRadius: 14, background: "#000", marginBottom: 16, border: `1px solid ${C.line}` }} />
      )}

      {uploading ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: C.sub, margin: "0 0 10px", fontSize: 14 }}>Uploading your ad… {progress}%</p>
          <div style={{ height: 8, background: C.line, borderRadius: 999, overflow: "hidden" }}>
            <div style={{ height: "100%", width: `${progress}%`, background: C.gold, transition: "width 120ms linear" }} />
          </div>
          <p style={{ color: C.sub, margin: "12px 0 0", fontSize: 12 }}>Keep this page open until it finishes.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {err && <p style={{ color: C.danger, fontSize: 14, margin: 0, textAlign: "center" }}>{err}</p>}
          <Btn primary={!file} onClick={() => inputRef.current?.click()}>
            {file ? "Record again" : "🎬 Record my video"}
          </Btn>
          {file && <Btn primary onClick={submit}>Submit my ad 🚀</Btn>}
          {!file && (
            <button type="button" onClick={onBack} style={{ background: "transparent", border: "none", color: C.sub, fontSize: 13.5, cursor: "pointer", marginTop: 4 }}>
              ← Back to script
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// DONE
// ════════════════════════════════════════════════════════════════════════════
function DoneScreen({ name }: { name: string }) {
  return (
    <Center>
      <div style={{ fontSize: 52, marginBottom: 10 }}>🎉</div>
      <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 12px" }}>
        You&apos;re in{name ? `, ${name}` : ""}!
      </h1>
      <p style={{ color: C.sub, fontSize: 16, lineHeight: 1.65, margin: "0 0 8px", maxWidth: 460 }}>
        Your ad is submitted. Our team reviews it, puts real budget behind it, and launches it on Meta.
      </p>
      <p style={{ color: C.gold, fontSize: 16, fontWeight: 700, lineHeight: 1.6, margin: "0 0 20px", maxWidth: 460 }}>
        When it performs, you climb the leaderboard — and you get paid. Up to $10,000/month for a winner.
      </p>
      <p style={{ color: C.sub, fontSize: 13.5, margin: 0, maxWidth: 460 }}>
        Keep this link — we&apos;ll update it as your ad goes live so you can track how it&apos;s doing.
      </p>
    </Center>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Shared UI bits
// ════════════════════════════════════════════════════════════════════════════
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "var(--font-geist-sans), -apple-system, BlinkMacSystemFont, sans-serif" }}>
      {children}
      <style>{`
        .fade-up { animation: fadeUp .3s ease both; }
        @keyframes fadeUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
        .spin { animation: spin 0.8s linear infinite; }
        @keyframes spin { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "32px 22px" }}>
      {children}
    </div>
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 24 }}>
      {STEPS.slice(0, 4).map((_, i) => (
        <div key={i} style={{ flex: 1, height: 4, borderRadius: 999, background: i <= step ? C.gold : C.line, transition: "background .25s" }} />
      ))}
    </div>
  );
}

function Field({ label, help, error, children }: { label: string; help?: string; error?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 18 }}>
      <label style={{ display: "block", fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>{label}</label>
      {help && <p style={{ color: C.sub, fontSize: 12.5, margin: "0 0 8px", lineHeight: 1.45 }}>{help}</p>}
      {children}
      {error && <p style={{ color: C.danger, fontSize: 12, margin: "6px 0 0" }}>{error}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "12px 14px",
  fontSize: 15,
  borderRadius: 10,
  border: `1px solid ${C.line}`,
  background: C.bg2,
  color: C.text,
  outline: "none",
  fontFamily: "inherit",
  boxSizing: "border-box",
};

function Btn({ children, primary, onClick }: { children: React.ReactNode; primary?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        flex: 1,
        padding: "14px 18px",
        fontSize: 15.5,
        fontWeight: 700,
        borderRadius: 12,
        cursor: "pointer",
        border: primary ? "none" : `1px solid ${C.line}`,
        background: primary ? C.gold : "transparent",
        color: primary ? C.goldInk : C.text,
        fontFamily: "inherit",
      }}
    >
      {children}
    </button>
  );
}

function putWithProgress(url: string, file: File, headers: Record<string, string>, onProgress: (pct: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => { if (xhr.status >= 200 && xhr.status < 300) resolve(); else reject(new Error(`Upload failed (${xhr.status}).`)); };
    xhr.onerror = () => reject(new Error("Network error during upload."));
    xhr.send(file);
  });
}
