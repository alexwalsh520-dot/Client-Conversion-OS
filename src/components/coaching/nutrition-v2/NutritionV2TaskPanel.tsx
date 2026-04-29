/**
 * Coach UI v2 — top-level Pending-row panel.
 *
 * Renders one of four states based on the latest plan for the client:
 *   1. No plan generated yet  → Generate button
 *   2. Plan ready, clean      → PDF + Regenerate / Move to Done
 *   3. Plan ready, needs review → PDF + amber banner + handoff loop
 *   4. Generation blocked     → red banner + Try Again / Handle manually
 *
 * Auth: relies on the existing NextAuth session (server endpoints enforce).
 * Polling: useNutritionJobPoll handles progress + timeouts.
 *
 * The Done-section row keeps the v1 panel — this panel is only used for
 * Pending rows when NEXT_PUBLIC_NUTRITION_V2_UI=true.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { FileText, RefreshCw, AlertCircle, CheckCircle } from "lucide-react";
import { useNutritionJobPoll } from "./useNutritionJobPoll";
import { CoachReviewBanner } from "./CoachReviewBanner";
import { CopyHandoffSection } from "./CopyHandoffSection";
import { PasteCorrectionSection } from "./PasteCorrectionSection";
import { GenerateProgress } from "./GenerateProgress";
import { PlanHistory } from "./PlanHistory";
import { MoveToDoneDialog } from "./MoveToDoneDialog";
import { IntakeFormCard } from "./IntakeFormCard";
import type { CoachClientLite, PlanResponse, PanelMode } from "./types";
import type { NutritionIntakeForm } from "@/lib/types";

// ===========================================================================
// Hook: load latest plan for a client
// ===========================================================================

function useLatestPlan(clientId: number, refreshKey: number) {
  const [data, setData] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setMissing(false);
    (async () => {
      try {
        const listRes = await fetch(`/api/nutrition/v2/client/${clientId}/plans`);
        const listData = await listRes.json();
        const plans = (listData.plans as Array<{ plan_id: number }>) ?? [];
        if (plans.length === 0) {
          if (!cancelled) {
            setMissing(true);
            setData(null);
            setLoading(false);
          }
          return;
        }
        const latestId = plans[0].plan_id;
        const planRes = await fetch(`/api/nutrition/v2/plan/${latestId}`);
        if (!planRes.ok) {
          if (!cancelled) {
            setMissing(true);
            setData(null);
            setLoading(false);
          }
          return;
        }
        const planData = (await planRes.json()) as PlanResponse;
        if (!cancelled) {
          setData(planData);
          setLoading(false);
        }
      } catch {
        if (!cancelled) {
          setMissing(true);
          setData(null);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [clientId, refreshKey]);

  return { data, loading, missing };
}

// ===========================================================================
// Main panel
// ===========================================================================

interface NutritionV2TaskPanelProps {
  client: CoachClientLite;
  mode: PanelMode;
  /** Intake form for the linked client. Rendered as a collapsible card
   *  at the top of every state so the coach always sees parsed intake
   *  context (matches the v1 panel's behavior). */
  intakeForm?: NutritionIntakeForm;
  onRefreshClients?: () => void;
}

