"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import {
  Handshake,
  Plus,
  Copy,
  Check,
  Trash2,
  X,
  Lock,
  Eye,
  EyeOff,
  ExternalLink,
  ListChecks,
  Settings2,
  Loader2,
} from "lucide-react";
import type {
  PartnerListItem,
  PartnerDetail,
  OnboardingStep,
  PartnerCredential,
  StepProgress,
} from "@/lib/onboarding/types";

const PIN = "5200";
const PIN_KEY = "onb-admin-unlocked";

export default function PartnerOnboardingAdmin() {
  const { data: session, status } = useSession();
  const isAdmin = session?.user?.role === "admin";

  const [unlocked, setUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinError, setPinError] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && sessionStorage.getItem(PIN_KEY) === "1") {
      setUnlocked(true);
    }
  }, []);

  const open = isAdmin || unlocked;

  if (status === "loading") {
    return <Centered><Loader2 size={26} className="onb-spin" style={{ color: "var(--accent)" }} /></Centered>;
  }

  if (!open) {
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

  return <AdminContent />;

  function tryPin() {
    if (pinInput.trim() === PIN) {
      sessionStorage.setItem(PIN_KEY, "1");
      setUnlocked(true);
    } else {
      setPinError(true);
    }
  }
}

// ---------------------------------------------------------------------------
// Main content (after gate)
// ---------------------------------------------------------------------------

