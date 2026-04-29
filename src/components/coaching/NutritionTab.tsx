"use client";

import React, { useState, useEffect, useCallback } from "react";
import {
  UtensilsCrossed,
  ChevronDown,
  ChevronRight,
  Link2,
  CheckCircle,
  AlertTriangle,
  Clock,
  Search,
  X,
  ClipboardList,
  Copy,
  Check,
  Sparkles,
  FileText,
  Download,
  MessageSquarePlus,
  Trash2,
  Loader2,
} from "lucide-react";
import type { Client, NutritionIntakeForm } from "@/lib/types";
import { NutritionV2TaskPanel } from "./nutrition-v2/NutritionV2TaskPanel";

// B6b — feature flag for the new best-of-3 + coach-review-handoff UI.
// Default: ON. To disable (kill-switch back to v1 MealPlanTaskPanel for
// Pending rows) set NEXT_PUBLIC_NUTRITION_V2_UI=false in the deployment
// environment. The Done section always renders the v1 panel for legacy
// plan rendering — the flag only gates the Pending-row experience.
const USE_NUTRITION_V2_UI =
  process.env.NEXT_PUBLIC_NUTRITION_V2_UI !== "false";

interface Props {
  clients: Client[];
  nutritionForms: NutritionIntakeForm[];
  onLinkForm: (clientId: number, nutritionFormId: number) => Promise<void>;
  // Legacy props retained for API compatibility; unused by the new flow.
  onAssignTask?: (clientId: number, assignedTo: string) => Promise<void>;
  onCompleteTask?: (clientId: number, checklist: { checklistAllergies: boolean; checklistEverfit: boolean; checklistMessage: boolean }) => Promise<void>;
  onUnlinkForm?: (clientId: number) => Promise<void>;
  onRefreshClients?: () => void;
}

function daysSince(dateStr: string | null): number {
  if (!dateStr) return 0;
  const then = new Date(dateStr);
  const now = new Date();
  return Math.floor((now.getTime() - then.getTime()) / (1000 * 60 * 60 * 24));
}

function urgencyColor(days: number): string {
  if (days >= 7) return "var(--danger)";
  if (days >= 5) return "#f59e0b";
  return "var(--text-muted)";
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      style={{ background: "none", border: "none", cursor: "pointer", color: copied ? "var(--success)" : "var(--text-muted)", padding: 2 }}
      title="Copy"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

function IntakeFormDetail({ form }: { form: NutritionIntakeForm }) {
  const fields = [
    { label: "Name", value: `${form.firstName} ${form.lastName}` },
    { label: "Email", value: form.email },
    { label: "Phone", value: form.phone },
    { label: "Address", value: [form.address, form.city, form.state, form.zipCode].filter(Boolean).join(", ") },
    { label: "Age", value: form.age ? String(form.age) : "" },
    { label: "Height", value: form.height },
    { label: "Current Weight", value: form.currentWeight },
    { label: "Goal Weight", value: form.goalWeight },
    { label: "Fitness Goal", value: form.fitnessGoal },
    { label: "Foods Enjoyed", value: form.foodsEnjoy },
    { label: "Foods to Avoid", value: form.foodsAvoid },
    { label: "Allergies / Medical", value: form.allergies },
    { label: "Protein Preferences", value: form.proteinPreferences },
    { label: "Can Cook/Meal Prep", value: form.canCook },
    { label: "Preferred Meal Count", value: form.mealCount },
    { label: "Medications", value: form.medications },
    { label: "Supplements", value: form.supplements },
    { label: "Sleep Hours", value: form.sleepHours },
    { label: "Water Intake", value: form.waterIntake },
    { label: "Daily Meals Description", value: form.dailyMealsDescription },
    { label: "Daily Meals (cont.)", value: form.dailyMealsDescription2 },
  ].filter((f) => f.value);

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 13 }}>
      {fields.map((f) => (
        <div key={f.label} style={{ padding: "6px 10px", background: "rgba(255,255,255,0.03)", borderRadius: 6 }}>
          <div style={{ color: "var(--text-muted)", fontSize: 11, marginBottom: 2, display: "flex", alignItems: "center", gap: 4 }}>
            {f.label} <CopyButton text={f.value} />
          </div>
          <div style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{f.value}</div>
        </div>
      ))}
    </div>
  );
}

// ============ MEAL PLAN TASK PANEL ============

interface MealPlan {
  id: number;
  client_id: number;
  version: number;
  pdf_path: string | null;
  targets_calories: number;
  targets_protein_g: number;
  targets_carbs_g: number;
  targets_fat_g: number;
  sex: string;
  weight_kg: number;
  meals_per_day: number;
  plan_data: unknown;
  created_at: string;
  created_by: string;
  pdfUrl: string | null;
}

interface Comment {
  id: number;
  client_id: number;
  comment: string;
  created_at: string;
  created_by: string;
}

