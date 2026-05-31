"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Check,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  Lock,
  Loader2,
  ShieldCheck,
} from "lucide-react";
import type {
  PublicPartnerView,
  OnboardingStep,
  PublicStepSubmission,
} from "@/lib/onboarding/types";

interface Props {
  token: string;
}

type Phase = "intro" | "steps" | "done";

function platformOf(step: OnboardingStep): string {
  return (step.meta?.platform as string | undefined) || step.title;
}

export default function WelcomePortal({ token }: Props) {
  const [view, setView] = useState<PublicPartnerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [phase, setPhase] = useState<Phase>("intro");
  const [stepIndex, setStepIndex] = useState(0);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/onboarding/public/${token}`, {
        cache: "no-store",
      });
      if (res.status === 404) {
        setNotFound(true);
        return;
      }
      const json = await res.json();
      setView(json.view as PublicPartnerView);
    } catch {
      setNotFound(true);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
  }, [load]);

  const completedIds = useMemo(() => {
    const set = new Set<string>();
    view?.progress.forEach((p) => {
      if (p.completed) set.add(p.step_id);
    });
    return set;
  }, [view]);

  const steps = view?.steps ?? [];
  const total = steps.length;
  const done = steps.filter((s) => completedIds.has(s.id)).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  if (loading) {
    return (
      <Stage>
        <ParticleField intensity={0.7} />
        <div style={{ position: "relative", zIndex: 1, display: "flex", justifyContent: "center", padding: "120px 0" }}>
          <Loader2 size={30} className="onb-spin" style={{ color: "var(--accent)" }} />
        </div>
        <GlobalKeyframes />
      </Stage>
    );
  }

  if (notFound || !view) {
    return (
      <Stage>
        <ParticleField intensity={0.5} />
        <div style={{ position: "relative", zIndex: 1, textAlign: "center", padding: "120px 24px" }}>
          <h1 style={{ color: "var(--text-primary)", fontSize: 26, marginBottom: 10 }}>
            This link isn&apos;t active
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 15, maxWidth: 380, margin: "0 auto" }}>
            Double-check the link your team sent you, or reach out and we&apos;ll
            get you a fresh one.
          </p>
        </div>
        <GlobalKeyframes />
      </Stage>
    );
  }

  const firstName = view.name.split(" ")[0];

  function beginSteps() {
    const firstUndone = steps.findIndex((s) => !completedIds.has(s.id));
    setStepIndex(firstUndone === -1 ? 0 : firstUndone);
    setPhase("steps");
  }

  // -------------------------------------------------------------- intro
  if (phase === "intro") {
    return (
      <Stage>
        <ParticleField intensity={1} />
        <CenterGlow />
        <div
          className="onb-rise"
          style={{
            position: "relative",
            zIndex: 1,
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "40px 24px",
          }}
        >
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "7px 16px",
              borderRadius: 999,
              background: "var(--accent-soft)",
              border: "1px solid rgba(201,169,110,0.3)",
              marginBottom: 26,
            }}
          >
            <Sparkles size={15} style={{ color: "var(--accent)" }} />
            <span style={{ fontSize: 12.5, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)" }}>
              Welcome aboard
            </span>
          </div>

          <h1
            style={{
              fontSize: "clamp(38px, 9vw, 64px)",
              fontWeight: 800,
              lineHeight: 1.02,
              letterSpacing: "-0.03em",
              color: "var(--text-primary)",
              margin: "0 0 20px",
              maxWidth: 720,
            }}
          >
            Let&apos;s get you set up,
            <br />
            <span style={{ color: "var(--accent)" }}>{firstName}.</span>
          </h1>

          <p
            style={{
              fontSize: "clamp(16px, 2.5vw, 19px)",
              lineHeight: 1.6,
              color: "var(--text-secondary)",
              maxWidth: 540,
              margin: "0 0 38px",
            }}
          >
            We&apos;re about to build something huge together. A handful of quick
            steps, one at a time — most take under a minute. Ready when you are.
          </p>

          <button onClick={beginSteps} className="glow-accent onb-cta" style={ctaStyle}>
            Let&apos;s go
            <ArrowRight size={18} />
          </button>

          <div style={{ marginTop: 22, fontSize: 13, color: "var(--text-muted)" }}>
            {total} quick steps · about 5 minutes
          </div>
        </div>
        <GlobalKeyframes />
      </Stage>
    );
  }

  // --------------------------------------------------------------- done
  if (phase === "done") {
    return (
      <Stage>
        <ParticleField intensity={1.4} />
        <CenterGlow strong />
        <div
          className="onb-rise"
          style={{
            position: "relative",
            zIndex: 1,
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "40px 24px",
          }}
        >
          <div
            className="onb-pop"
            style={{
              width: 86,
              height: 86,
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(126,201,160,0.14)",
              border: "1px solid rgba(126,201,160,0.45)",
              marginBottom: 28,
              boxShadow: "0 0 40px rgba(126,201,160,0.35)",
            }}
          >
            <Check size={42} style={{ color: "var(--success)" }} />
          </div>
          <h1 style={{ fontSize: "clamp(32px, 7vw, 48px)", fontWeight: 800, letterSpacing: "-0.025em", color: "var(--text-primary)", margin: "0 0 16px" }}>
            That&apos;s everything, {firstName}.
          </h1>
          <p style={{ fontSize: 17, lineHeight: 1.6, color: "var(--text-secondary)", maxWidth: 500, margin: "0 0 32px" }}>
            Your team takes it from here. Sit tight — we&apos;ll be in touch
            shortly, and we&apos;re pumped to get rolling with you.
          </p>
          <button onClick={() => { setStepIndex(0); setPhase("steps"); }} style={ghostCtaStyle}>
            Review my answers
          </button>
          <footer style={{ marginTop: 40, display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--text-muted)" }}>
            <ShieldCheck size={14} style={{ color: "var(--success)" }} />
            Everything you entered is encrypted and only visible to your team.
          </footer>
        </div>
        <GlobalKeyframes />
      </Stage>
    );
  }

  // -------------------------------------------------------------- steps
  const step = steps[stepIndex];

  function goNext() {
    if (stepIndex >= total - 1) {
      setPhase("done");
    } else {
      setStepIndex((i) => i + 1);
    }
  }
  function goBack() {
    if (stepIndex === 0) setPhase("intro");
    else setStepIndex((i) => i - 1);
  }

  return (
    <Stage>
      <ParticleField intensity={0.6} />
      <div style={{ position: "relative", zIndex: 1, minHeight: "100vh", display: "flex", flexDirection: "column" }}>
        {/* Top bar: back + progress */}
        <div style={{ padding: "20px 20px 0", maxWidth: 600, width: "100%", margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
            <button onClick={goBack} style={backBtnStyle} aria-label="Back">
              <ArrowLeft size={18} />
            </button>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--text-secondary)" }}>
                  Step {stepIndex + 1} of {total}
                </span>
                <span style={{ fontSize: 12.5, color: "var(--accent)", fontWeight: 700 }}>{pct}%</span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div
                  style={{
                    height: "100%",
                    width: `${Math.max(pct, ((stepIndex) / total) * 100)}%`,
                    borderRadius: 999,
                    background: "linear-gradient(90deg, #c9a96e, #e8c36a)",
                    boxShadow: "0 0 12px rgba(201,169,110,0.5)",
                    transition: "width 0.5s cubic-bezier(0.22,1,0.36,1)",
                  }}
                />
              </div>
            </div>
          </div>
          <DotRow total={total} index={stepIndex} completedIds={completedIds} steps={steps} onJump={setStepIndex} />
        </div>

        {/* Current step */}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: "20px" }}>
          <StepStage
            key={step.id}
            step={step}
            token={token}
            completed={completedIds.has(step.id)}
            savedCredential={view.savedCredentialPlatforms.includes(platformOf(step))}
            existingValue={view.progress.find((p) => p.step_id === step.id)?.value ?? ""}
            isLast={stepIndex >= total - 1}
            onAdvance={async () => {
              await load();
              goNext();
            }}
            onSkip={goNext}
          />
        </div>
      </div>
      <GlobalKeyframes />
    </Stage>
  );
}

// ---------------------------------------------------------------------------
// One step at a time
// ---------------------------------------------------------------------------

function StepStage({
  step,
  token,
  completed,
  savedCredential,
  existingValue,
  isLast,
  onAdvance,
  onSkip,
}: {
  step: OnboardingStep;
  token: string;
  completed: boolean;
  savedCredential: boolean;
  existingValue: string;
  isLast: boolean;
  onAdvance: () => Promise<void>;
  onSkip: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [celebrating, setCelebrating] = useState(false);

  const [text, setText] = useState(existingValue);
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [twofa, setTwofa] = useState("");
  const [notes, setNotes] = useState("");

  const sopHref = step.sop_slug ? `/sop/${step.sop_slug}` : step.sop_url || null;

  async function submit(payload: Omit<PublicStepSubmission, "stepId">) {
    setSaving(true);
    try {
      const res = await fetch(`/api/onboarding/public/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissions: [{ stepId: step.id, ...payload }] }),
      });
      if (!res.ok) throw new Error("save failed");
      setCelebrating(true);
      await new Promise((r) => window.setTimeout(r, 750));
      await onAdvance();
    } catch {
      setSaving(false);
    }
  }

  const continueLabel = isLast ? "Finish" : "Continue";

  return (
    <div className="onb-slide glass-static" style={cardStyle}>
      {celebrating && (
        <div style={celebrateOverlay}>
          <div className="onb-pop" style={celebrateBadge}>
            <Check size={36} style={{ color: "var(--success)" }} />
          </div>
        </div>
      )}

      <div style={{ opacity: celebrating ? 0.25 : 1, transition: "opacity 0.2s ease" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
          {completed && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--success)", background: "rgba(126,201,160,0.12)", padding: "3px 9px", borderRadius: 999 }}>
              <Check size={12} /> Done
            </span>
          )}
        </div>

        <h2 style={{ fontSize: "clamp(22px, 4vw, 28px)", fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)", margin: "0 0 10px" }}>
          {step.title}
        </h2>

        {step.description && (
          <p style={{ fontSize: 15, lineHeight: 1.6, color: "var(--text-secondary)", margin: "0 0 18px" }}>
            {step.description}
          </p>
        )}

        {sopHref && (
          <a href={sopHref} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 13, color: "var(--accent)", marginBottom: 20, textDecoration: "none" }}>
            See how it&apos;s done <ArrowUpRight size={13} />
          </a>
        )}

        {/* Per-kind input */}
        {step.kind === "bank" && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            <a
              href={(step.meta?.referral_url as string) || "#"}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "12px 20px", borderRadius: 12, background: "var(--accent-soft)", border: "1px solid rgba(201,169,110,0.3)", color: "var(--accent)", fontSize: 15, fontWeight: 600, textDecoration: "none" }}
            >
              Open Mercury <ArrowUpRight size={16} />
            </a>
            <PrimaryButton saving={saving} label={completed ? "Done ✓ — continue" : "I've set it up"} onClick={() => submit({ completed: true })} />
          </div>
        )}

        {step.kind === "text" && (
          <Field>
            <textarea value={text} placeholder="Type your answer…" onChange={(e) => setText(e.target.value)} rows={5} style={{ ...inputStyle, resize: "vertical", minHeight: 110 }} />
            <PrimaryButton saving={saving} disabled={!text.trim()} label={continueLabel} onClick={() => submit({ value: text })} />
          </Field>
        )}

        {step.kind === "link" && (
          <Field>
            <input value={text} placeholder="Paste the link here (https://…)" onChange={(e) => setText(e.target.value)} style={inputStyle} />
            <PrimaryButton saving={saving} disabled={!text.trim()} label={continueLabel} onClick={() => submit({ value: text })} />
          </Field>
        )}

        {(step.kind === "login" || step.kind === "twofa") && (
          <Field>
            {savedCredential && (
              <div style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--success)" }}>
                <Lock size={12} /> Saved securely. Re-enter to update.
              </div>
            )}
            {step.kind === "login" && (
              <>
                <input placeholder="Username or email" value={username} onChange={(e) => setUsername(e.target.value)} style={inputStyle} />
                <input placeholder="Password" type="password" value={secret} onChange={(e) => setSecret(e.target.value)} style={inputStyle} />
              </>
            )}
            {step.kind === "twofa" && (
              <input placeholder="Backup code / setup key" value={twofa} onChange={(e) => setTwofa(e.target.value)} style={inputStyle} />
            )}
            <input placeholder="Anything we should know? (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
            <PrimaryButton
              saving={saving}
              disabled={step.kind === "login" ? !username && !secret : !twofa}
              label={isLast ? "Save & finish" : "Save & continue"}
              onClick={() => submit({ username, secret, twofa, notes })}
            />
          </Field>
        )}

        {step.kind === "task" && (
          <PrimaryButton saving={saving} label={completed ? "Done ✓ — continue" : "Mark it done"} onClick={() => submit({ completed: true })} />
        )}

        {/* Skip */}
        <div style={{ marginTop: 18 }}>
          <button onClick={onSkip} style={skipStyle}>
            {completed ? "Next" : "Skip for now"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress dots
// ---------------------------------------------------------------------------

function DotRow({
  total,
  index,
  completedIds,
  steps,
  onJump,
}: {
  total: number;
  index: number;
  completedIds: Set<string>;
  steps: OnboardingStep[];
  onJump: (i: number) => void;
}) {
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {steps.map((s, i) => {
        const isDone = completedIds.has(s.id);
        const isCurrent = i === index;
        return (
          <button
            key={s.id}
            onClick={() => onJump(i)}
            aria-label={`Step ${i + 1}`}
            style={{
              flex: 1,
              minWidth: 14,
              height: 5,
              borderRadius: 999,
              border: "none",
              cursor: "pointer",
              padding: 0,
              background: isCurrent
                ? "var(--accent)"
                : isDone
                ? "rgba(126,201,160,0.6)"
                : "rgba(255,255,255,0.1)",
              transition: "background 0.3s ease",
            }}
          />
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Animated particle field — gold particles ebbing out from center
// ---------------------------------------------------------------------------

function ParticleField({ intensity = 1 }: { intensity?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;
    let raf = 0;

    type P = { x: number; y: number; vx: number; vy: number; life: number; ttl: number; size: number };
    const particles: P[] = [];

    function spawn(seed = false): P {
      const cx = w / 2;
      const cy = h / 2;
      const angle = Math.random() * Math.PI * 2;
      const speed = 0.12 + Math.random() * 0.55;
      const ttl = 220 + Math.random() * 240;
      return {
        x: cx,
        y: cy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: seed ? Math.random() * ttl : 0,
        ttl,
        size: 0.6 + Math.random() * 2,
      };
    }

    function resize() {
      w = canvas!.clientWidth;
      h = canvas!.clientHeight;
      canvas!.width = Math.max(1, Math.floor(w * dpr));
      canvas!.height = Math.max(1, Math.floor(h * dpr));
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    resize();
    const count = Math.floor(110 * intensity);
    for (let i = 0; i < count; i++) particles.push(spawn(true));

    if (reduce) {
      // Static, calm render — no animation loop.
      ctx.clearRect(0, 0, w, h);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(201,169,110,0.12)";
        ctx.fill();
      }
      window.addEventListener("resize", resize);
      return () => window.removeEventListener("resize", resize);
    }

    function tick() {
      ctx!.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 1.005;
        p.vy *= 1.005;
        p.life++;
        if (p.life > p.ttl || p.x < -10 || p.x > w + 10 || p.y < -10 || p.y > h + 10) {
          Object.assign(p, spawn(false));
        }
        const t = p.life / p.ttl;
        const alpha = Math.sin(t * Math.PI) * 0.55;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(201,169,110,${alpha})`;
        ctx!.fill();
      }
      raf = requestAnimationFrame(tick);
    }
    tick();
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [intensity]);

  return (
    <canvas
      ref={ref}
      style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }}
    />
  );
}

function CenterGlow({ strong }: { strong?: boolean }) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 0,
        pointerEvents: "none",
        background: strong
          ? "radial-gradient(circle at 50% 50%, rgba(126,201,160,0.16), transparent 55%)"
          : "radial-gradient(circle at 50% 50%, rgba(201,169,110,0.14), transparent 55%)",
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Stage({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ position: "relative", minHeight: "100vh", background: "var(--bg-primary)", overflow: "hidden" }}>
      {children}
    </div>
  );
}

function Field({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>{children}</div>;
}

function PrimaryButton({
  saving,
  disabled,
  label,
  onClick,
}: {
  saving: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={saving || disabled}
      className="glow-accent"
      style={{
        alignSelf: "flex-start",
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        padding: "13px 26px",
        borderRadius: 12,
        border: "1px solid rgba(201,169,110,0.4)",
        background: disabled ? "rgba(255,255,255,0.04)" : "var(--accent)",
        color: disabled ? "var(--text-muted)" : "#0c0c0c",
        fontSize: 15.5,
        fontWeight: 700,
        cursor: saving || disabled ? "default" : "pointer",
        opacity: saving ? 0.75 : 1,
        transition: "all 0.2s ease",
      }}
    >
      {saving ? <Loader2 size={16} className="onb-spin" /> : <Check size={16} />}
      {label}
    </button>
  );
}

const cardStyle: React.CSSProperties = {
  position: "relative",
  width: "100%",
  maxWidth: 540,
  padding: "32px 30px",
  borderRadius: 20,
};

const celebrateOverlay: React.CSSProperties = {
  position: "absolute",
  inset: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 2,
};

const celebrateBadge: React.CSSProperties = {
  width: 76,
  height: 76,
  borderRadius: "50%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  background: "rgba(126,201,160,0.16)",
  border: "1px solid rgba(126,201,160,0.5)",
  boxShadow: "0 0 36px rgba(126,201,160,0.4)",
};

const ctaStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 10,
  padding: "16px 34px",
  borderRadius: 14,
  border: "1px solid rgba(201,169,110,0.45)",
  background: "var(--accent)",
  color: "#0c0c0c",
  fontSize: 17,
  fontWeight: 700,
  cursor: "pointer",
};

const ghostCtaStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  padding: "11px 22px",
  borderRadius: 12,
  border: "1px solid var(--border-primary)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)",
  fontSize: 14.5,
  fontWeight: 600,
  cursor: "pointer",
};

const backBtnStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 38,
  height: 38,
  borderRadius: 11,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--border-primary)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)",
  cursor: "pointer",
};

const skipStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "var(--text-muted)",
  fontSize: 13.5,
  fontWeight: 500,
  cursor: "pointer",
  padding: 0,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "13px 15px",
  borderRadius: 12,
  border: "1px solid var(--border-primary)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-primary)",
  fontSize: 15,
  outline: "none",
};

function GlobalKeyframes() {
  return (
    <style>{`
      @keyframes onb-spin { to { transform: rotate(360deg); } }
      .onb-spin { animation: onb-spin 0.8s linear infinite; }
      @keyframes onb-pop {
        0% { transform: scale(0.6); opacity: 0; }
        55% { transform: scale(1.18); opacity: 1; }
        100% { transform: scale(1); opacity: 1; }
      }
      .onb-pop { animation: onb-pop 0.5s cubic-bezier(0.34,1.56,0.64,1); }
      @keyframes onb-slide {
        from { opacity: 0; transform: translateY(14px) scale(0.985); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }
      .onb-slide { animation: onb-slide 0.32s cubic-bezier(0.22,1,0.36,1); }
      @keyframes onb-rise {
        from { opacity: 0; transform: translateY(18px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .onb-rise { animation: onb-rise 0.5s cubic-bezier(0.22,1,0.36,1); }
      .onb-cta { transition: transform 0.18s ease, box-shadow 0.18s ease; }
      .onb-cta:hover { transform: translateY(-2px); }
    `}</style>
  );
}