function AdminContent() {
  const [tab, setTab] = useState<"partners" | "steps">("partners");
  const [partners, setPartners] = useState<PartnerListItem[]>([]);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadPartners = useCallback(async () => {
    const res = await fetch("/api/onboarding/admin", { cache: "no-store" });
    const json = await res.json();
    setPartners(json.partners ?? []);
  }, []);

  const loadSteps = useCallback(async () => {
    const res = await fetch("/api/onboarding/steps", { cache: "no-store" });
    const json = await res.json();
    setSteps(json.steps ?? []);
  }, []);

  useEffect(() => {
    Promise.all([loadPartners(), loadSteps()]).finally(() => setLoading(false));
  }, [loadPartners, loadSteps]);

  return (
    <div className="fade-up">
      <div className="page-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title" style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Handshake size={26} style={{ color: "var(--accent)" }} /> Client Onboarding
          </h1>
          <p className="page-subtitle">
            Welcome new clients, collect their logins securely, and run the setup checklist.
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
        <TabBtn active={tab === "partners"} onClick={() => setTab("partners")} icon={<ListChecks size={15} />}>
          Clients
        </TabBtn>
        <TabBtn active={tab === "steps"} onClick={() => setTab("steps")} icon={<Settings2 size={15} />}>
          Checklist & SOPs
        </TabBtn>
      </div>

      {loading ? (
        <Centered><Loader2 size={24} className="onb-spin" style={{ color: "var(--accent)" }} /></Centered>
      ) : tab === "partners" ? (
        <PartnersTab
          partners={partners}
          onChanged={loadPartners}
          onOpen={setSelectedId}
        />
      ) : (
        <StepsTab steps={steps} onChanged={loadSteps} />
      )}

      {selectedId && (
        <PartnerDetailModal
          partnerId={selectedId}
          steps={steps}
          onClose={() => setSelectedId(null)}
          onChanged={loadPartners}
        />
      )}

      <Keyframes />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partners tab
// ---------------------------------------------------------------------------

function PartnersTab({
  partners,
  onChanged,
  onOpen,
}: {
  partners: PartnerListItem[];
  onChanged: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await fetch("/api/onboarding/admin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, handle, email }),
      });
      setName("");
      setHandle("");
      setEmail("");
      setAdding(false);
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  function copyLink(token: string) {
    const url = `${window.location.origin}/welcome/${token}`;
    navigator.clipboard.writeText(url);
    setCopiedToken(token);
    window.setTimeout(() => setCopiedToken(null), 1800);
  }

  return (
    <div>
      <button onClick={() => setAdding((a) => !a)} className="glow-accent" style={{ ...primaryBtn, width: "auto", marginBottom: 18, display: "inline-flex", alignItems: "center", gap: 7 }}>
        <Plus size={16} /> New client
      </button>

      {adding && (
        <div className="glass-static" style={{ padding: 18, marginBottom: 18, display: "flex", flexDirection: "column", gap: 10 }}>
          <input placeholder="Client name (required)" value={name} onChange={(e) => setName(e.target.value)} style={fieldStyle} />
          <input placeholder="Instagram handle (optional)" value={handle} onChange={(e) => setHandle(e.target.value)} style={fieldStyle} />
          <input placeholder="Email (optional)" value={email} onChange={(e) => setEmail(e.target.value)} style={fieldStyle} />
          <button onClick={create} disabled={busy || !name.trim()} className="glow-accent" style={{ ...primaryBtn, width: "auto", opacity: busy ? 0.7 : 1 }}>
            {busy ? "Creating…" : "Create & generate link"}
          </button>
        </div>
      )}

      {partners.length === 0 ? (
        <p style={{ color: "var(--text-muted)", fontSize: 14 }}>
          No clients yet. Add one to generate their personal welcome link.
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {partners.map((p) => (
            <div key={p.id} className="glass-static" style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
              <button onClick={() => onOpen(p.id)} style={{ flex: 1, minWidth: 180, textAlign: "left", background: "none", border: "none", cursor: "pointer", padding: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                  {p.name}
                  {p.handle && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 13 }}> · {p.handle}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                  Their steps: {p.clientStepsDone}/{p.clientStepsTotal} · Our steps: {p.internalStepsDone}/{p.internalStepsTotal}
                </div>
              </button>
              <StatusPill status={p.status} />
              <button onClick={() => copyLink(p.token)} style={ghostBtn} title="Copy welcome link">
                {copiedToken === p.token ? <Check size={15} style={{ color: "var(--success)" }} /> : <Copy size={15} />}
                {copiedToken === p.token ? "Copied" : "Copy link"}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partner detail modal
// ---------------------------------------------------------------------------

function PartnerDetailModal({
  partnerId,
  steps,
  onClose,
  onChanged,
}: {
  partnerId: string;
  steps: OnboardingStep[];
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/onboarding/admin/${partnerId}`, { cache: "no-store" });
    const json = await res.json();
    setDetail(json.detail ?? null);
    setLoading(false);
  }, [partnerId]);

  useEffect(() => {
    load();
  }, [load]);

  const clientSteps = useMemo(() => steps.filter((s) => s.active && s.audience === "client"), [steps]);
  const internalSteps = useMemo(() => steps.filter((s) => s.active && s.audience === "internal"), [steps]);

  const progressById = useMemo(() => {
    const m = new Map<string, StepProgress>();
    detail?.progress.forEach((p) => m.set(p.step_id, p));
    return m;
  }, [detail]);

  const credByPlatform = useMemo(() => {
    const m = new Map<string, PartnerCredential>();
    detail?.credentials.forEach((c) => m.set(c.platform, c));
    return m;
  }, [detail]);

  async function toggleInternal(stepId: string, completed: boolean) {
    await fetch(`/api/onboarding/admin/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, completed }),
    });
    await load();
    await onChanged();
  }

  async function setStatus(newStatus: string) {
    await fetch(`/api/onboarding/admin/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    await load();
    await onChanged();
  }

  async function remove() {
    if (!confirm("Remove this client and all their submitted info? This can't be undone.")) return;
    await fetch(`/api/onboarding/admin/${partnerId}`, { method: "DELETE" });
    await onChanged();
    onClose();
  }

  function copyLink() {
    if (!detail) return;
    navigator.clipboard.writeText(`${window.location.origin}/welcome/${detail.token}`);
  }

  return (
    <div onClick={onClose} style={overlayStyle}>
      <div onClick={(e) => e.stopPropagation()} className="glass-static onb-fade" style={modalStyle}>
        {loading || !detail ? (
          <Centered><Loader2 size={22} className="onb-spin" style={{ color: "var(--accent)" }} /></Centered>
        ) : (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div>
                <h2 style={{ fontSize: 22, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>{detail.name}</h2>
                <div style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                  {detail.handle || "—"} · {detail.email || "no email"}
                </div>
              </div>
              <button onClick={onClose} style={{ ...ghostBtn, padding: 8 }}><X size={18} /></button>
            </div>

            <div style={{ display: "flex", gap: 8, marginBottom: 22, flexWrap: "wrap" }}>
              <button onClick={copyLink} style={ghostBtn}><Copy size={14} /> Copy welcome link</button>
              <select value={detail.status} onChange={(e) => setStatus(e.target.value)} style={{ ...ghostBtn, cursor: "pointer" }}>
                <option value="invited">Invited</option>
                <option value="in_progress">In progress</option>
                <option value="submitted">Submitted</option>
                <option value="complete">Complete</option>
              </select>
              <button onClick={remove} style={{ ...ghostBtn, color: "var(--danger)", borderColor: "rgba(217,142,142,0.3)" }}>
                <Trash2 size={14} /> Remove
              </button>
            </div>

            {/* What the partner submitted */}
            <SectionTitle>What {detail.name.split(" ")[0]} sent us</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 26 }}>
              {clientSteps.map((s) => {
                const prog = progressById.get(s.id);
                const platform = (s.meta?.platform as string) || s.title;
                const cred = credByPlatform.get(platform);
                return (
                  <SubmittedRow key={s.id} step={s} progress={prog} cred={cred} />
                );
              })}
            </div>

            {/* Internal checklist */}
            <SectionTitle>Our setup checklist</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {internalSteps.map((s) => {
                const done = progressById.get(s.id)?.completed ?? false;
                const sopHref = s.sop_slug ? `/sop/${s.sop_slug}` : s.sop_url || null;
                return (
                  <label key={s.id} style={{ display: "flex", gap: 11, alignItems: "flex-start", padding: "9px 11px", borderRadius: 9, background: done ? "rgba(126,201,160,0.06)" : "rgba(255,255,255,0.02)", cursor: "pointer" }}>
                    <input type="checkbox" checked={done} onChange={(e) => toggleInternal(s.id, e.target.checked)} style={{ marginTop: 3, accentColor: "#c9a96e", width: 16, height: 16 }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{s.title}</div>
                      {s.description && <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{s.description}</div>}
                      {sopHref && (
                        <a href={sopHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 4 }}>
                          SOP <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SubmittedRow({ step, progress, cred }: { step: OnboardingStep; progress?: StepProgress; cred?: PartnerCredential }) {
  const [reveal, setReveal] = useState(false);
  const hasData = (progress?.completed) || cred;

  return (
    <div style={{ padding: "11px 13px", borderRadius: 9, background: hasData ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.015)", border: "1px solid var(--border-primary)" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: hasData ? "var(--text-primary)" : "var(--text-muted)" }}>
        {step.title}{!hasData && " — not yet"}
      </div>
      {cred ? (
        <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5, fontSize: 13.5 }}>
          {cred.username && <CopyRow label="User" value={cred.username} />}
          {cred.secret && <CopyRow label="Pass" value={cred.secret} secret reveal={reveal} onReveal={() => setReveal((r) => !r)} />}
          {cred.twofa && <CopyRow label="2FA" value={cred.twofa} secret reveal={reveal} onReveal={() => setReveal((r) => !r)} />}
          {cred.notes && <div style={{ color: "var(--text-secondary)" }}>Note: {cred.notes}</div>}
        </div>
      ) : progress?.value ? (
        <div style={{ marginTop: 6, fontSize: 13.5, color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {progress.value}
        </div>
      ) : null}
    </div>
  );
}

function CopyRow({ label, value, secret, reveal, onReveal }: { label: string; value: string; secret?: boolean; reveal?: boolean; onReveal?: () => void }) {
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
// Steps (checklist) editor tab
// ---------------------------------------------------------------------------

function StepsTab({ steps, onChanged }: { steps: OnboardingStep[]; onChanged: () => Promise<void> }) {
  const client = steps.filter((s) => s.active && s.audience === "client");
  const internal = steps.filter((s) => s.active && s.audience === "internal");

  return (
    <div style={{ display: "grid", gap: 22 }}>
      <StepGroup title="Client-facing steps" subtitle="What new clients see and fill in on their welcome link." audience="client" list={client} onChanged={onChanged} />
      <StepGroup title="Our internal checklist" subtitle="The setup tasks your team / VAs work through for each client." audience="internal" list={internal} onChanged={onChanged} />
    </div>
  );
}

function StepGroup({ title, subtitle, audience, list, onChanged }: { title: string; subtitle: string; audience: "client" | "internal"; list: OnboardingStep[]; onChanged: () => Promise<void> }) {
  const [adding, setAdding] = useState(false);
  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)", margin: 0 }}>{title}</h3>
        <p style={{ fontSize: 13, color: "var(--text-muted)", margin: "3px 0 0" }}>{subtitle}</p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {list.map((s) => <StepEditor key={s.id} step={s} onChanged={onChanged} />)}
      </div>
      {adding ? (
        <StepEditor newAudience={audience} onChanged={async () => { setAdding(false); await onChanged(); }} onCancel={() => setAdding(false)} />
      ) : (
        <button onClick={() => setAdding(true)} style={{ ...ghostBtn, marginTop: 10 }}>
          <Plus size={14} /> Add a step
        </button>
      )}
    </div>
  );
}

function StepEditor({ step, newAudience, onChanged, onCancel }: { step?: OnboardingStep; newAudience?: "client" | "internal"; onChanged: () => Promise<void>; onCancel?: () => void }) {
  const isNew = !step;
  const [editing, setEditing] = useState(isNew);
  const [title, setTitle] = useState(step?.title ?? "");
  const [description, setDescription] = useState(step?.description ?? "");
  const [kind, setKind] = useState(step?.kind ?? "task");
  const [sopSlug, setSopSlug] = useState(step?.sop_slug ?? "");
  const [sopUrl, setSopUrl] = useState(step?.sop_url ?? "");
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!title.trim()) return;
    setBusy(true);
    const payload = {
      title,
      description: description || null,
      kind,
      sop_slug: sopSlug || null,
      sop_url: sopUrl || null,
      ...(isNew ? { audience: newAudience } : {}),
    };
    try {
      if (isNew) {
        await fetch("/api/onboarding/steps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      } else {
        await fetch(`/api/onboarding/steps/${step!.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        setEditing(false);
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!step) return;
    if (!confirm("Remove this step? Partners' existing answers are kept but the step is hidden.")) return;
    await fetch(`/api/onboarding/steps/${step.id}`, { method: "DELETE" });
    await onChanged();
  }

  if (!editing && step) {
    const sopHref = step.sop_slug ? `/sop/${step.sop_slug}` : step.sop_url || null;
    return (
      <div className="glass-static" style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>
            {step.title}
            <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>{step.kind}</span>
          </div>
          {sopHref && <a href={sopHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "var(--accent)" }}>SOP linked</a>}
        </div>
        <button onClick={() => setEditing(true)} style={iconBtn}><Settings2 size={15} /></button>
        <button onClick={remove} style={{ ...iconBtn, color: "var(--danger)" }}><Trash2 size={15} /></button>
      </div>
    );
  }

  return (
    <div className="glass-static" style={{ padding: 16, display: "flex", flexDirection: "column", gap: 9 }}>
      <input placeholder="Step title" value={title} onChange={(e) => setTitle(e.target.value)} style={fieldStyle} />
      <textarea placeholder="Description / instructions (optional)" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...fieldStyle, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
        <select value={kind} onChange={(e) => setKind(e.target.value as OnboardingStep["kind"])} style={{ ...fieldStyle, width: "auto", cursor: "pointer" }}>
          <option value="task">Checkbox / task</option>
          <option value="text">Text answer</option>
          <option value="link">Link / URL</option>
          <option value="login">Login (user + password)</option>
          <option value="twofa">2FA backup code</option>
          <option value="bank">Bank referral button</option>
        </select>
      </div>
      <input placeholder="Link to an SOP in your SOP tab (slug, e.g. set-up-manychat)" value={sopSlug} onChange={(e) => setSopSlug(e.target.value)} style={fieldStyle} />
      <input placeholder="…or an external SOP URL" value={sopUrl} onChange={(e) => setSopUrl(e.target.value)} style={fieldStyle} />
      <div style={{ display: "flex", gap: 9 }}>
        <button onClick={save} disabled={busy || !title.trim()} className="glow-accent" style={{ ...primaryBtn, width: "auto", opacity: busy ? 0.7 : 1 }}>
          {busy ? "Saving…" : "Save step"}
        </button>
        <button onClick={() => { if (onCancel) onCancel(); else setEditing(false); }} style={ghostBtn}>Cancel</button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared bits
// ---------------------------------------------------------------------------

function Centered({ children }: { children: React.ReactNode }) {
  return <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "50vh" }}>{children}</div>;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--accent)", margin: "0 0 12px" }}>{children}</h3>;
}

function TabBtn({ active, onClick, icon, children }: { active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <button onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "9px 16px", borderRadius: 10,
      border: `1px solid ${active ? "rgba(201,169,110,0.4)" : "var(--border-primary)"}`,
      background: active ? "var(--accent-soft)" : "transparent",
      color: active ? "var(--accent)" : "var(--text-secondary)",
      fontSize: 14, fontWeight: 600, cursor: "pointer",
    }}>
      {icon}{children}
    </button>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    invited: { label: "Invited", color: "var(--text-muted)", bg: "rgba(255,255,255,0.05)" },
    in_progress: { label: "In progress", color: "var(--warning)", bg: "rgba(232,195,106,0.12)" },
    submitted: { label: "Submitted", color: "var(--tyson)", bg: "rgba(130,197,197,0.12)" },
    complete: { label: "Complete", color: "var(--success)", bg: "rgba(126,201,160,0.14)" },
  };
  const s = map[status] ?? map.invited;
  return <span style={{ fontSize: 12, fontWeight: 600, padding: "4px 10px", borderRadius: 999, color: s.color, background: s.bg }}>{s.label}</span>;
}

const primaryBtn: React.CSSProperties = {
  width: "100%", padding: "10px 18px", borderRadius: 10, border: "1px solid rgba(201,169,110,0.4)",
  background: "var(--accent)", color: "#0c0c0c", fontSize: 14, fontWeight: 700, cursor: "pointer",
};

const ghostBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 13px", borderRadius: 9,
  border: "1px solid var(--border-primary)", background: "rgba(255,255,255,0.03)",
  color: "var(--text-secondary)", fontSize: 13, fontWeight: 500, cursor: "pointer",
};

const iconBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", padding: 6, borderRadius: 7,
  border: "1px solid var(--border-primary)", background: "rgba(255,255,255,0.03)", color: "var(--text-secondary)", cursor: "pointer",
};

const fieldStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 9, border: "1px solid var(--border-primary)",
  background: "rgba(255,255,255,0.03)", color: "var(--text-primary)", fontSize: 14, outline: "none",
};

const overlayStyle: React.CSSProperties = {
  position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)",
  display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "40px 16px", overflowY: "auto",
};

const modalStyle: React.CSSProperties = {
  width: "100%", maxWidth: 560, padding: 26, borderRadius: 16,
};

function Keyframes() {
  return (
    <style>{`
      @keyframes onb-spin { to { transform: rotate(360deg); } }
      .onb-spin { animation: onb-spin 0.8s linear infinite; }
      @keyframes onb-fade { from { opacity: 0; transform: translateY(6px);} to { opacity: 1; transform: translateY(0);} }
      .onb-fade { animation: onb-fade 0.2s ease; }
    `}</style>
  );
}
