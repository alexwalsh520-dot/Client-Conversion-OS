/**
 * Coach UI (B6c) — Pending-row panel for the simplified upload flow.
 *
 * Section order:
 *   1. Intake form (collapsible card, default-expanded)
 *   2. CopyPromptButton — assemble + reveal Claude.ai prompt
 *   3. UploadPlanButton — file picker for the finished PDF
 *   4. If a plan exists: version metadata + PDF iframe + Replace + Move-to-Done
 *   5. Previous Plan Versions (collapsed by default)
 *
 * No more in-app generation, no more best-of-3, no more polling, no
 * more coach-review banner. Just intake → copy → paste-into-Claude →
 * upload → done.
 */

"use client";

import React, { useCallback, useEffect, useState } from "react";
import { CheckCircle } from "lucide-react";
import { CopyPromptButton } from "./CopyPromptButton";
import { UploadPlanButton } from "./UploadPlanButton";
import { IntakeFormCard } from "./IntakeFormCard";
import { MacroTargetEditor } from "./MacroTargetEditor";
import { PlanHistory } from "./PlanHistory";
import { MoveToDoneDialog } from "./MoveToDoneDialog";
import type { CoachClientLite, PanelMode, PlanResponse } from "./types";
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
  const { data: planResp, loading } = useLatestPlan(client.id, refreshKey);
  const [showMoveToDone, setShowMoveToDone] = useState(false);
  // Locked kcal target from the MacroTargetEditor — null until coach
  // clicks "Lock target". Gates the Generate-prompt button.
  const [lockedKcal, setLockedKcal] = useState<number | null>(null);

  const handleUploaded = useCallback(() => {
    setRefreshKey((n) => n + 1);
    if (onRefreshClients) onRefreshClients();
  }, [onRefreshClients]);

  const handleMoveToDoneComplete = useCallback(() => {
    setShowMoveToDone(false);
    if (onRefreshClients) onRefreshClients();
  }, [onRefreshClients]);

  const plan = planResp?.plan ?? null;

  return (
    <div style={panelStyle}>
      {/* 1. Intake form */}
      <IntakeFormCard form={intakeForm} />

      {/* 2. Lock macro target → Generate prompt */}
      <div
        style={{
          marginBottom: 14,
          padding: 12,
          background: "rgba(99,102,241,0.05)",
          border: "1px solid rgba(99,102,241,0.2)",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 8,
          }}
        >
          1. Generate the plan in Claude.ai
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
          Review the macro targets below. Adjust the daily kcal if needed —
          protein, carbs, and fat will recalculate automatically. When you&apos;re
          happy with the numbers, click <strong>Lock target</strong>, then
          generate the prompt to paste into Claude.ai.
        </div>
        <MacroTargetEditor
          clientId={client.id}
          onLockChange={setLockedKcal}
        />
        <CopyPromptButton clientId={client.id} lockedKcal={lockedKcal} />
      </div>

      {/* 3. Upload */}
      <div
        style={{
          marginBottom: 14,
          padding: 12,
          background: "rgba(34,197,94,0.04)",
          border: "1px solid rgba(34,197,94,0.2)",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: 8,
          }}
        >
          2. Upload the finished PDF
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8 }}>
          Once Claude.ai has produced the plan and you&apos;ve exported it
          as a PDF, upload it here. It&apos;ll be saved as a new version
          for this client.
        </div>
        <UploadPlanButton
          clientId={client.id}
          onUploaded={handleUploaded}
          label={plan?.uploaded_pdf_path ? "Replace PDF" : "Upload PDF"}
        />
      </div>

      {/* 4. Current plan preview */}
      {loading && (
        <div style={{ fontSize: 12, color: "var(--text-muted)", padding: "8px 0" }}>
          Loading…
        </div>
      )}
      {!loading && plan && planResp?.pdf_signed_url && (
        <div style={{ marginBottom: 14 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              marginBottom: 10,
              fontSize: 12,
              color: "var(--text-muted)",
              flexWrap: "wrap",
            }}
          >
            <span style={{ color: "var(--text-primary)", fontWeight: 600 }}>
              v{plan.version_number ?? plan.version}
            </span>
            <span>· {new Date(plan.created_at).toLocaleString()}</span>
            {plan.uploaded_by && <span>· uploaded by {plan.uploaded_by}</span>}
            {planResp.is_uploaded ? (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--success, #22c55e)",
                  background: "rgba(34,197,94,0.1)",
                  padding: "1px 6px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontWeight: 600,
                }}
              >
                uploaded
              </span>
            ) : (
              <span
                style={{
                  fontSize: 10,
                  color: "var(--text-muted)",
                  background: "rgba(255,255,255,0.05)",
                  padding: "1px 6px",
                  borderRadius: 4,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  fontWeight: 600,
                }}
              >
                legacy
              </span>
            )}
          </div>
          <iframe
            src={`${planResp.pdf_signed_url}#navpanes=0&view=FitH`}
            style={{
              display: "block",
              width: "100%",
              maxWidth: "100%",
              height: 720,
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 6,
              background: "#fff",
            }}
            title={`Plan v${plan.version_number ?? plan.version}`}
          />

          {/* Move-to-Done */}
          {mode === "pending" && (
            <div style={{ marginTop: 12 }}>
              <button
                onClick={() => setShowMoveToDone(!showMoveToDone)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "6px 14px",
                  background: "var(--success, #22c55e)",
                  color: "#fff",
                  border: "none",
                  borderRadius: 6,
                  cursor: "pointer",
                  fontSize: 12,
                  fontWeight: 600,
                }}
              >
                <CheckCircle size={12} /> Move to Done
              </button>
              {showMoveToDone && (
                <MoveToDoneDialog
                  clientId={client.id}
                  onComplete={handleMoveToDoneComplete}
                  onCancel={() => setShowMoveToDone(false)}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* 5. Plan history */}
      <PlanHistory
        clientId={client.id}
        excludePlanId={plan?.id ?? null}
        refreshKey={refreshKey}
      />
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
  minWidth: 0,
  overflow: "hidden",
  boxSizing: "border-box",
};
