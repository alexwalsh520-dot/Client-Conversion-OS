"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Handshake,
  Plus,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  ListChecks,
  Settings2,
  Loader2,
  ChevronRight,
} from "lucide-react";
import type { PartnerListItem, OnboardingStep } from "@/lib/onboarding/types";
import {
  OnboardingGate,
  Centered,
  StatusPill,
  primaryBtn,
  ghostBtn,
  iconBtn,
  fieldStyle,
} from "./shared";

export default function PartnerOnboardingAdmin() {
  return (
    <OnboardingGate>
      <AdminContent />
    </OnboardingGate>
  );
}

// ---------------------------------------------------------------------------
// Main content (after gate)
// ---------------------------------------------------------------------------

function AdminContent() {
  const [tab, setTab] = useState<"partners" | "steps">("partners");
  const [partners, setPartners] = useState<PartnerListItem[]>([]);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [loading, setLoading] = useState(true);

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
        <PartnersTab partners={partners} onChanged={loadPartners} />
      ) : (
        <StepsTab steps={steps} onChanged={loadSteps} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Partners tab
// ---------------------------------------------------------------------------

function PartnersTab({
  partners,
  onChanged,
}: {
  partners: PartnerListItem[];
  onChanged: () => Promise<void>;
}) {
  const router = useRouter();
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

  function copyLink(token: string, e: React.MouseEvent) {
    e.stopPropagation();
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
            <div
              key={p.id}
              onClick={() => router.push(`/partner-onboarding/${p.id}`)}
              className="glass-static"
              style={{ padding: "14px 16px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", cursor: "pointer" }}
            >
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                  {p.name}
                  {p.handle && <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 13 }}> · {p.handle}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 }}>
                  Their steps: {p.clientStepsDone}/{p.clientStepsTotal} · Our steps: {p.internalStepsDone}/{p.internalStepsTotal}
                </div>
              </div>
              <StatusPill status={p.status} />
              <button onClick={(e) => copyLink(p.token, e)} style={ghostBtn} title="Copy welcome link">
                {copiedToken === p.token ? <Check size={15} style={{ color: "var(--success)" }} /> : <Copy size={15} />}
                {copiedToken === p.token ? "Copied" : "Copy link"}
              </button>
              <ChevronRight size={18} style={{ color: "var(--text-muted)" }} />
            </div>
          ))}
        </div>
      )}
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
    if (!confirm("Remove this step? Clients' existing answers are kept but the step is hidden.")) return;
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
// Local bits
// ---------------------------------------------------------------------------

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
