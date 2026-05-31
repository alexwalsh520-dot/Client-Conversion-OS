"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Lock, Loader2, Check, Copy, Eye, EyeOff } from "lucide-react";
import type { OnboardingStep, StepProgress, PartnerCredential } from "@/lib/onboarding/types";

const PIN = "5200";
const PIN_KEY = "onb-admin-unlocked";

// ---------------------------------------------------------------------------
// Access gate — admins straight in; everyone else enters the shared team PIN
// once per browser session. Wraps any onboarding back-office surface.
// ---------------------------------------------------------------------------

export function OnboardingGate({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const isAdmin = useIsAdmin();

  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(PIN_KEY) === "1") {
      setUnlocked(true);
    }
  }, []);

  function tryPin() {
    if (pinInput.trim() === PIN) {
      sessionStorage.setItem(PIN_KEY, "1");
      setUnlocked(true);
    } else {
      setPinError(true);
    }
  }

  if (status === "loading") {
    return <Centered><Loader2 size={26} className="onb-spin" style={{ color: "var(--accent)" }} /></Centered>;
  }

  if (isAdmin || unlocked) {
    return <>{children}<Keyframes /></>;
  }

  return (
    <>
      <Centered>
        <div className="glass-static" style={{ padding: 32, maxWidth: 360, textAlign: "center" }}>
          <Lock size={26} style={{ color: "var(--accent)", marginBottom: 12 }} />
          <h2 style={{ fontSize: 19, fontWeight: 700, color: "var(--text-primary)", margin: "0 0 6px" }}>
            Enter PIN
          </h2>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", margin: "0 0 18px" }}>
            This area holds client logins. Enter the team PIN to continue.
          </p>
          <input
            autoFocus
            inputMode="numeric"
            value={pinInput}
            onChange={(e) => {
              setPinInput(e.target.value);
              setPinError(false);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") tryPin();
            }}
            placeholder="••••"
            style={{
              width: "100%",
              padding: "12px 14px",
              borderRadius: 10,
              border: `1px solid ${pinError ? "var(--danger)" : "var(--border-primary)"}`,
              background: "rgba(255,255,255,0.03)",
              color: "var(--text-primary)",
              fontSize: 20,
              textAlign: "center",
              letterSpacing: "0.4em",
              outline: "none",
              marginBottom: 14,
            }}
          />
          {pinError && (
            <p style={{ color: "var(--danger)", fontSize: 13, margin: "0 0 12px" }}>
              That PIN isn&apos;t right.
            </p>
          )}
          <button onClick={tryPin} className="glow-accent" style={primaryBtn}>
            Unlock
          </button>
        </div>
      </Centered>
      <Keyframes />
    </>
  );
}

function useIsAdmin() {
  const { data: session } = useSession();
  return session?.user?.role === "admin";
}

// ---------------------------------------------------------------------------
// Custom checkbox — replaces the native macOS-looking control with a square
// that fills with the gold accent and shows a check when ticked.
// ---------------------------------------------------------------------------

