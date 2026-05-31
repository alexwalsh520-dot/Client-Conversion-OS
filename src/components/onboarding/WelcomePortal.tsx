"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  Check,
  ArrowUpRight,
  Lock,
  PartyPopper,
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

function platformOf(step: OnboardingStep): string {
  return (step.meta?.platform as string | undefined) || step.title;
}

export default function WelcomePortal({ token }: Props) {
  const [view, setView] = useState<PublicPartnerView | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

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

  const total = view?.steps.length ?? 0;
  const done = view?.steps.filter((s) => completedIds.has(s.id)).length ?? 0;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  if (loading) {
    return (
      <Shell>
        <div style={{ display: "flex", justifyContent: "center", padding: "80px 0" }}>
          <Loader2 size={28} className="onb-spin" style={{ color: "var(--accent)" }} />
        </div>
      </Shell>
    );
  }

  if (notFound || !view) {
    return (
      <Shell>
        <div style={{ textAlign: "center", padding: "60px 0" }}>
          <h1 style={{ color: "var(--text-primary)", fontSize: 24, marginBottom: 8 }}>
            This link isn&apos;t active
          </h1>
          <p style={{ color: "var(--text-muted)", fontSize: 15 }}>
            Double-check the link your team sent you, or reach out to them and
            we&apos;ll get you a fresh one.
          </p>
        </div>
      </Shell>
    );
  }

  const firstName = view.name.split(" ")[0];

  return (
    <Shell>
      {/* Hero */}
      <header style={{ textAlign: "center", marginBottom: 28 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 14px",
            borderRadius: 999,
            background: "var(--accent-soft)",
            border: "1px solid rgba(201,169,110,0.25)",
            marginBottom: 18,
          }}
        >
          <Sparkles size={15} style={{ color: "var(--accent)" }} />
          <span
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--accent)",
            }}
          >
            Welcome to the team
          </span>
        </div>
        <h1
          style={{
            fontSize: 38,
            fontWeight: 800,
            lineHeight: 1.05,
            letterSpacing: "-0.025em",
            color: "var(--text-primary)",
            margin: "0 0 14px",
          }}
        >
          Let&apos;s get you set up, {firstName}.
        </h1>
        <p
          style={{
            fontSize: 16,
            lineHeight: 1.6,
            color: "var(--text-secondary)",
            maxWidth: 520,
            margin: "0 auto",
          }}
        >
          We&apos;re about to build something huge together. Knock out these
          quick steps whenever you&apos;ve got a minute — most take less than
          one. Every box you tick gets us closer to launch.
        </p>
      </header>

      {/* Progress */}
      <div
        className="glass-static"
        style={{
          padding: "18px 20px",
          marginBottom: 26,
          position: "sticky",
          top: 12,
          zIndex: 5,
          backdropFilter: "blur(12px)",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            marginBottom: 10,
          }}
        >
          <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>
            {allDone ? "All done — you legend" : `${done} of ${total} done`}
          </span>
          <span style={{ fontSize: 13, color: "var(--accent)", fontWeight: 700 }}>{pct}%</span>
        </div>
        <div
          style={{
            height: 8,
            borderRadius: 999,
            background: "rgba(255,255,255,0.06)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              height: "100%",
              width: `${pct}%`,
              borderRadius: 999,
              background: "linear-gradient(90deg, #c9a96e, #e8c36a)",
              transition: "width 0.5s cubic-bezier(0.22,1,0.36,1)",
              boxShadow: "0 0 12px rgba(201,169,110,0.5)",
            }}
          />
        </div>
      </div>

      {allDone && (
        <div
          className="glass-static onb-pop"
          style={{
            padding: "22px 24px",
            marginBottom: 22,
            textAlign: "center",
            border: "1px solid rgba(126,201,160,0.35)",
            background: "rgba(126,201,160,0.07)",
          }}
        >
          <PartyPopper size={26} style={{ color: "var(--success)", marginBottom: 8 }} />
          <h2 style={{ fontSize: 19, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px" }}>
            That&apos;s everything, {firstName}.
          </h2>
          <p style={{ fontSize: 14.5, color: "var(--text-secondary)", margin: 0 }}>
            Your team is taking it from here. Sit tight — we&apos;ll be in touch
            shortly, and we&apos;re pumped to get you printing.
          </p>
        </div>
      )}

      {/* Steps */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {view.steps.map((step, i) => (
          <StepCard
            key={step.id}
            step={step}
            index={i + 1}
            completed={completedIds.has(step.id)}
            savedCredential={view.savedCredentialPlatforms.includes(platformOf(step))}
            token={token}
            onSaved={load}
          />
        ))}
      </div>

      {/* Footer reassurance */}
      <footer
        style={{
          marginTop: 40,
          paddingTop: 22,
          borderTop: "1px solid var(--border-primary)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          textAlign: "center",
          fontSize: 12.5,
          color: "var(--text-muted)",
        }}
      >
        <ShieldCheck size={14} style={{ color: "var(--success)" }} />
        Anything you enter is encrypted and only visible to your CoreShift team.
      </footer>

      <GlobalKeyframes />
    </Shell>
  );
}

// ---------------------------------------------------------------------------
// Individual step card
// ---------------------------------------------------------------------------

function StepCard({
  step,
  index,
  completed,
  savedCredential,
  token,
  onSaved,
}: {
  step: OnboardingStep;
  index: number;
  completed: boolean;
  savedCredential: boolean;
  token: string;
  onSaved: () => Promise<void>;
}) {
  const [open, setOpen] = useState(!completed);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  // Input state
  const [text, setText] = useState("");
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [twofa, setTwofa] = useState("");
  const [notes, setNotes] = useState("");

  const sopHref = step.sop_slug
    ? `/sop/${step.sop_slug}`
    : step.sop_url || null;

  async function submit(payload: Omit<PublicStepSubmission, "stepId">) {
    setSaving(true);
    try {
      const res = await fetch(`/api/onboarding/public/${token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissions: [{ stepId: step.id, ...payload }] }),
      });
      if (!res.ok) throw new Error("save failed");
      setJustSaved(true);
      setSecret("");
      setTwofa("");
      window.setTimeout(() => setJustSaved(false), 1600);
      await onSaved();
      setOpen(false);
    } catch {
      // Keep the card open so they can retry.
    } finally {
      setSaving(false);
    }
  }

  const accentBorder = completed
    ? "1px solid rgba(126,201,160,0.4)"
    : "1px solid var(--border-primary)";

  return (
    <div
      className="glass-static"
      style={{
        padding: "16px 18px",
        border: accentBorder,
        transition: "border-color 0.3s ease",
      }}
    >
      {/* Header row */}
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          width: "100%",
          background: "none",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          padding: 0,
        }}
      >
        <div
          className={justSaved ? "onb-pop" : ""}
          style={{
            flexShrink: 0,
            width: 30,
            height: 30,
            borderRadius: 9,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            background: completed ? "rgba(126,201,160,0.15)" : "var(--accent-soft)",
            color: completed ? "var(--success)" : "var(--accent)",
            border: completed
              ? "1px solid rgba(126,201,160,0.4)"
              : "1px solid rgba(201,169,110,0.25)",
          }}
        >
          {completed ? <Check size={16} /> : index}
        </div>
        <div style={{ flex: 1 }}>
          <div
            style={{
              fontSize: 15,
              fontWeight: 600,
              color: "var(--text-primary)",
              textDecoration: completed ? "none" : "none",
            }}
          >
            {step.title}
          </div>
          {completed && !open && (
            <div style={{ fontSize: 12.5, color: "var(--success)", marginTop: 2 }}>
              Done — tap to edit
            </div>
          )}
        </div>
      </button>

      {/* Body */}
      {open && (
        <div className="onb-fade" style={{ marginTop: 14, paddingLeft: 44 }}>
          {step.description && (
            <p
              style={{
                fontSize: 14,
                lineHeight: 1.55,
                color: "var(--text-secondary)",
                margin: "0 0 14px",
              }}
            >
              {step.description}
            </p>
          )}

          {sopHref && (
            <a
              href={sopHref}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                fontSize: 13,
                color: "var(--accent)",
                marginBottom: 14,
                textDecoration: "none",
              }}
            >
              See how it&apos;s done <ArrowUpRight size={13} />
            </a>
          )}

          {/* Per-kind input */}
          {step.kind === "bank" && (
            <BankStep
              referralUrl={(step.meta?.referral_url as string) || "#"}
              saving={saving}
              completed={completed}
              onConfirm={() => submit({ completed: true })}
            />
          )}

          {step.kind === "text" && (
            <FieldStep
              multiline
              placeholder="Type your answer…"
              value={text}
              onChange={setText}
              saving={saving}
              onSave={() => submit({ value: text })}
            />
          )}

          {step.kind === "link" && (
            <FieldStep
              placeholder="Paste the link here (https://…)"
              value={text}
              onChange={setText}
              saving={saving}
              onSave={() => submit({ value: text })}
            />
          )}

          {(step.kind === "login" || step.kind === "twofa") && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {savedCredential && (
                <div
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 12.5,
                    color: "var(--success)",
                  }}
                >
                  <Lock size={12} /> Saved securely. Re-enter to update.
                </div>
              )}
              {step.kind === "login" && (
                <>
                  <Input
                    placeholder="Username or email"
                    value={username}
                    onChange={setUsername}
                  />
                  <Input
                    placeholder="Password"
                    type="password"
                    value={secret}
                    onChange={setSecret}
                  />
                </>
              )}
              {step.kind === "twofa" && (
                <Input
                  placeholder="Backup code / setup key"
                  value={twofa}
                  onChange={setTwofa}
                />
              )}
              <Input
                placeholder="Anything we should know? (optional)"
                value={notes}
                onChange={setNotes}
              />
              <SaveButton
                saving={saving}
                disabled={
                  step.kind === "login"
                    ? !username && !secret
                    : !twofa
                }
                onClick={() =>
                  submit({
                    username,
                    secret,
                    twofa,
                    notes,
                  })
                }
              />
            </div>
          )}

          {step.kind === "task" && (
            <SaveButton
              saving={saving}
              label={completed ? "Mark as not done" : "Mark as done"}
              onClick={() => submit({ completed: !completed })}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg-primary)", padding: "56px 20px 80px" }}>
      <div style={{ maxWidth: 640, margin: "0 auto" }}>{children}</div>
    </div>
  );
}

function Input({
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      style={inputStyle}
    />
  );
}

function FieldStep({
  value,
  onChange,
  placeholder,
  multiline,
  saving,
  onSave,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  saving: boolean;
  onSave: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {multiline ? (
        <textarea
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          style={{ ...inputStyle, resize: "vertical", minHeight: 90 }}
        />
      ) : (
        <Input value={value} onChange={onChange} placeholder={placeholder} />
      )}
      <SaveButton saving={saving} disabled={!value.trim()} onClick={onSave} />
    </div>
  );
}

function BankStep({
  referralUrl,
  saving,
  completed,
  onConfirm,
}: {
  referralUrl: string;
  saving: boolean;
  completed: boolean;
  onConfirm: () => void;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
      <a
        href={referralUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "10px 16px",
          borderRadius: 10,
          background: "var(--accent-soft)",
          border: "1px solid rgba(201,169,110,0.3)",
          color: "var(--accent)",
          fontSize: 14,
          fontWeight: 600,
          textDecoration: "none",
        }}
      >
        Open Mercury <ArrowUpRight size={15} />
      </a>
      <SaveButton
        saving={saving}
        label={completed ? "Set up ✓" : "I've set it up"}
        onClick={onConfirm}
      />
    </div>
  );
}

function SaveButton({
  saving,
  disabled,
  label = "Save",
  onClick,
}: {
  saving: boolean;
  disabled?: boolean;
  label?: string;
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
        gap: 7,
        padding: "9px 18px",
        borderRadius: 10,
        border: "1px solid rgba(201,169,110,0.35)",
        background: disabled ? "rgba(255,255,255,0.04)" : "var(--accent)",
        color: disabled ? "var(--text-muted)" : "#0c0c0c",
        fontSize: 14,
        fontWeight: 700,
        cursor: saving || disabled ? "default" : "pointer",
        opacity: saving ? 0.75 : 1,
        transition: "all 0.2s ease",
      }}
    >
      {saving ? <Loader2 size={15} className="onb-spin" /> : <Check size={15} />}
      {label}
    </button>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "11px 13px",
  borderRadius: 10,
  border: "1px solid var(--border-primary)",
  background: "rgba(255,255,255,0.03)",
  color: "var(--text-primary)",
  fontSize: 14.5,
  outline: "none",
};

function GlobalKeyframes() {
  return (
    <style>{`
      @keyframes onb-spin { to { transform: rotate(360deg); } }
      .onb-spin { animation: onb-spin 0.8s linear infinite; }
      @keyframes onb-pop {
        0% { transform: scale(0.8); }
        50% { transform: scale(1.18); }
        100% { transform: scale(1); }
      }
      .onb-pop { animation: onb-pop 0.45s cubic-bezier(0.34,1.56,0.64,1); }
      @keyframes onb-fade {
        from { opacity: 0; transform: translateY(-4px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .onb-fade { animation: onb-fade 0.25s ease; }
    `}</style>
  );
}
