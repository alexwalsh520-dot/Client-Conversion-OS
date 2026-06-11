"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { INTAKE_QUESTIONS } from "@/lib/ads-leaderboard/intake";

// ── Theme ────────────────────────────────────────────────────────────────────
const C = {
  bg: "#070708",
  card: "rgba(22,22,26,0.55)",
  cardSolid: "#141418",
  line: "rgba(255,255,255,0.08)",
  lineStrong: "rgba(255,255,255,0.14)",
  text: "#f6f6f8",
  sub: "#9a9aa6",
  gold: "#d8b878",
  gold2: "#c9a96e",
  goldInk: "#1a1205",
  green: "#5fdb8e",
  danger: "#ef6b6b",
};

const STEPS = ["Start", "Story", "Script", "Record", "Done"] as const;

// Money-only motivation (no ROAS talk — they just need to know they can earn).
const MOTIVATION = [
  "💰 Your story could earn you up to $10,000 a month.",
  "🔥 One short video. Real money. Don't stop now.",
  "🚀 Someone out there needs to hear your story. Keep going.",
  "🏆 The best ad each month wins big.",
  "✨ You already did the hard part — living it. Now just tell it.",
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
          setName(entry.contestant_name || "");
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

  useEffect(() => {
    const id = setInterval(() => setMotivationIdx((i) => (i + 1) % MOTIVATION.length), 6500);
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
        /* best-effort */
      }
    },
    [token],
  );

  const goTo = useCallback(
    (next: number, status?: string) => {
      const clamped = Math.max(0, Math.min(next, STEPS.length - 1));
      setStep(clamped);
      saveProgress({ step: clamped, intake, contestantName: name, status });
      if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
    },
    [intake, name, saveProgress],
  );

  if (phase === "loading") {
    return <Shell><Center><div className="alb-spin" /><p style={{ color: C.sub, marginTop: 14 }}>Loading…</p></Center></Shell>;
  }
  if (phase === "invalid") {
    return (
      <Shell>
        <Center>
          <div style={{ fontSize: 40, marginBottom: 14 }}>🔒</div>
          <h1 style={{ fontSize: 22, margin: "0 0 10px" }}>This link isn&apos;t valid</h1>
          <p style={{ color: C.sub, margin: 0, lineHeight: 1.6, maxWidth: 380 }}>
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
      <div className="alb-banner">{MOTIVATION[motivationIdx]}</div>

      <div style={{ maxWidth: 600, margin: "0 auto", padding: "22px 20px 90px", position: "relative", zIndex: 1 }}>
        <ProgressBar step={step} />

        <div key={step} className="alb-stepIn">
          {step === 0 && <StartStep onStart={() => goTo(1)} />}
          {step === 1 && (
            <StoryStep
              intake={intake}
              setIntake={setIntake}
              name={name}
              setName={setName}
              saveProgress={saveProgress}
              onBack={() => goTo(0)}
              onNext={() => goTo(2, "intake_done")}
            />
          )}
          {step === 2 && (
            <ScriptStep token={token} intake={intake} script={script} setScript={setScript} onBack={() => goTo(1)} onNext={() => goTo(3)} />
          )}
          {step === 3 && (
            <RecordStep token={token} script={script} onBack={() => goTo(2)} onDone={() => setPhase("done")} />
          )}
        </div>
      </div>
    </Shell>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 0 — Start
// ════════════════════════════════════════════════════════════════════════════
function StartStep({ onStart }: { onStart: () => void }) {
  return (
    <div style={{ textAlign: "center" }}>
      <div className="alb-badge">🏆 Ads Leaderboard</div>
      <h1 style={{ fontSize: 34, fontWeight: 800, margin: "16px 0 14px", letterSpacing: "-0.025em", lineHeight: 1.1 }}>
        Turn your story<br /><span className="alb-grad">into income.</span>
      </h1>
      <p style={{ color: C.sub, fontSize: 16, lineHeight: 1.65, margin: "0 auto 22px", maxWidth: 440 }}>
        You lived the transformation. Now tell it. Record one short video about your journey with coaching — we turn it
        into a real ad and put real money behind it.
      </p>

      <MoneyHero />

      <div style={{ display: "grid", gap: 10, margin: "24px 0", textAlign: "left" }}>
        {[
          ["①", "Answer a few quick questions about your journey"],
          ["②", "We write you a custom script in seconds"],
          ["③", "Record it on your phone + a 2-minute edit"],
          ["④", "We launch it. You earn when people join because of you."],
        ].map(([n, t]) => (
          <div key={n} className="alb-glass" style={{ display: "flex", gap: 13, alignItems: "center", padding: "13px 15px" }}>
            <span className="alb-num">{n}</span>
            <span style={{ fontSize: 14.5, color: C.text }}>{t}</span>
          </div>
        ))}
      </div>

      <p style={{ color: C.sub, fontSize: 12.5, margin: "0 0 18px" }}>
        Takes about 10 minutes. Saves automatically — come back anytime with this link.
      </p>

      <PrimaryBtn onClick={onStart}>Tell my story →</PrimaryBtn>
    </div>
  );
}

function MoneyHero() {
  const target = 10000;
  const [val, setVal] = useState(0);
  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const dur = 1100;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(Math.round(eased * target));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div className="alb-glass alb-glow" style={{ padding: "20px 18px", position: "relative", overflow: "hidden" }}>
      <div style={{ fontSize: 12, letterSpacing: "0.1em", textTransform: "uppercase", color: C.sub, marginBottom: 6 }}>
        Top ads can earn up to
      </div>
      <div className="alb-grad" style={{ fontSize: 40, fontWeight: 900, letterSpacing: "-0.02em", lineHeight: 1 }}>
        ${val.toLocaleString()}
        <span style={{ fontSize: 18, fontWeight: 700, opacity: 0.8 }}>/mo</span>
      </div>
      <div className="alb-shine" />
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 1 — Story (one question per screen)
// ════════════════════════════════════════════════════════════════════════════
function StoryStep({
  intake, setIntake, name, setName, saveProgress, onBack, onNext,
}: {
  intake: Record<string, string>;
  setIntake: (v: Record<string, string>) => void;
  name: string;
  setName: (v: string) => void;
  saveProgress: (p: { intake?: Record<string, string>; contestantName?: string }) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // Screen 0 = name, then one screen per question. Resume at first unanswered
  // (computed once on mount via a lazy initializer — pure, runs a single time).
  const total = INTAKE_QUESTIONS.length + 1;
  const [i, setI] = useState(() => {
    if (!name.trim()) return 0;
    const idx = INTAKE_QUESTIONS.findIndex((q) => q.required && !(intake[q.id] || "").trim());
    return idx === -1 ? total - 1 : idx + 1;
  });
  const [touched, setTouched] = useState(false);
  const isName = i === 0;
  const q = isName ? null : INTAKE_QUESTIONS[i - 1];

  const currentValue = isName ? name : intake[q!.id] || "";
  const isRequired = isName ? true : !!q!.required;
  const filled = currentValue.trim().length > 0;
  const canAdvance = !isRequired || filled;

  const set = (v: string) => {
    if (isName) setName(v);
    else setIntake({ ...intake, [q!.id]: v });
  };

  const next = () => {
    if (!canAdvance) {
      setTouched(true);
      return;
    }
    setTouched(false);
    saveProgress({ intake, contestantName: name });
    if (i < total - 1) {
      setI(i + 1);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else onNext();
  };
  const back = () => {
    setTouched(false);
    if (i > 0) setI(i - 1);
    else onBack();
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
        <span style={{ fontSize: 12.5, color: C.sub, fontWeight: 600, letterSpacing: "0.04em" }}>
          {isName ? "Let's start" : `Question ${i} of ${total - 1}`}
        </span>
        <span className="alb-badge-sm">Your story</span>
      </div>

      <div key={i} className="alb-stepIn">
        <h2 style={{ fontSize: 25, fontWeight: 700, margin: "0 0 8px", lineHeight: 1.2, letterSpacing: "-0.015em" }}>
          {isName ? "First, what's your name?" : q!.label}
        </h2>
        {!isName && q!.help && <p style={{ color: C.sub, fontSize: 14, margin: "0 0 18px", lineHeight: 1.5 }}>{q!.help}</p>}
        {isName && <p style={{ color: C.sub, fontSize: 14, margin: "0 0 18px", lineHeight: 1.5 }}>So we can put your name on the leaderboard.</p>}

        <div style={{ marginTop: 18 }}>
          {!isName && q!.type === "select" ? (
            <div style={{ display: "grid", gap: 10 }}>
              {q!.options!.map((opt) => {
                const active = currentValue === opt;
                return (
                  <button key={opt} type="button" onClick={() => { set(opt); }} className={`alb-opt ${active ? "alb-opt-on" : ""}`}>
                    {opt}
                    {active && <span style={{ marginLeft: "auto" }}>✓</span>}
                  </button>
                );
              })}
            </div>
          ) : !isName && q!.type === "textarea" ? (
            <textarea autoFocus value={currentValue} onChange={(e) => set(e.target.value)} placeholder={q!.placeholder} rows={4} className="alb-input" style={{ resize: "vertical", lineHeight: 1.5 }} />
          ) : (
            <input autoFocus value={currentValue} onChange={(e) => set(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && canAdvance) next(); }} placeholder={isName ? "Your first name" : q!.placeholder} className="alb-input" />
          )}
          {touched && !canAdvance && <p style={{ color: C.danger, fontSize: 12.5, margin: "8px 0 0" }}>This one&apos;s required to keep going.</p>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, marginTop: 26 }}>
        <GhostBtn onClick={back}>← Back</GhostBtn>
        <PrimaryBtn onClick={next}>{i < total - 1 ? "Next →" : "Write my script →"}</PrimaryBtn>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// STEP 2 — Script
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

  useEffect(() => {
    if (!script && !loading) generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <span className="alb-badge-sm">Your script</span>
      <h2 style={{ fontSize: 25, fontWeight: 700, margin: "12px 0 6px", letterSpacing: "-0.015em" }}>Written just for you ✍️</h2>
      <p style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px" }}>
        Built from your real story. Read it to camera and make it yours — don&apos;t memorize, just talk.
      </p>

      {loading && (
        <div className="alb-glass" style={{ padding: 30, textAlign: "center" }}>
          <div className="alb-spin" style={{ margin: "0 auto 14px" }} />
          <p style={{ color: C.sub, margin: 0, fontSize: 14 }}>Writing your script…</p>
        </div>
      )}

      {!loading && err && (
        <div className="alb-glass" style={{ padding: 16, marginBottom: 14, borderColor: C.danger }}>
          <p style={{ color: C.danger, margin: "0 0 10px", fontSize: 14 }}>{err}</p>
          <GhostBtn onClick={generate}>Try again</GhostBtn>
        </div>
      )}

      {!loading && script && (
        <>
          <div className="alb-glass alb-script" style={{ padding: 20, whiteSpace: "pre-wrap", fontSize: 15, lineHeight: 1.75, color: C.text }}>
            {script}
          </div>
          <button type="button" onClick={generate} className="alb-link" style={{ marginTop: 12 }}>
            ↻ Not feeling it? Write a different one
          </button>

          <div className="alb-tip" style={{ margin: "18px 0" }}>
            💡 Glance, look up, talk like a human. Energy beats perfection — your realness is what makes people join.
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <GhostBtn onClick={onBack}>← Back</GhostBtn>
            <PrimaryBtn onClick={onNext}>I&apos;ve got my script →</PrimaryBtn>
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
    <div>
      <input ref={inputRef} type="file" accept="video/*" capture="user" onChange={onFileChange} style={{ display: "none" }} />

      <span className="alb-badge-sm">Record</span>
      <h2 style={{ fontSize: 25, fontWeight: 700, margin: "12px 0 6px", letterSpacing: "-0.015em" }}>Record &amp; submit 🎥</h2>
      <p style={{ color: C.sub, fontSize: 14.5, lineHeight: 1.6, margin: "0 0 18px" }}>
        Film vertically, good light, one take. Prop your phone up. Re-record as many times as you like before submitting.
      </p>

      {script && (
        <details className="alb-glass" style={{ padding: "13px 15px", marginBottom: 16 }}>
          <summary style={{ cursor: "pointer", fontSize: 14, fontWeight: 600, color: C.gold }}>📜 Show my script</summary>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7, color: C.text, marginTop: 12 }}>{script}</div>
        </details>
      )}

      <div className="alb-glass" style={{ padding: 16, marginBottom: 18 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, margin: "0 0 10px" }}>✂️ Make it pop in CapCut (2 min, free)</h3>
        <ol style={{ margin: "0 0 12px", padding: "0 0 0 18px", color: C.sub, fontSize: 13.5, lineHeight: 1.75 }}>
          <li>Open CapCut → <strong style={{ color: C.text }}>New Project</strong> → add your clip.</li>
          <li>Tap <strong style={{ color: C.text }}>Captions → Auto Captions</strong> so the words show on screen.</li>
          <li>Trim dead air at the start so it hooks instantly.</li>
          <li>Optional: a quiet trending sound underneath.</li>
          <li>Export at <strong style={{ color: C.text }}>1080p</strong>, then upload below.</li>
        </ol>
        <a href="https://apps.apple.com/app/capcut-video-editor/id1500855883" target="_blank" rel="noopener noreferrer" className="alb-capcut">
           Get CapCut free →
        </a>
      </div>

      {previewUrl && (
        <video src={previewUrl} controls playsInline className="alb-video" style={{ marginBottom: 16 }} />
      )}

      {uploading ? (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: C.sub, margin: "0 0 10px", fontSize: 14 }}>Uploading your ad… {progress}%</p>
          <div className="alb-track"><div className="alb-fill" style={{ width: `${progress}%` }} /></div>
          <p style={{ color: C.sub, margin: "12px 0 0", fontSize: 12 }}>Keep this page open until it finishes.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {err && <p style={{ color: C.danger, fontSize: 14, margin: 0, textAlign: "center" }}>{err}</p>}
          {file ? (
            <>
              <PrimaryBtn onClick={submit}>Submit my ad 🚀</PrimaryBtn>
              <GhostBtn onClick={() => inputRef.current?.click()}>Record again</GhostBtn>
            </>
          ) : (
            <>
              <PrimaryBtn onClick={() => inputRef.current?.click()}>🎬 Record my video</PrimaryBtn>
              <button type="button" onClick={onBack} className="alb-link" style={{ textAlign: "center", marginTop: 2 }}>← Back to script</button>
            </>
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
      <Confetti />
      <div style={{ fontSize: 56, marginBottom: 12 }} className="alb-pop">🎉</div>
      <h1 style={{ fontSize: 30, fontWeight: 800, margin: "0 0 14px", letterSpacing: "-0.02em" }}>
        You&apos;re in{name ? `, ${name}` : ""}!
      </h1>
      <p style={{ color: C.sub, fontSize: 16, lineHeight: 1.65, margin: "0 0 10px", maxWidth: 440 }}>
        Your ad is submitted. Our team reviews it, puts real budget behind it, and launches it.
      </p>
      <p className="alb-grad" style={{ fontSize: 18, fontWeight: 800, lineHeight: 1.5, margin: "0 0 22px", maxWidth: 440 }}>
        When people join coaching because of your story, you get paid — up to $10,000 a month.
      </p>
      <p style={{ color: C.sub, fontSize: 13.5, margin: 0, maxWidth: 440 }}>
        Keep this link — we&apos;ll update it as your ad goes live so you can watch it climb the leaderboard.
      </p>
    </Center>
  );
}

function Confetti() {
  // Deterministic pseudo-random (seeded by index) so render stays pure — no
  // Math.random() during render. Still looks scattered.
  const pieces = useMemo(() => {
    const rand = (n: number) => {
      const x = Math.sin(n * 9973.13) * 43758.5453;
      return x - Math.floor(x);
    };
    return Array.from({ length: 36 }, (_, i) => ({
      left: rand(i * 4 + 1) * 100,
      delay: rand(i * 4 + 2) * 0.6,
      dur: 2.4 + rand(i * 4 + 3) * 1.8,
      rot: rand(i * 4 + 4) * 360,
      color: [C.gold, C.gold2, C.green, "#fff", "#e8c36a"][i % 5],
      size: 6 + rand(i * 4 + 5) * 6,
    }));
  }, []);
  return (
    <div style={{ position: "fixed", inset: 0, pointerEvents: "none", overflow: "hidden", zIndex: 0 }}>
      {pieces.map((p, i) => (
        <span key={i} className="alb-confetti" style={{ left: `${p.left}%`, width: p.size, height: p.size * 1.6, background: p.color, animationDelay: `${p.delay}s`, animationDuration: `${p.dur}s`, transform: `rotate(${p.rot}deg)` }} />
      ))}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════════
// Shell + shared UI + styles
// ════════════════════════════════════════════════════════════════════════════
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="ads-lb-fullbleed alb-root">
      <div className="alb-bg" aria-hidden />
      {children}
      <Styles />
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "32px 24px", position: "relative", zIndex: 1 }}>
      {children}
    </div>
  );
}

function ProgressBar({ step }: { step: number }) {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 26 }}>
      {STEPS.slice(0, 4).map((_, i) => (
        <div key={i} className={`alb-prog ${i <= step ? "alb-prog-on" : ""}`} />
      ))}
    </div>
  );
}

function PrimaryBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="alb-btn alb-btn-primary">{children}</button>;
}
function GhostBtn({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) {
  return <button type="button" onClick={onClick} className="alb-btn alb-btn-ghost">{children}</button>;
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

function Styles() {
  return (
    <style>{`
      .alb-root {
        min-height: 100vh;
        background: ${C.bg};
        color: ${C.text};
        position: relative;
        overflow-x: hidden;
        font-family: var(--font-geist-sans), -apple-system, BlinkMacFont, sans-serif;
      }
      .alb-bg {
        position: fixed; inset: 0; z-index: 0; pointer-events: none;
        background:
          radial-gradient(60% 50% at 50% -5%, rgba(216,184,120,0.16), transparent 70%),
          radial-gradient(45% 40% at 85% 15%, rgba(126,201,160,0.08), transparent 70%),
          radial-gradient(50% 45% at 10% 80%, rgba(216,184,120,0.07), transparent 70%),
          ${C.bg};
        animation: albDrift 16s ease-in-out infinite alternate;
      }
      @keyframes albDrift { from { background-position: 0 0, 0 0, 0 0, 0 0; } to { background-position: 0 -18px, 14px 10px, -10px 8px, 0 0; } }

      .alb-banner {
        position: sticky; top: 0; z-index: 20; text-align: center;
        padding: 11px 16px; font-size: 13.5px; font-weight: 600; color: ${C.gold};
        background: rgba(216,184,120,0.10);
        border-bottom: 1px solid ${C.line};
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        animation: albBannerIn .5s ease both;
      }
      @keyframes albBannerIn { from { opacity: 0; transform: translateY(-6px); } to { opacity: 1; transform: none; } }

      .alb-stepIn { animation: albIn .42s cubic-bezier(.16,.84,.44,1) both; }
      @keyframes albIn { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }

      .alb-grad {
        background: linear-gradient(95deg, ${C.gold} 0%, #f2dca6 45%, ${C.gold2} 100%);
        -webkit-background-clip: text; background-clip: text; color: transparent;
      }
      .alb-badge {
        display: inline-block; font-size: 12px; font-weight: 700; letter-spacing: .06em;
        color: ${C.gold}; background: rgba(216,184,120,0.12); border: 1px solid rgba(216,184,120,0.25);
        padding: 6px 13px; border-radius: 999px;
      }
      .alb-badge-sm {
        display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase;
        color: ${C.gold}; background: rgba(216,184,120,0.10); border: 1px solid rgba(216,184,120,0.22);
        padding: 4px 10px; border-radius: 999px;
      }
      .alb-num {
        width: 30px; height: 30px; flex-shrink: 0; border-radius: 9px;
        background: rgba(216,184,120,0.14); color: ${C.gold}; font-weight: 800; font-size: 15px;
        display: flex; align-items: center; justify-content: center;
      }
      .alb-glass {
        background: ${C.card}; border: 1px solid ${C.line}; border-radius: 16px;
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        box-shadow: 0 1px 0 rgba(255,255,255,0.04) inset, 0 12px 40px rgba(0,0,0,0.35);
      }
      .alb-glow { box-shadow: 0 0 0 1px rgba(216,184,120,0.18), 0 14px 50px rgba(216,184,120,0.10), 0 12px 40px rgba(0,0,0,0.4); }
      .alb-shine {
        position: absolute; top: 0; left: -40%; width: 40%; height: 100%;
        background: linear-gradient(105deg, transparent, rgba(255,255,255,0.10), transparent);
        animation: albShine 3.2s ease-in-out infinite; transform: skewX(-18deg);
      }
      @keyframes albShine { 0% { left: -45%; } 55%,100% { left: 130%; } }

      .alb-prog { flex: 1; height: 5px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; position: relative; }
      .alb-prog-on { background: linear-gradient(90deg, ${C.gold2}, ${C.gold}); box-shadow: 0 0 12px rgba(216,184,120,0.45); }

      .alb-input {
        width: 100%; padding: 14px 16px; font-size: 16px; border-radius: 13px;
        border: 1px solid ${C.lineStrong}; background: rgba(255,255,255,0.035); color: ${C.text};
        outline: none; font-family: inherit; box-sizing: border-box; transition: border-color .15s, box-shadow .15s, background .15s;
      }
      .alb-input::placeholder { color: rgba(255,255,255,0.28); }
      .alb-input:focus { border-color: rgba(216,184,120,0.55); background: rgba(255,255,255,0.05); box-shadow: 0 0 0 3px rgba(216,184,120,0.14); }

      .alb-opt {
        display: flex; align-items: center; gap: 8px; width: 100%; text-align: left;
        padding: 14px 16px; border-radius: 13px; cursor: pointer; font-size: 15px; font-family: inherit;
        border: 1px solid ${C.lineStrong}; background: rgba(255,255,255,0.03); color: ${C.text};
        transition: all .15s;
      }
      .alb-opt:hover { border-color: rgba(216,184,120,0.4); background: rgba(255,255,255,0.05); }
      .alb-opt-on { border-color: ${C.gold}; background: rgba(216,184,120,0.12); color: ${C.gold}; font-weight: 600; box-shadow: 0 0 0 3px rgba(216,184,120,0.12); }

      .alb-btn {
        flex: 1; padding: 15px 18px; font-size: 15.5px; font-weight: 700; border-radius: 13px;
        cursor: pointer; font-family: inherit; transition: transform .12s ease, box-shadow .2s, filter .2s; border: none;
      }
      .alb-btn:active { transform: translateY(1px) scale(.99); }
      .alb-btn-primary {
        color: ${C.goldInk};
        background: linear-gradient(95deg, ${C.gold} 0%, #f0d79f 50%, ${C.gold2} 100%);
        box-shadow: 0 8px 26px rgba(216,184,120,0.32), 0 0 0 1px rgba(216,184,120,0.4) inset;
      }
      .alb-btn-primary:hover { filter: brightness(1.06); box-shadow: 0 10px 34px rgba(216,184,120,0.45); }
      .alb-btn-ghost { background: transparent; color: ${C.text}; border: 1px solid ${C.lineStrong}; flex: 0 0 auto; padding-left: 22px; padding-right: 22px; }
      .alb-btn-ghost:hover { border-color: ${C.lineStrong}; background: rgba(255,255,255,0.04); }

      .alb-link { background: transparent; border: none; color: ${C.gold}; font-size: 13.5px; font-weight: 600; cursor: pointer; padding: 0; font-family: inherit; }
      .alb-link:hover { text-decoration: underline; }

      .alb-script { position: relative; }
      .alb-tip {
        background: rgba(95,219,142,0.07); border: 1px solid rgba(95,219,142,0.25); border-radius: 13px;
        padding: 13px 15px; font-size: 13.5px; color: ${C.text}; line-height: 1.55;
      }
      .alb-capcut {
        display: inline-flex; align-items: center; gap: 8px; padding: 10px 15px; border-radius: 11px;
        background: transparent; border: 1px solid ${C.gold}; color: ${C.gold}; font-size: 13.5px; font-weight: 600; text-decoration: none;
        transition: background .15s;
      }
      .alb-capcut:hover { background: rgba(216,184,120,0.1); }

      .alb-video { width: 100%; border-radius: 16px; background: #000; border: 1px solid ${C.line}; }
      .alb-track { height: 9px; background: rgba(255,255,255,0.08); border-radius: 999px; overflow: hidden; }
      .alb-fill { height: 100%; background: linear-gradient(90deg, ${C.gold2}, ${C.gold}); transition: width .12s linear; box-shadow: 0 0 12px rgba(216,184,120,0.5); }

      .alb-spin { width: 30px; height: 30px; border: 3px solid rgba(255,255,255,0.1); border-top-color: ${C.gold}; border-radius: 50%; animation: albSpin .8s linear infinite; }
      @keyframes albSpin { to { transform: rotate(360deg); } }

      .alb-pop { animation: albPop .6s cubic-bezier(.2,1.3,.4,1) both; }
      @keyframes albPop { from { transform: scale(0); } to { transform: scale(1); } }

      .alb-confetti { position: absolute; top: -20px; border-radius: 2px; animation-name: albFall; animation-timing-function: linear; animation-iteration-count: 1; }
      @keyframes albFall { to { transform: translateY(110vh) rotate(540deg); opacity: 0; } }

      @media (prefers-reduced-motion: reduce) {
        .alb-bg, .alb-shine, .alb-stepIn, .alb-banner, .alb-pop, .alb-confetti { animation: none !important; }
      }
    `}</style>
  );
}