export function Checkbox({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      style={{
        width: 22,
        height: 22,
        borderRadius: 7,
        flexShrink: 0,
        marginTop: 1,
        padding: 0,
        border: checked ? "1px solid var(--accent)" : "1.5px solid var(--border-primary)",
        background: checked ? "var(--accent)" : "rgba(255,255,255,0.03)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        transition: "background 0.15s ease, border-color 0.15s ease, transform 0.1s ease",
      }}
    >
      {checked && <Check size={14} strokeWidth={3} style={{ color: "#0c0c0c" }} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// A submitted client answer / credential, shown read-only in the back office.
// ---------------------------------------------------------------------------

export function SubmittedRow({
  step,
  progress,
  cred,
}: {
  step: OnboardingStep;
  progress?: StepProgress;
  cred?: PartnerCredential;
}) {
  const [reveal, setReveal] = useState(false);
  const hasData = progress?.completed || !!cred;

  return (
    <div
      style={{
        padding: "13px 15px",
        borderRadius: 11,
        background: hasData ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.012)",
        border: "1px solid var(--border-primary)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 13.5, fontWeight: 600, color: hasData ? "var(--text-primary)" : "var(--text-muted)" }}>
          {step.title}
        </span>
        {!hasData && (
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", fontWeight: 500 }}>· not yet</span>
        )}
        {hasData && (
          <Check size={13} style={{ color: "var(--success)", marginLeft: "auto" }} />
        )}
      </div>
      {cred ? (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6, fontSize: 13.5 }}>
          {cred.username && <CopyRow label="User" value={cred.username} />}
          {cred.secret && <CopyRow label="Pass" value={cred.secret} secret reveal={reveal} onReveal={() => setReveal((r) => !r)} />}
          {cred.twofa && <CopyRow label="2FA" value={cred.twofa} secret reveal={reveal} onReveal={() => setReveal((r) => !r)} />}
          {cred.notes && <div style={{ color: "var(--text-secondary)" }}>Note: {cred.notes}</div>}
        </div>
      ) : progress?.value ? (
        <div style={{ marginTop: 7, fontSize: 13.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {progress.value}
        </div>
      ) : null}
    </div>
  );
}

export function CopyRow({
  label,
  value,
  secret,
  reveal,
  onReveal,
}: {
  label: string;
  value: string;
  secret?: boolean;
  reveal?: boolean;
  onReveal?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const shown = secret ? (reveal ? value : "•".repeat(Math.min(value.length, 12))) : value;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: "var(--text-muted)", width: 38, flexShrink: 0 }}>{label}</span>
      <code style={{ color: "var(--text-primary)", fontFamily: "monospace", flex: 1, wordBreak: "break-all" }}>{shown}</code>
      {secret && (
        <button onClick={onReveal} style={iconBtn} title={reveal ? "Hide" : "Reveal"}>
          {reveal ? <EyeOff size={14} /> : <Eye size={14} />}
        </button>
      )}
      <button
        onClick={() => { navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1400); }}
        style={iconBtn}
        title="Copy"
      >
        {copied ? <Check size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small shared atoms
// ---------------------------------------------------------------------------

export function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>{children}</div>;
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)", margin: "0 0 12px" }}>{children}</h3>;
}

export function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    invited: { label: "Invited", color: "var(--text-muted)", bg: "rgba(255,255,255,0.05)" },
    in_progress: { label: "In progress", color: "var(--warning)", bg: "rgba(232,195,106,0.12)" },
    submitted: { label: "Submitted", color: "var(--tyson)", bg: "rgba(130,197,197,0.12)" },
    complete: { label: "Complete", color: "var(--success)", bg: "rgba(126,201,160,0.14)" },
  };
  const s = map[status] ?? map.invited;
  return <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, color: s.color, background: s.bg }}>{s.label}</span>;
}

export const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "10px 18px", borderRadius: 10, border: "1px solid rgba(201,169,110,0.4)",
  background: "var(--accent)", color: "#0c0c0c", fontSize: 14, fontWeight: 700, cursor: "pointer",
};

export const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 9,
  border: "1px solid var(--border-primary)", background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
};

export const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 6, borderRadius: 7,
  border: "1px solid var(--border-primary)", background: "rgba(255,255,255,0.03)", color: "var(--text-secondary)", cursor: "pointer",
};

export const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border-primary)",
  background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", fontSize: 14, outline: "none",
};

export function Keyframes() {
  return (
    <style>{`
      @keyframes onb-spin { to { transform: rotate(360deg); } }
      .onb-spin { animation: onb-spin 0.8s linear infinite; }
      @keyframes onb-fade { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: translateY(0);} }
      .onb-fade { animation: onb-fade 0.2s ease; }
    `}</style>
  );
}