function MealPlanTaskPanel({
  client,
  intakeForm,
  isDoneSection,
  onRefreshClients,
}: {
  client: Client;
  intakeForm: NutritionIntakeForm | undefined;
  isDoneSection: boolean;
  onRefreshClients?: () => void;
}) {
  const [plans, setPlans] = useState<MealPlan[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newComment, setNewComment] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lastStatus, setLastStatus] = useState<{
    badge?: "green" | "yellow" | "red";
    canShipToClient?: boolean;
    tier1Violations?: { dayNumber?: number; day?: string; weekday?: string; meal?: string | null; action?: string; constraint?: string; instruction?: string; kind: string; message: string }[];
    tier2Violations?: { dayNumber?: number; day?: string; weekday?: string; meal?: string | null; action?: string; constraint?: string; instruction?: string; kind: string; message: string }[];
    medicalReviewRequired?: boolean;
    // EDIT mode metadata — populated when the last generation was an
    // incremental edit of a prior plan rather than a full regenerate.
    generationMode?: "scratch" | "edit";
    editModifiedMeals?: { day: number; meal: string }[];
    editWarnings?: string[];
  } | null>(null);
  const [checklist, setChecklist] = useState({ allergies: false, delivered: false, tipsReviewed: false });
  const [completing, setCompleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, commentsRes] = await Promise.all([
        fetch(`/api/nutrition/plan?clientId=${client.id}`),
        fetch(`/api/nutrition/comments?clientId=${client.id}`),
      ]);
      const plansData = await plansRes.json();
      const commentsData = await commentsRes.json();
      if (plansData.success) setPlans(plansData.plans || []);
      if (commentsData.success) setComments(commentsData.comments || []);
    } catch (err) {
      console.error(err);
    }
    setLoading(false);
  }, [client.id]);

  useEffect(() => { load(); }, [load]);

  const latestPlan = plans[0];

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    setPreviewUrl(null);
    try {
      const res = await fetch("/api/nutrition/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id }),
      });
      const raw = await res.text();
      let data: {
        success?: boolean;
        error?: string;
        pdfUrl?: string;
        generationMode?: "scratch" | "edit";
        editModifiedMeals?: { day: number; meal: string }[];
        editWarnings?: string[];
        status?: {
          badge?: "green" | "yellow" | "red";
          canShipToClient?: boolean;
          tier1Violations?: { dayNumber?: number; day?: string; weekday?: string; meal?: string | null; action?: string; constraint?: string; instruction?: string; kind: string; message: string }[];
          tier2Violations?: { dayNumber?: number; day?: string; weekday?: string; meal?: string | null; action?: string; constraint?: string; instruction?: string; kind: string; message: string }[];
          medicalReviewRequired?: boolean;
        };
      } = {};
      try {
        data = JSON.parse(raw);
      } catch {
        // Non-JSON response (usually a Vercel timeout page). Surface a readable message.
        if (res.status === 504 || /function.*invocation.*timeout/i.test(raw) || /an error occurred/i.test(raw)) {
          throw new Error(
            "Generation took too long and the server timed out. Try again — the model is usually faster on subsequent tries."
          );
        }
        throw new Error(`Server returned a non-JSON response (status ${res.status}).`);
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Generation failed");
      }
      await load();
      setPreviewUrl(data.pdfUrl ?? null);
      // Merge the top-level EDIT-mode fields into lastStatus so the
      // banner renderer has a single source of truth for "what happened
      // on the last generation".
      setLastStatus(
        data.status
          ? {
              ...data.status,
              generationMode: data.generationMode,
              editModifiedMeals: data.editModifiedMeals,
              editWarnings: data.editWarnings,
            }
          : null
      );
      if (onRefreshClients) onRefreshClients();
    } catch (err) {
      setError((err as Error).message);
    }
    setGenerating(false);
  };

  const handleAddComment = async () => {
    if (!newComment.trim()) return;
    await fetch("/api/nutrition/comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: client.id, comment: newComment.trim() }),
    });
    setNewComment("");
    await load();
  };

  const handleDeleteComment = async (id: number) => {
    if (!confirm("Delete this comment?")) return;
    await fetch(`/api/nutrition/comments?id=${id}`, { method: "DELETE" });
    await load();
  };

  const handleComplete = async () => {
    if (!checklist.allergies || !checklist.delivered || !checklist.tipsReviewed) return;
    setCompleting(true);
    try {
      const res = await fetch("/api/nutrition/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, checklist }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Failed");
      if (onRefreshClients) onRefreshClients();
    } catch (err) {
      setError((err as Error).message);
    }
    setCompleting(false);
  };

  if (loading) {
    return (
      <div style={{ padding: 16, color: "var(--text-muted)", fontSize: 13, display: "flex", alignItems: "center", gap: 8 }}>
        <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> Loading task...
      </div>
    );
  }

  return (
    <div style={{ padding: 16, background: "rgba(255,255,255,0.02)" }}>
      {/* Client intake form details */}
      {intakeForm && <IntakeFormDetail form={intakeForm} />}

      {/* Generation controls */}
      <div style={{ marginTop: 20, padding: 16, background: "rgba(201,169,110,0.08)", borderRadius: 10, border: "1px solid rgba(201,169,110,0.2)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)", display: "flex", alignItems: "center", gap: 6 }}>
            <Sparkles size={14} /> Custom Meal Plan
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            style={{
              padding: "8px 18px", borderRadius: 8, border: "none",
              background: generating ? "rgba(255,255,255,0.1)" : "var(--accent)",
              color: generating ? "var(--text-muted)" : "#000",
              cursor: generating ? "default" : "pointer", fontWeight: 600, fontSize: 13,
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {generating ? (
              <>
                <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} />
                Generating... (~30-40s)
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {latestPlan ? `Generate v${latestPlan.version + 1}` : "Generate Custom Meal Plan"}
              </>
            )}
          </button>
        </div>

        {error && (
          <div style={{ padding: 10, background: "rgba(217,142,142,0.1)", borderRadius: 6, color: "var(--danger)", fontSize: 12, marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
            <AlertTriangle size={13} /> {error}
          </div>
        )}

        {/* Latest plan preview & download */}
        {latestPlan && (
          <div style={{ padding: 12, background: "rgba(255,255,255,0.05)", borderRadius: 8, marginBottom: 12 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                Latest Plan — Version {latestPlan.version}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                {new Date(latestPlan.created_at).toLocaleString()}
              </div>
            </div>

            <div style={{ display: "flex", gap: 12, fontSize: 11, color: "var(--text-muted)", marginBottom: 10 }}>
              <span>{latestPlan.targets_calories} kcal</span>
              <span>·</span>
              <span>{latestPlan.targets_protein_g}g P</span>
              <span>·</span>
              <span>{latestPlan.targets_carbs_g}g C</span>
              <span>·</span>
              <span>{latestPlan.targets_fat_g}g F</span>
              <span>·</span>
              <span>{latestPlan.meals_per_day} meals/day</span>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {latestPlan.pdfUrl && (
                <>
                  <button
                    onClick={() => setPreviewUrl(previewUrl === latestPlan.pdfUrl ? null : latestPlan.pdfUrl!)}
                    style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "none", color: "var(--text-primary)", cursor: "pointer", fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <FileText size={12} /> {previewUrl === latestPlan.pdfUrl ? "Hide Preview" : "Preview"}
                  </button>
                  <a
                    href={latestPlan.pdfUrl}
                    download={`meal_plan_v${latestPlan.version}.pdf`}
                    style={{ padding: "6px 12px", borderRadius: 6, border: "none", background: "var(--success)", color: "#000", fontSize: 12, fontWeight: 600, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}
                  >
                    <Download size={12} /> Download
                  </a>
                </>
              )}
            </div>

            {previewUrl && (
              <iframe
                src={previewUrl}
                style={{ width: "100%", height: 600, border: "1px solid rgba(255,255,255,0.1)", borderRadius: 6, marginTop: 12, background: "#fff" }}
                title="Meal plan preview"
              />
            )}
          </div>
        )}

        {/* Version history */}
        {plans.length > 1 && (
          <details style={{ marginBottom: 12 }}>
            <summary style={{ fontSize: 12, color: "var(--text-muted)", cursor: "pointer" }}>
              Previous versions ({plans.length - 1})
            </summary>
            <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
              {plans.slice(1).map((p) => (
                <div key={p.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, padding: "4px 8px", background: "rgba(255,255,255,0.03)", borderRadius: 4 }}>
                  <span style={{ color: "var(--text-primary)" }}>v{p.version}</span>
                  <span style={{ color: "var(--text-muted)", flex: 1 }}>{new Date(p.created_at).toLocaleDateString()}</span>
                  {p.pdfUrl && (
                    <a href={p.pdfUrl} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none", fontSize: 11 }}>
                      Open PDF
                    </a>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* Comments */}
      <div style={{ marginTop: 16, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10, display: "flex", alignItems: "center", gap: 6 }}>
          <MessageSquarePlus size={13} /> Comments <span style={{ color: "var(--text-muted)", fontWeight: 400, fontSize: 11 }}>(used when generating next version)</span>
        </div>

        {comments.length > 0 ? (
          <div style={{ display: "grid", gap: 6, marginBottom: 12, maxHeight: 240, overflowY: "auto" }}>
            {comments.slice(0, 7).map((c) => (
              <div key={c.id} style={{ padding: "6px 10px", background: "rgba(255,255,255,0.04)", borderRadius: 6, fontSize: 12, display: "flex", gap: 8 }}>
                <div style={{ flex: 1, color: "var(--text-primary)", whiteSpace: "pre-wrap" }}>{c.comment}</div>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2 }}>
                  <span style={{ color: "var(--text-muted)", fontSize: 10 }}>{new Date(c.created_at).toLocaleDateString()}</span>
                  <button
                    onClick={() => handleDeleteComment(c.id)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}
                    title="Delete comment"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            ))}
            {comments.length > 7 && (
              <div style={{ fontSize: 11, color: "var(--text-muted)", fontStyle: "italic", padding: "4px 10px" }}>
                Only the 7 most recent comments are used for regeneration. Older comments ({comments.length - 7}) are archived.
              </div>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontStyle: "italic", marginBottom: 10 }}>
            No comments yet. Add feedback that will shape the next generated version.
          </div>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <input
            className="input-field"
            value={newComment}
            onChange={(e) => setNewComment(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAddComment(); } }}
            placeholder="e.g. add more mangoes, +200 kcal, this is a female, new weight: 160 lbs..."
            style={{ flex: 1, fontSize: 12 }}
          />
          <button
            onClick={handleAddComment}
            disabled={!newComment.trim()}
            style={{ padding: "6px 14px", borderRadius: 6, border: "none", background: newComment.trim() ? "var(--accent)" : "rgba(255,255,255,0.1)", color: newComment.trim() ? "#000" : "var(--text-muted)", cursor: newComment.trim() ? "pointer" : "default", fontSize: 12, fontWeight: 600 }}
          >
            Add
          </button>
        </div>
      </div>

      {/* Status badge + safety violations — 3-tier RED/YELLOW/GREEN.
          RED: hard block, regenerate required.
          YELLOW: soft warning, coach can review and ship.
          GREEN: clean (no banner rendered). */}
      {lastStatus && lastStatus.badge !== "green" && (() => {
        const isRed = lastStatus.badge === "red";
        const isYellow = lastStatus.badge === "yellow";
        const bg = isRed
          ? "rgba(239,68,68,0.10)"
          : "rgba(234,179,8,0.10)"; // amber/yellow
        const border = isRed
          ? "rgba(239,68,68,0.45)"
          : "rgba(234,179,8,0.45)";
        const fg = isRed ? "#ef4444" : "#eab308";
        const icon = isRed ? "🔴" : "🟡";
        const heading = isRed
          ? "Safety check failed — regenerate before sending"
          : "Review before sending — minor issues flagged";
        const listHeading = isRed ? "Safety violations:" : "Items to review:";
        const items = isRed
          ? (lastStatus.tier1Violations || [])
          : (lastStatus.tier2Violations || []);
        return (
          <div style={{ marginTop: 16, padding: 14, background: bg, border: `1px solid ${border}`, borderRadius: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, fontWeight: 600 }}>
              <span style={{ fontSize: 18 }}>{icon}</span>
              <span style={{ color: fg }}>{heading}</span>
            </div>
            {items.length > 0 && (
              <div style={{ marginTop: 10, paddingLeft: 28, fontSize: 12, color: "var(--text-primary)" }}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>{listHeading}</div>
                <ul style={{ margin: 0, paddingLeft: 16, lineHeight: 1.5 }}>
                  {items.slice(0, 8).map((v, i) => (
                    <li key={i} style={{ marginBottom: 6 }}>
                      <div>
                        {v.weekday && v.weekday !== "weekly" ? `${v.weekday}: ` : ""}
                        {v.message}
                      </div>
                      {v.instruction && (
                        <details style={{ marginTop: 4, fontSize: 11, color: "var(--text-muted)" }}>
                          <summary style={{ cursor: "pointer", userSelect: "none" }}>
                            View fix instruction
                          </summary>
                          <div
                            style={{
                              marginTop: 6,
                              padding: "8px 10px",
                              background: "rgba(255,255,255,0.04)",
                              borderLeft: `2px solid ${fg}`,
                              borderRadius: 4,
                              lineHeight: 1.5,
                              whiteSpace: "pre-wrap",
                              color: "var(--text-primary)",
                            }}
                          >
                            {v.instruction}
                            {(v.action || v.constraint) && (
                              <div style={{ marginTop: 8, fontSize: 10, color: "var(--text-muted)" }}>
                                {v.action && <span>action: <code>{v.action}</code></span>}
                                {v.action && v.constraint && <span> · </span>}
                                {v.constraint && <span>constraint: {v.constraint}</span>}
                              </div>
                            )}
                          </div>
                        </details>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {isYellow && lastStatus.medicalReviewRequired && (
              <div style={{ marginTop: 8, paddingLeft: 28, fontSize: 11, color: "var(--text-muted)" }}>
                Medical conditions / medications detected — plan includes the relevant safety rules and tips.
              </div>
            )}
          </div>
        );
      })()}
      {lastStatus && lastStatus.badge === "green" && lastStatus.medicalReviewRequired && (
        <div style={{ marginTop: 16, padding: 10, background: "rgba(34,197,94,0.06)", border: "1px solid rgba(34,197,94,0.25)", borderRadius: 10, fontSize: 12, color: "var(--text-muted)" }}>
          🟢 Ready to ship. Medical conditions / medications detected — plan includes the relevant safety rules and tips.
        </div>
      )}

      {/* EDIT-mode badge — appears when the last regen was incremental
          (comments + prior plan existed). Shows what the model reported
          it edited and any semantic-diff warnings from meals that changed
          unexpectedly. Does NOT block shipping — informational only. */}
      {lastStatus && lastStatus.generationMode === "edit" && (
        <div style={{ marginTop: 10, padding: 10, background: "rgba(59,130,246,0.06)", border: "1px solid rgba(59,130,246,0.30)", borderRadius: 10, fontSize: 12, color: "var(--text-primary)" }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>
            ✏️ EDIT mode — {lastStatus.editModifiedMeals?.length ?? 0} meal(s) modified from prior version
          </div>
          {lastStatus.editModifiedMeals && lastStatus.editModifiedMeals.length > 0 && (
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6 }}>
              Modified: {lastStatus.editModifiedMeals.map((m) => `Day ${m.day} ${m.meal}`).join(", ")}
            </div>
          )}
          {lastStatus.editWarnings && lastStatus.editWarnings.length > 0 && (
            <details style={{ marginTop: 4 }}>
              <summary style={{ cursor: "pointer", userSelect: "none", color: "#eab308" }}>
                ⚠️ {lastStatus.editWarnings.length} unexpected diff warning(s) — review
              </summary>
              <ul style={{ margin: "6px 0 0 16px", padding: 0, fontSize: 11, lineHeight: 1.5, color: "var(--text-primary)" }}>
                {lastStatus.editWarnings.slice(0, 12).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
                {lastStatus.editWarnings.length > 12 && (
                  <li style={{ color: "var(--text-muted)" }}>
                    +{lastStatus.editWarnings.length - 12} more (see admin notes)
                  </li>
                )}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Completion checklist — only in Pending section (not Done) */}
      {!isDoneSection && latestPlan && (
        <div style={{ marginTop: 16, padding: 14, background: "rgba(255,255,255,0.03)", borderRadius: 10 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", marginBottom: 10 }}>
            Completion Checklist
          </div>
          {[
            { key: "allergies" as const, label: "Confirmed no allergic items are in the meal plan" },
            { key: "delivered" as const, label: "Meal plan delivered to the customer" },
            { key: "tipsReviewed" as const, label: "Tips section reviewed and appropriate for client" },
          ].map(({ key, label }) => {
            // Block the "delivered" checkbox when the last generation flagged a safety violation
            const deliveryBlocked = key === "delivered" && lastStatus?.canShipToClient === false;
            return (
              <label
                key={key}
                title={deliveryBlocked ? "This plan has safety violations. Regenerate before sending." : ""}
                style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "6px 0",
                  cursor: deliveryBlocked ? "not-allowed" : "pointer",
                  fontSize: 13,
                  color: deliveryBlocked ? "var(--text-muted)" : "var(--text-primary)",
                  opacity: deliveryBlocked ? 0.55 : 1,
                }}
              >
                <input
                  type="checkbox"
                  checked={checklist[key]}
                  disabled={deliveryBlocked}
                  onChange={(e) => setChecklist({ ...checklist, [key]: e.target.checked })}
                  style={{ accentColor: "var(--accent)" }}
                />
                {label}
                {deliveryBlocked && <span style={{ marginLeft: 6, fontSize: 11, color: "#ef4444" }}>(blocked — regenerate first)</span>}
              </label>
            );
          })}
          <button
            onClick={handleComplete}
            disabled={!checklist.allergies || !checklist.delivered || !checklist.tipsReviewed || completing}
            style={{
              marginTop: 10, padding: "8px 20px", borderRadius: 8, border: "none",
              background: (checklist.allergies && checklist.delivered && checklist.tipsReviewed && !completing) ? "var(--success)" : "rgba(255,255,255,0.1)",
              color: (checklist.allergies && checklist.delivered && checklist.tipsReviewed && !completing) ? "#000" : "var(--text-muted)",
              cursor: (checklist.allergies && checklist.delivered && checklist.tipsReviewed && !completing) ? "pointer" : "default",
              fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6,
            }}
          >
            {completing ? <Loader2 size={14} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle size={14} />}
            Mark as Done
          </button>
        </div>
      )}
    </div>
  );
}

// ============ MAIN COMPONENT ============

export default function NutritionTab({ clients, nutritionForms, onLinkForm, onRefreshClients }: Props) {
  const [expandedUnlinked, setExpandedUnlinked] = useState(true);
  const [expandedPending, setExpandedPending] = useState(true);
  const [expandedDone, setExpandedDone] = useState(false);
  const [expandedFormId, setExpandedFormId] = useState<number | null>(null);
  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  // 2026-04-30 product filters:
  //   - Pending: hide tasks older than 30 days (treated as auto-done by
  //     default — coach can reveal with a button)
  //   - Unlinked: hide intake forms submitted before 2026-04-01 (legacy
  //     forms whose linkable clients aren't worth chasing)
  // Both are UI-only filters; DB state is unchanged.
  const [showStalePending, setShowStalePending] = useState(false);
  const [showOldUnlinked, setShowOldUnlinked] = useState(false);
  const STALE_PENDING_DAYS = 30;
  const UNLINKED_CUTOFF_TS = new Date("2026-04-01T00:00:00Z").getTime();

  // Link-from-unlinked state
  const [linkingFormId, setLinkingFormId] = useState<number | null>(null);
  const [linkClientSearch, setLinkClientSearch] = useState("");

  // Categorize forms and clients
  const linkedFormIds = new Set<number>(
    clients.map((c) => c.nutritionFormId).filter((id): id is number => id != null)
  );
  const allUnlinkedForms = nutritionForms.filter((nf) => nf.id != null && !linkedFormIds.has(nf.id));
  // Recent: timestamp present AND >= 2026-04-01. Missing timestamps fall
  // into the "old" bucket — safer to hide unknown-age legacy data.
  const recentUnlinkedForms = allUnlinkedForms.filter(
    (nf) => nf.timestamp != null && new Date(nf.timestamp).getTime() >= UNLINKED_CUTOFF_TS,
  );
  const oldUnlinkedForms = allUnlinkedForms.filter(
    (nf) => nf.timestamp == null || new Date(nf.timestamp).getTime() < UNLINKED_CUTOFF_TS,
  );
  const visibleUnlinkedForms = showOldUnlinked ? allUnlinkedForms : recentUnlinkedForms;

  const allPendingClients = clients.filter((c) => c.nutritionFormId && (c.nutritionStatus === "pending" || c.nutritionStatus === "assigned"));
  const freshPendingClients = allPendingClients.filter(
    (c) => daysSince(c.onboardingDate || c.startDate) <= STALE_PENDING_DAYS,
  );
  const stalePendingClients = allPendingClients.filter(
    (c) => daysSince(c.onboardingDate || c.startDate) > STALE_PENDING_DAYS,
  );
  const visiblePendingClients = showStalePending ? allPendingClients : freshPendingClients;
  const doneClients = clients.filter((c) => c.nutritionFormId && c.nutritionStatus === "done");

  const getFormForClient = (client: Client) => nutritionForms.find((nf) => nf.id === client.nutritionFormId);

  const filterBySearch = (name: string, email: string) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return name.toLowerCase().includes(q) || email.toLowerCase().includes(q);
  };

  return (
    <div>
      {/* Instructions */}
      <div className="glass-static" style={{ padding: 16, marginBottom: 20, borderRadius: 10, fontSize: 13, color: "var(--text-muted)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--text-primary)", fontWeight: 600 }}>
          <ClipboardList size={14} /> Nutrition Meal Plan Process
        </div>
        <ol style={{ margin: 0, paddingLeft: 20, lineHeight: 1.8 }}>
          <li><strong>Unlinked:</strong> Intake forms submitted but not yet matched to a client. Link them here or from Client Roster.</li>
          <li><strong>Pending:</strong> Client onboarded with linked form. Click <em>Generate Custom Meal Plan</em> to produce a 7-day PDF. Add comments to refine subsequent versions.</li>
          <li><strong>Completion:</strong> After downloading, confirm (1) no allergic items, (2) delivered to client, (3) tips reviewed → mark done.</li>
          <li><strong>Done:</strong> Completed plans. You can still generate new versions here if a client requests revisions later.</li>
        </ol>
      </div>

      {/* Search */}
      <div style={{ marginBottom: 16, position: "relative" }}>
        <Search size={14} style={{ position: "absolute", left: 12, top: 10, color: "var(--text-muted)" }} />
        <input
          className="input-field"
          placeholder="Search by name or email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ paddingLeft: 32 }}
        />
      </div>

      {/* ---- Unlinked Section ---- */}
      <div className="section" style={{ marginBottom: 20 }}>
        <button
          onClick={() => setExpandedUnlinked(!expandedUnlinked)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", fontSize: 16, fontWeight: 600, padding: 0, marginBottom: 12 }}
        >
          {expandedUnlinked ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <UtensilsCrossed size={16} />
          Unlinked Intake Forms
          <span style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b", fontSize: 12, padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginLeft: 4 }}>
            {recentUnlinkedForms.length}
          </span>
        </button>

        {expandedUnlinked && (
          <div className="glass-static" style={{ overflow: "auto" }}>
            {visibleUnlinkedForms.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No unlinked intake forms{showOldUnlinked ? "." : " submitted on or after Apr 1, 2026."}
                {!showOldUnlinked && oldUnlinkedForms.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={() => setShowOldUnlinked(true)}
                      style={{
                        padding: "6px 12px",
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    >
                      Show {oldUnlinkedForms.length} older form{oldUnlinkedForms.length === 1 ? "" : "s"} (pre-Apr 1)
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Submitted</th>
                    <th style={{ width: 120 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleUnlinkedForms
                    .filter((nf) => filterBySearch(`${nf.firstName} ${nf.lastName}`, nf.email))
                    .map((nf) => (
                    <React.Fragment key={nf.id}>
                      <tr>
                        <td style={{ fontWeight: 600 }}>{nf.firstName} {nf.lastName}</td>
                        <td style={{ fontSize: 12 }}>{nf.email}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {nf.timestamp ? new Date(nf.timestamp).toLocaleDateString() : "—"}
                        </td>
                        <td>
                          <div style={{ display: "flex", gap: 4 }}>
                            <button
                              onClick={() => setExpandedFormId(expandedFormId === nf.id ? null : nf.id!)}
                              style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                            >
                              {expandedFormId === nf.id ? "Hide" : "View"}
                            </button>
                            <button
                              onClick={() => setLinkingFormId(linkingFormId === nf.id ? null : nf.id!)}
                              style={{ padding: "4px 8px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", gap: 3 }}
                            >
                              <Link2 size={11} /> Link
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expandedFormId === nf.id && (
                        <tr>
                          <td colSpan={4} style={{ padding: 16, background: "rgba(255,255,255,0.02)" }}>
                            <IntakeFormDetail form={nf} />
                          </td>
                        </tr>
                      )}
                      {linkingFormId === nf.id && (
                        <tr>
                          <td colSpan={4} style={{ padding: 12, background: "rgba(255,255,255,0.02)" }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                              <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Link to client:</span>
                              <input
                                className="input-field"
                                placeholder="Search existing client..."
                                value={linkClientSearch}
                                onChange={(e) => setLinkClientSearch(e.target.value)}
                                style={{ flex: 1, maxWidth: 300 }}
                              />
                              <button onClick={() => { setLinkingFormId(null); setLinkClientSearch(""); }} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
                                <X size={14} />
                              </button>
                            </div>
                            {linkClientSearch.length > 0 && (
                              <div style={{ marginTop: 8, maxHeight: 150, overflowY: "auto" }}>
                                {clients
                                  .filter((c) => !c.nutritionFormId && (c.name.toLowerCase().includes(linkClientSearch.toLowerCase()) || c.email.toLowerCase().includes(linkClientSearch.toLowerCase())))
                                  .slice(0, 8)
                                  .map((c) => (
                                    <div
                                      key={c.id}
                                      onClick={async () => {
                                        await onLinkForm(c.id!, nf.id!);
                                        setLinkingFormId(null);
                                        setLinkClientSearch("");
                                      }}
                                      style={{ padding: "6px 10px", cursor: "pointer", fontSize: 13, borderRadius: 4, display: "flex", justifyContent: "space-between" }}
                                      onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.05)")}
                                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                                    >
                                      <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>{c.name}</span>
                                      <span style={{ color: "var(--text-muted)", fontSize: 12 }}>{c.email} · {c.coachName}</span>
                                    </div>
                                  ))}
                                {clients.filter((c) => !c.nutritionFormId && (c.name.toLowerCase().includes(linkClientSearch.toLowerCase()) || c.email.toLowerCase().includes(linkClientSearch.toLowerCase()))).length === 0 && (
                                  <div style={{ padding: "6px 10px", color: "var(--text-muted)", fontSize: 12 }}>No matching clients without a linked form</div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            )}
            {/* Reveal toggle for older unlinked intake forms */}
            {oldUnlinkedForms.length > 0 && (
              <div
                style={{
                  padding: "10px 12px",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  textAlign: "center",
                }}
              >
                <button
                  onClick={() => setShowOldUnlinked(!showOldUnlinked)}
                  style={{
                    padding: "4px 12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                >
                  {showOldUnlinked
                    ? `Hide ${oldUnlinkedForms.length} older form${oldUnlinkedForms.length === 1 ? "" : "s"} (pre-Apr 1)`
                    : `Show ${oldUnlinkedForms.length} older form${oldUnlinkedForms.length === 1 ? "" : "s"} (pre-Apr 1)`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Pending Section ---- */}
      <div className="section" style={{ marginBottom: 20 }}>
        <button
          onClick={() => setExpandedPending(!expandedPending)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", fontSize: 16, fontWeight: 600, padding: 0, marginBottom: 12 }}
        >
          {expandedPending ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <Clock size={16} />
          Pending Meal Plans
          <span style={{ background: "rgba(59,130,246,0.2)", color: "#3b82f6", fontSize: 12, padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginLeft: 4 }}>
            {freshPendingClients.length}
          </span>
        </button>

        {expandedPending && (
          <div className="glass-static" style={{ overflow: "auto" }}>
            {visiblePendingClients.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                {showStalePending
                  ? "No pending meal plan tasks."
                  : `No pending meal plan tasks within the last ${STALE_PENDING_DAYS} days.`}
                {!showStalePending && stalePendingClients.length > 0 && (
                  <div style={{ marginTop: 10 }}>
                    <button
                      onClick={() => setShowStalePending(true)}
                      style={{
                        padding: "6px 12px",
                        border: "1px solid rgba(255,255,255,0.1)",
                        background: "none",
                        color: "var(--text-muted)",
                        cursor: "pointer",
                        borderRadius: 6,
                        fontSize: 12,
                      }}
                    >
                      Show {stalePendingClients.length} task{stalePendingClients.length === 1 ? "" : "s"} older than {STALE_PENDING_DAYS} days
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Coach</th>
                    <th>Days Since Onboarding</th>
                    <th style={{ width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {visiblePendingClients
                    .filter((c) => filterBySearch(c.name, c.email))
                    .sort((a, b) => daysSince(b.onboardingDate || b.startDate) - daysSince(a.onboardingDate || a.startDate))
                    .map((client) => {
                      const days = daysSince(client.onboardingDate || client.startDate);
                      const form = getFormForClient(client);
                      const isExpanded = expandedClientId === client.id;

                      return (
                        <React.Fragment key={client.id}>
                          <tr>
                            <td style={{ fontWeight: 600 }}>{client.name}</td>
                            <td>{client.coachName}</td>
                            <td>
                              <span style={{ color: urgencyColor(days), fontWeight: days >= 5 ? 700 : 400, display: "flex", alignItems: "center", gap: 4 }}>
                                {days >= 5 && <AlertTriangle size={13} />}
                                Day {days}
                                {days >= 7 && " — OVERDUE"}
                              </span>
                            </td>
                            <td>
                              <button
                                onClick={() => setExpandedClientId(isExpanded ? null : client.id!)}
                                style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                              >
                                {isExpanded ? "Hide" : "Open"}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={4} style={{ padding: 0 }}>
                                {USE_NUTRITION_V2_UI ? (
                                  <NutritionV2TaskPanel
                                    client={{
                                      id: client.id!,
                                      name: client.name,
                                      email: client.email,
                                    }}
                                    mode="pending"
                                    intakeForm={form}
                                    onRefreshClients={onRefreshClients}
                                  />
                                ) : (
                                  <MealPlanTaskPanel
                                    client={client}
                                    intakeForm={form}
                                    isDoneSection={false}
                                    onRefreshClients={onRefreshClients}
                                  />
                                )}
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                </tbody>
              </table>
            )}
            {/* Reveal toggle for stale pending tasks (>30 days). Default
                hidden; coach can opt in to see what was auto-treated as done. */}
            {stalePendingClients.length > 0 && (
              <div
                style={{
                  padding: "10px 12px",
                  borderTop: "1px solid rgba(255,255,255,0.06)",
                  textAlign: "center",
                }}
              >
                <button
                  onClick={() => setShowStalePending(!showStalePending)}
                  style={{
                    padding: "4px 12px",
                    border: "1px solid rgba(255,255,255,0.1)",
                    background: "none",
                    color: "var(--text-muted)",
                    cursor: "pointer",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                >
                  {showStalePending
                    ? `Hide ${stalePendingClients.length} task${stalePendingClients.length === 1 ? "" : "s"} older than ${STALE_PENDING_DAYS} days`
                    : `Show ${stalePendingClients.length} task${stalePendingClients.length === 1 ? "" : "s"} older than ${STALE_PENDING_DAYS} days`}
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---- Done Section ---- */}
      <div className="section">
        <button
          onClick={() => setExpandedDone(!expandedDone)}
          style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", color: "var(--text-primary)", fontSize: 16, fontWeight: 600, padding: 0, marginBottom: 12 }}
        >
          {expandedDone ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
          <CheckCircle size={16} style={{ color: "var(--success)" }} />
          Done
          <span style={{ background: "rgba(34,197,94,0.2)", color: "var(--success)", fontSize: 12, padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginLeft: 4 }}>
            {doneClients.length}
          </span>
        </button>

        {expandedDone && (
          <div className="glass-static" style={{ overflow: "auto" }}>
            {doneClients.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No completed meal plans yet.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Coach</th>
                    <th>Completed By</th>
                    <th>Completed On</th>
                    <th style={{ width: 100 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {doneClients
                    .filter((c) => filterBySearch(c.name, c.email))
                    .sort((a, b) => new Date(b.nutritionCompletedAt || "").getTime() - new Date(a.nutritionCompletedAt || "").getTime())
                    .map((client) => {
                      const isExpanded = expandedClientId === client.id;
                      const form = getFormForClient(client);
                      return (
                        <React.Fragment key={client.id}>
                          <tr>
                            <td style={{ fontWeight: 600 }}>{client.name}</td>
                            <td>{client.coachName}</td>
                            <td>{client.nutritionAssignedTo || "Daman"}</td>
                            <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                              {client.nutritionCompletedAt ? new Date(client.nutritionCompletedAt).toLocaleDateString() : "—"}
                            </td>
                            <td>
                              <button
                                onClick={() => setExpandedClientId(isExpanded ? null : client.id!)}
                                style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                              >
                                {isExpanded ? "Hide" : "Open"}
                              </button>
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan={5} style={{ padding: 0 }}>
                                <MealPlanTaskPanel
                                  client={client}
                                  intakeForm={form}
                                  isDoneSection={true}
                                  onRefreshClients={onRefreshClients}
                                />
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
