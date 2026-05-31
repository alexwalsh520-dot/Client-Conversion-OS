"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Copy,
  Check,
  Trash2,
  ExternalLink,
  Loader2,
  ListChecks,
  KeyRound,
} from "lucide-react";
import type {
  PartnerDetail,
  OnboardingStep,
  PartnerCredential,
  StepProgress,
} from "@/lib/onboarding/types";
import {
  OnboardingGate,
  Checkbox,
  SubmittedRow,
  SectionTitle,
  StatusPill,
  Centered,
  ghostBtn,
} from "./shared";

export default function ClientDetail({ partnerId }: { partnerId: string }) {
  return (
    <OnboardingGate>
      <ClientDetailContent partnerId={partnerId} />
    </OnboardingGate>
  );
}

function ClientDetailContent({ partnerId }: { partnerId: string }) {
  const router = useRouter();
  const [detail, setDetail] = useState<PartnerDetail | null>(null);
  const [steps, setSteps] = useState<OnboardingStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const [detailRes, stepsRes] = await Promise.all([
      fetch(`/api/onboarding/admin/${partnerId}`, { cache: "no-store" }),
      fetch("/api/onboarding/steps", { cache: "no-store" }),
    ]);
    const detailJson = await detailRes.json();
    const stepsJson = await stepsRes.json();
    setDetail(detailJson.detail ?? null);
    setSteps(stepsJson.steps ?? []);
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

  const internalDone = internalSteps.filter((s) => progressById.get(s.id)?.completed).length;
  const clientDone = clientSteps.filter((s) => progressById.get(s.id)?.completed).length;

  async function toggleInternal(stepId: string, completed: boolean) {
    await fetch(`/api/onboarding/admin/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ stepId, completed }),
    });
    await load();
  }

  async function setStatus(newStatus: string) {
    await fetch(`/api/onboarding/admin/${partnerId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    await load();
  }

  async function remove() {
    if (!confirm("Remove this client and all their submitted info? This can't be undone.")) return;
    await fetch(`/api/onboarding/admin/${partnerId}`, { method: "DELETE" });
    router.push("/partner-onboarding");
  }

  function copyLink() {
    if (!detail) return;
    navigator.clipboard.writeText(`${window.location.origin}/welcome/${detail.token}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  if (loading || !detail) {
    return <Centered><Loader2 size={26} className="onb-spin" style={{ color: "var(--accent)" }} /></Centered>;
  }

  const firstName = detail.name.split(" ")[0];

  return (
    <div className="fade-up" style={{ maxWidth: 1100, margin: "0 auto" }}>
      {/* Back */}
      <button
        onClick={() => router.push("/partner-onboarding")}
        style={{ ...ghostBtn, marginBottom: 18 }}
      >
        <ArrowLeft size={15} /> All clients
      </button>

      {/* Header */}
      <div
        className="glass-static"
        style={{
          padding: "22px 24px",
          borderRadius: 16,
          marginBottom: 22,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 18,
          flexWrap: "wrap",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              flexShrink: 0,
              background: "var(--accent-soft)",
              color: "var(--accent)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 22,
              fontWeight: 800,
            }}
          >
            {firstName[0]?.toUpperCase() ?? "?"}
          </div>
          <div>
            <h1 style={{ fontSize: 26, fontWeight: 800, color: "var(--text-primary)", margin: 0, letterSpacing: "-0.5px" }}>
              {detail.name}
            </h1>
            <div style={{ fontSize: 13.5, color: "var(--text-muted)", marginTop: 4, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {detail.handle && <span>{detail.handle}</span>}
              {detail.handle && detail.email && <span>·</span>}
              <span>{detail.email || "no email on file"}</span>
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <StatusPill status={detail.status} />
        </div>
      </div>

      {/* Action bar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 26, flexWrap: "wrap", alignItems: "center" }}>
        <button onClick={copyLink} style={ghostBtn}>
          {copied ? <Check size={14} style={{ color: "var(--success)" }} /> : <Copy size={14} />}
          {copied ? "Copied" : "Copy welcome link"}
        </button>
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

      {/* Two-column dashboard */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 22,
          alignItems: "start",
        }}
      >
        {/* What the client sent */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <SectionTitle>What {firstName} sent us</SectionTitle>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
              {clientDone}/{clientSteps.length}
            </span>
          </div>
          {clientSteps.length === 0 ? (
            <Empty icon={<KeyRound size={18} />} text="No client-facing steps configured yet." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {clientSteps.map((s) => {
                const prog = progressById.get(s.id);
                const platform = (s.meta?.platform as string) || s.title;
                const cred = credByPlatform.get(platform);
                return <SubmittedRow key={s.id} step={s} progress={prog} cred={cred} />;
              })}
            </div>
          )}
        </section>

        {/* Our internal checklist */}
        <section>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <SectionTitle>Our setup checklist</SectionTitle>
            <span style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>
              {internalDone}/{internalSteps.length}
            </span>
          </div>
          {internalSteps.length === 0 ? (
            <Empty icon={<ListChecks size={18} />} text="No internal steps configured yet." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {internalSteps.map((s) => {
                const done = progressById.get(s.id)?.completed ?? false;
                const sopHref = s.sop_slug ? `/sop/${s.sop_slug}` : s.sop_url || null;
                return (
                  <div
                    key={s.id}
                    style={{
                      display: "flex",
                      gap: 12,
                      alignItems: "flex-start",
                      padding: "12px 14px",
                      borderRadius: 11,
                      background: done ? "rgba(126,201,160,0.07)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${done ? "rgba(126,201,160,0.22)" : "var(--border-primary)"}`,
                      transition: "background 0.15s ease, border-color 0.15s ease",
                    }}
                  >
                    <Checkbox checked={done} onChange={(next) => toggleInternal(s.id, next)} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, color: "var(--text-primary)", fontWeight: 500 }}>{s.title}</div>
                      {s.description && (
                        <div style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 2 }}>{s.description}</div>
                      )}
                      {sopHref && (
                        <a
                          href={sopHref}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ fontSize: 12, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5 }}
                        >
                          SOP <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

function Empty({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div
      style={{
        padding: "26px 18px",
        borderRadius: 12,
        border: "1px dashed var(--border-primary)",
        color: "var(--text-muted)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 8,
        textAlign: "center",
        fontSize: 13.5,
      }}
    >
      <span style={{ color: "var(--text-muted)" }}>{icon}</span>
      {text}
    </div>
  );
}