export function NutritionV2TaskPanel({
  client,
  mode,
  intakeForm,
  onRefreshClients,
}: NutritionV2TaskPanelProps) {
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: planResp, loading, missing } = useLatestPlan(client.id, refreshKey);
  const [activeJobId, setActiveJobId] = useState<number | null>(null);
  const { state: jobState, cancel: cancelJob } = useNutritionJobPoll(activeJobId);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showMoveToDone, setShowMoveToDone] = useState(false);
  const [moveToDoneMode, setMoveToDoneMode] = useState<"normal" | "manual">("normal");

  // Reload latest plan once a job finishes successfully
  useEffect(() => {
    if (jobState.status === "complete" && jobState.plan_id != null) {
      setActiveJobId(null);
      setRefreshKey((n) => n + 1);
      if (onRefreshClients) onRefreshClients();
    }
  }, [jobState.status, jobState.plan_id, onRefreshClients]);

  const handleGenerate = useCallback(async () => {
    setGenerateError(null);
    try {
      const res = await fetch("/api/nutrition/v2/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_id: client.id }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      setActiveJobId((data as { job_id: number }).job_id);
    } catch (e) {
      setGenerateError(e instanceof Error ? e.message : String(e));
    }
  }, [client.id]);

  const handleCorrectionApplied = useCallback(
    (newPlanId: number) => {
      // newPlanId is the new latest. Trigger refetch.
      void newPlanId;
      setRefreshKey((n) => n + 1);
    },
    [],
  );

  const handleMoveToDoneComplete = useCallback(() => {
    setShowMoveToDone(false);
    if (onRefreshClients) onRefreshClients();
  }, [onRefreshClients]);

  // ---- Render branches ----

  if (loading && !planResp && missing === false) {
    return (
      <div style={panelStyle}>
        <IntakeFormCard form={intakeForm} />
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Loading…
        </div>
      </div>
    );
  }

  // Generation in progress — preempts all other states.
  if (activeJobId != null && jobState.status !== "complete") {
    if (jobState.status === "failed" || jobState.status === "cancelled") {
      // Surface as State 4-style block with retry CTA. Keep activeJobId set
      // so coach sees the failure detail; "Try Again" clears it.
      return (
        <div style={panelStyle}>
          <IntakeFormCard form={intakeForm} />
          <StateBlocked
            errorKind={jobState.error_kind ?? "unknown"}
            errorDetails={jobState.error_details}
            onTryAgain={() => {
              setActiveJobId(null);
              handleGenerate();
            }}
            onHandleManually={() => {
              setActiveJobId(null);
              setMoveToDoneMode("manual");
              setShowMoveToDone(true);
            }}
          />
          {showMoveToDone && (
            <MoveToDoneDialog
              clientId={client.id}
              onComplete={handleMoveToDoneComplete}
              onCancel={() => setShowMoveToDone(false)}
              manualMode={moveToDoneMode === "manual"}
            />
          )}
        </div>
      );
    }
    return (
      <div style={panelStyle}>
        <IntakeFormCard form={intakeForm} />
        <GenerateProgress state={jobState} onCancel={cancelJob} />
      </div>
    );
  }

  // ---- State 1: no plan ----
  if (missing || !planResp) {
    return (
      <div style={panelStyle}>
        <IntakeFormCard form={intakeForm} />
        <StateNoPlan
          onGenerate={handleGenerate}
          error={generateError}
        />
      </div>
    );
  }

  // ---- State 4: generation blocked (most recent plan has no PDF AND was
  //               not a manual_completion) ----
  const plan = planResp.plan;
  const auditBlocked =
    !plan.pdf_path && !plan.manual_completion;
  if (auditBlocked) {
    return (
      <div style={panelStyle}>
        <IntakeFormCard form={intakeForm} />
        <StateBlocked
          errorKind="audit_blocked"
          errorDetails={plan.audit_results}
          onTryAgain={handleGenerate}
          onHandleManually={() => {
            setMoveToDoneMode("manual");
            setShowMoveToDone(true);
          }}
        />
        <PlanHistory
          clientId={client.id}
          excludePlanId={plan.id}
          refreshKey={refreshKey}
        />
        {showMoveToDone && (
          <MoveToDoneDialog
            clientId={client.id}
            onComplete={handleMoveToDoneComplete}
            onCancel={() => setShowMoveToDone(false)}
            manualMode={true}
          />
        )}
      </div>
    );
  }

  // ---- State 2 / 3: plan ready ----
  const reviewRecommended = plan.coach_review_recommended;
  const auditWarnings =
    (plan.audit_results as { warnings?: unknown[] } | null)?.warnings ?? [];

  return (
    <div style={panelStyle}>
      <IntakeFormCard form={intakeForm} />
      {reviewRecommended && (
        <CoachReviewBanner
          complexityReasons={plan.complexity_reasons ?? []}
          auditWarnings={auditWarnings as Parameters<typeof CoachReviewBanner>[0]["auditWarnings"]}
        />
      )}

      {/* Plan metadata */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginBottom: 10,
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
          v{plan.version_number ?? plan.version}
        </span>
        <span>· generated {new Date(plan.created_at).toLocaleString()}</span>
        {plan.created_by && <span>· by {plan.created_by}</span>}
        {plan.template_id === "coach_corrected" && (
          <span
            style={{
              fontSize: 10,
              color: "rgb(255, 179, 71)",
              background: "rgba(255, 179, 71, 0.1)",
              padding: "1px 6px",
              borderRadius: 4,
            }}
          >
            corrected
          </span>
        )}
      </div>

      {/* PDF embed */}
      {planResp.pdf_signed_url && (
        <iframe
          src={planResp.pdf_signed_url}
          style={{
            width: "100%",
            height: 600,
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 6,
            background: "#fff",
            marginBottom: 12,
          }}
          title={`Plan v${plan.version_number ?? plan.version}`}
        />
      )}

      {/* Coach-review actions (state 3 only) */}
      {reviewRecommended && (
        <div style={{ marginBottom: 12 }}>
          <CopyHandoffSection planId={plan.id} pdfUrl={planResp.pdf_signed_url} />
          <PasteCorrectionSection
            planId={plan.id}
            onCorrectionApplied={handleCorrectionApplied}
          />
        </div>
      )}

      {/* Always-available actions */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          onClick={handleGenerate}
          style={secondaryButton}
        >
          <RefreshCw size={12} /> Regenerate
        </button>
        {mode === "pending" && (
          <button
            onClick={() => {
              setMoveToDoneMode("normal");
              setShowMoveToDone(!showMoveToDone);
            }}
            style={primaryButton}
          >
            <CheckCircle size={12} /> Move to Done
          </button>
        )}
      </div>

      {showMoveToDone && (
        <MoveToDoneDialog
          clientId={client.id}
          onComplete={handleMoveToDoneComplete}
          onCancel={() => setShowMoveToDone(false)}
          manualMode={moveToDoneMode === "manual"}
        />
      )}

      <PlanHistory
        clientId={client.id}
        excludePlanId={plan.id}
        refreshKey={refreshKey}
      />
    </div>
  );
}

// ===========================================================================
// State 1
// ===========================================================================

function StateNoPlan({
  onGenerate,
  error,
}: {
  onGenerate: () => void;
  error: string | null;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: 13,
          color: "var(--text-muted)",
          marginBottom: 12,
        }}
      >
        No plan generated yet for this client.
      </div>
      <button onClick={onGenerate} style={primaryButton}>
        <FileText size={12} /> Generate Plan
      </button>
      {error && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11,
            color: "var(--danger, #ef4444)",
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

// ===========================================================================
// State 4
// ===========================================================================

function StateBlocked({
  errorKind,
  errorDetails,
  onTryAgain,
  onHandleManually,
}: {
  errorKind: string;
  errorDetails: unknown;
  onTryAgain: () => void;
  onHandleManually: () => void;
}) {
  // Best-effort summary from error_details
  let summary = "Couldn't generate a valid plan for this client.";
  let detail: string | null = null;
  const ed = errorDetails as
    | {
        reason?: string;
        attempts?: Array<{ attempt: number; kinds: string[] }>;
        scored_diagnostics?: Array<{ hard_errors?: Array<{ kind: string }> }>;
        blocking_errors?: Array<{ check: string; reason: string }>;
      }
    | null;

  if (ed?.reason) detail = ed.reason;
  if (ed?.attempts && Array.isArray(ed.attempts)) {
    const allKinds = new Set<string>();
    for (const a of ed.attempts) for (const k of a.kinds) allKinds.add(k);
    if (allKinds.size > 0) {
      const list = Array.from(allKinds).join(", ");
      summary = `All 3 attempts produced: ${list}.`;
      detail =
        "Coach should review the intake form and try again, or handle manually.";
    }
  } else if (ed?.blocking_errors && Array.isArray(ed.blocking_errors) && ed.blocking_errors.length > 0) {
    summary = `Audit blocked the plan (${ed.blocking_errors.length} blocker${ed.blocking_errors.length === 1 ? "" : "s"}).`;
    detail = ed.blocking_errors
      .slice(0, 3)
      .map((e) => e.reason)
      .join(" | ");
  }

  return (
    <div
      style={{
        background: "rgba(239, 68, 68, 0.08)",
        border: "1px solid rgba(239, 68, 68, 0.3)",
        borderRadius: 8,
        padding: 14,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          color: "rgb(239, 68, 68)",
          fontWeight: 600,
          fontSize: 13,
          marginBottom: 6,
        }}
      >
        <AlertCircle size={14} />
        {summary}
      </div>
      {detail && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 12 }}>
          {detail}
        </div>
      )}
      <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 12 }}>
        error_kind: {errorKind}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button onClick={onTryAgain} style={primaryButton}>
          <RefreshCw size={12} /> Try Again
        </button>
        <button onClick={onHandleManually} style={secondaryButton}>
          Handle manually & mark Done
        </button>
      </div>
    </div>
  );
}

// ===========================================================================
// Shared styles
// ===========================================================================

const panelStyle: React.CSSProperties = {
  padding: 16,
  background: "rgba(255,255,255,0.02)",
  borderTop: "1px solid rgba(255,255,255,0.06)",
  // Belt-and-suspenders against horizontal overflow: the panel lives
  // inside a `<table className="data-table">` which auto-sizes to its
  // widest content. minWidth: 0 + overflow: hidden lets the panel
  // shrink to the available width instead of expanding the table.
  minWidth: 0,
  overflow: "hidden",
  boxSizing: "border-box",
};

const primaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 14px",
  background: "var(--accent, #6366f1)",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 600,
};

const secondaryButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 14px",
  background: "none",
  color: "var(--text-primary)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};
