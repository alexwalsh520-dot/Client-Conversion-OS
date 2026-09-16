"use client";

/**
 * V3 Nutrition tab · client view. Three sections:
 *   1. Unlinked intake forms — same LinkFormsPanel as Onboarding, plus
 *      an Auto-connect button that fires /api/nutrition/auto-link.
 *   2. Pending meal plans — table with Generate-with-AI + Push-done +
 *      View-intake + Expand into the shared V2 task panel.
 *   3. Done — same V2 task panel in "done" mode so a revision can still
 *      be generated later.
 *
 * Everything talks to the existing V1/V2 nutrition endpoints. Phase 6
 * will decide whether V3 gets its own copies of these routes.
 */

import { useCallback, useMemo, useState } from "react";
import {
  UtensilsCrossed,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Search,
  Zap,
  Loader2,
  ChevronDown,
  ChevronRight,
  Eye,
  Copy,
  Check,
  X,
} from "lucide-react";
import type { NutritionIntakeForm } from "@/lib/types";
import LinkFormsPanel, {
  type UnlinkedForm,
} from "../onboarding/LinkFormsPanel";
import { NutritionV2TaskPanel } from "@/components/coaching/nutrition-v2/NutritionV2TaskPanel";
import GenerateWithAiButton from "@/components/coaching/nutrition-v2/GenerateWithAiButton";
import PushDoneButton from "@/components/coaching/nutrition-v2/PushDoneButton";

export type PendingRow = {
  id: number;
  name: string;
  email: string;
  coach: string;
  program: string;
  status: string;
  startDate: string;
  onboardingDate: string;
  daysSinceOnboarding: number;
  nutritionFormId: number | null;
  nutritionStatus: string;
  nutritionAssignedTo: string;
  nutritionAssignedAt: string;
  nutritionCompletedAt: string;
  intakeForm: NutritionIntakeForm | null;
};

type Props = {
  viewer: { isAdmin: boolean; email: string };
  unlinkedForms: UnlinkedForm[];
  clientDirectory: { id: number; name: string; email: string }[];
  pending: PendingRow[];
  done: PendingRow[];
  stalePendingDays: number;
};

type AutoLinkResult =
  | {
      linked: { clientName: string; formName: string; matchType: string }[];
      ambiguous: { formName: string; reason: string }[];
      error?: undefined;
    }
  | { linked: []; ambiguous: []; error: string };

function urgencyColor(days: number): string {
  if (days >= 7) return "var(--danger)";
  if (days >= 5) return "var(--warning)";
  return "var(--text-muted)";
}
function fmtDate(iso: string): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function NutritionView({
  viewer,
  unlinkedForms,
  clientDirectory,
  pending,
  done,
  stalePendingDays,
}: Props) {
  const [search, setSearch] = useState("");
  const [expandUnlinked, setExpandUnlinked] = useState(true);
  const [expandPending, setExpandPending] = useState(true);
  const [expandDone, setExpandDone] = useState(false);
  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);
  const [expandedIntakeClientId, setExpandedIntakeClientId] = useState<number | null>(null);
  const [showStale, setShowStale] = useState(false);

  const [autoLinking, setAutoLinking] = useState(false);
  const [autoResult, setAutoResult] = useState<AutoLinkResult | null>(null);

  // Match legacy filtering by name/email.
  const filterBy = useCallback(
    (row: { name: string; email: string }) => {
      if (!search.trim()) return true;
      const q = search.trim().toLowerCase();
      return (
        row.name.toLowerCase().includes(q) ||
        (row.email ?? "").toLowerCase().includes(q)
      );
    },
    [search],
  );

  const freshPending = useMemo(
    () => pending.filter((c) => c.daysSinceOnboarding <= stalePendingDays),
    [pending, stalePendingDays],
  );
  const stalePending = useMemo(
    () => pending.filter((c) => c.daysSinceOnboarding > stalePendingDays),
    [pending, stalePendingDays],
  );
  const visiblePending = showStale ? pending : freshPending;
  const filteredPending = visiblePending.filter(filterBy);
  const filteredDone = done.filter(filterBy);

  const runAutoLink = async () => {
    setAutoLinking(true);
    setAutoResult(null);
    try {
      const res = await fetch("/api/nutrition/auto-link", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setAutoResult({ linked: [], ambiguous: [], error: body.error ?? `HTTP ${res.status}` });
      } else {
        setAutoResult({
          linked: (body.linked ?? []).map(
            (r: { clientName?: string; formName?: string; matchType?: string }) => ({
              clientName: r.clientName ?? "",
              formName: r.formName ?? "",
              matchType: r.matchType ?? "",
            }),
          ),
          ambiguous: (body.ambiguous ?? []).map(
            (r: { formName?: string; reason?: string }) => ({
              formName: r.formName ?? "",
              reason: r.reason ?? "",
            }),
          ),
        });
        // Refresh so any newly-linked forms drop out of the Unlinked
        // list. Simplest option — the page is already server-rendered.
        if (((body.linked ?? []) as unknown[]).length > 0) {
          setTimeout(() => window.location.reload(), 1200);
        }
      }
    } catch (e) {
      setAutoResult({
        linked: [],
        ambiguous: [],
        error: e instanceof Error ? e.message : String(e),
      });
    } finally {
      setAutoLinking(false);
    }
  };

  const refresh = () => window.location.reload();

  return (
    <>
      <div className="h3-kpis" style={{ marginTop: 6 }}>
        <Kpi label="Unlinked forms" value={String(unlinkedForms.length)} tone={unlinkedForms.length ? "a" : undefined} />
        <Kpi label="Pending (fresh)" value={String(freshPending.length)} tone={freshPending.some((c) => c.daysSinceOnboarding >= 7) ? "r" : undefined} />
        <Kpi label="Pending (older)" value={String(stalePending.length)} />
        <Kpi label="Done" value={String(done.length)} tone="g" />
      </div>

      <div
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-primary)",
          borderRadius: 10,
          padding: 14,
          fontSize: 12.5,
          color: "var(--text-muted)",
          margin: "0 0 16px",
          lineHeight: 1.6,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8, color: "var(--text-primary)", fontWeight: 600 }}>
          <UtensilsCrossed size={13} /> Nutrition meal plan process
        </div>
        <ol style={{ margin: 0, paddingLeft: 20 }}>
          <li><b>Unlinked:</b> Intake forms not yet paired with a roster client. Link one below, or hit Auto-connect for exact email/name matches.</li>
          <li><b>Pending:</b> Linked but the plan hasn&apos;t been delivered. Use Generate with AI, then Push done once the PDF is in the client&apos;s hands.</li>
          <li><b>Done:</b> Delivered plans. Re-open a row to generate a revision if the client asks for one.</li>
        </ol>
      </div>

      <div style={{ position: "relative", marginBottom: 14 }}>
        <Search size={13} style={{ position: "absolute", left: 10, top: 10, color: "var(--text-muted)" }} />
        <input
          className="h3-in"
          style={{ width: "100%", paddingLeft: 30 }}
          placeholder="Search pending or done by name or email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* ---- Unlinked ---- */}
      <section className="h3-sec">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setExpandUnlinked((v) => !v)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "inherit", fontWeight: "inherit" }}
          >
            {expandUnlinked ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <UtensilsCrossed size={13} />
            Unlinked intake forms
          </button>
          <span className="n">{unlinkedForms.length}</span>
          <span style={{ flex: 1 }} />
          <button
            className="h3-btn p"
            onClick={runAutoLink}
            disabled={autoLinking || unlinkedForms.length === 0}
            title="Auto-link forms whose email or full name exactly matches a client"
          >
            {autoLinking ? <Loader2 size={12} className="spin" /> : <Zap size={12} />}
            {autoLinking ? "Matching…" : "Auto-connect matches"}
          </button>
        </h2>
        {expandUnlinked && (
          <>
            {autoResult && (
              <div
                style={{
                  margin: "10px 14px",
                  padding: 10,
                  borderRadius: 8,
                  fontSize: 12,
                  border: autoResult.error
                    ? "1px solid rgba(239,68,68,0.4)"
                    : "1px solid var(--border-primary)",
                  background: autoResult.error ? "rgba(239,68,68,0.08)" : "var(--bg-card)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <strong style={{ color: autoResult.error ? "var(--danger)" : "var(--text-primary)" }}>
                    {autoResult.error
                      ? `Auto-link failed: ${autoResult.error}`
                      : `Auto-connect: ${autoResult.linked.length} linked${autoResult.ambiguous.length ? `, ${autoResult.ambiguous.length} ambiguous` : ""}`}
                  </strong>
                  <button
                    onClick={() => setAutoResult(null)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}
                    aria-label="Dismiss"
                  >
                    <X size={12} />
                  </button>
                </div>
                {autoResult.linked && autoResult.linked.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--text-muted)" }}>
                    {autoResult.linked.map((l, i) => (
                      <li key={i}>
                        <b>{l.formName}</b> → {l.clientName} <em>({l.matchType})</em>
                      </li>
                    ))}
                  </ul>
                )}
                {autoResult.ambiguous && autoResult.ambiguous.length > 0 && (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, color: "var(--warning)" }}>
                    {autoResult.ambiguous.map((a, i) => (
                      <li key={i}>
                        {a.formName}: {a.reason}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="h3-list">
              {unlinkedForms.length === 0 ? (
                <div className="h3-empty">Every recent intake form is linked. 👍</div>
              ) : (
                <LinkFormsPanel forms={unlinkedForms} clientDirectory={clientDirectory} />
              )}
            </div>
          </>
        )}
      </section>

      {/* ---- Pending ---- */}
      <section className="h3-sec">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setExpandPending((v) => !v)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "inherit", fontWeight: "inherit" }}
          >
            {expandPending ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <Clock size={13} />
            Pending meal plans
          </button>
          <span className="n">{freshPending.length}</span>
          {stalePending.length > 0 && (
            <button
              className="h3-btn s"
              onClick={() => setShowStale((v) => !v)}
              title={`${stalePending.length} tasks older than ${stalePendingDays} days`}
            >
              {showStale
                ? `Hide older (${stalePending.length})`
                : `Show older (${stalePending.length})`}
            </button>
          )}
        </h2>
        {expandPending && (
          <div style={{ overflowX: "auto" }}>
            {filteredPending.length === 0 ? (
              <div className="h3-empty">
                {search.trim()
                  ? "No pending clients match your search."
                  : "No pending meal plan tasks."}
              </div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                    <Th>Client</Th>
                    <Th>Coach</Th>
                    <Th>Days since onboarding</Th>
                    <Th style={{ minWidth: 260 }}>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPending.map((row) => (
                    <PendingRow
                      key={row.id}
                      row={row}
                      isExpanded={expandedClientId === row.id}
                      isIntakeExpanded={expandedIntakeClientId === row.id}
                      onToggleExpanded={() =>
                        setExpandedClientId(expandedClientId === row.id ? null : row.id)
                      }
                      onToggleIntake={() =>
                        setExpandedIntakeClientId(
                          expandedIntakeClientId === row.id ? null : row.id,
                        )
                      }
                      isAdmin={viewer.isAdmin}
                      onRefresh={refresh}
                      mode="pending"
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>

      {/* ---- Done ---- */}
      <section className="h3-sec">
        <h2 style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button
            onClick={() => setExpandDone((v) => !v)}
            style={{ background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-primary)", display: "inline-flex", alignItems: "center", gap: 6, fontSize: "inherit", fontWeight: "inherit" }}
          >
            {expandDone ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
            <CheckCircle2 size={13} style={{ color: "var(--success)" }} />
            Done
          </button>
          <span className="n">{done.length}</span>
        </h2>
        {expandDone && (
          <div style={{ overflowX: "auto" }}>
            {filteredDone.length === 0 ? (
              <div className="h3-empty">No completed meal plans yet.</div>
            ) : (
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
                <thead>
                  <tr style={{ color: "var(--text-muted)", textAlign: "left" }}>
                    <Th>Client</Th>
                    <Th>Coach</Th>
                    <Th>Completed by</Th>
                    <Th>Completed on</Th>
                    <Th style={{ minWidth: 160 }}>Actions</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredDone.map((row) => (
                    <DoneRow
                      key={row.id}
                      row={row}
                      isExpanded={expandedClientId === row.id}
                      isIntakeExpanded={expandedIntakeClientId === row.id}
                      onToggleExpanded={() =>
                        setExpandedClientId(expandedClientId === row.id ? null : row.id)
                      }
                      onToggleIntake={() =>
                        setExpandedIntakeClientId(
                          expandedIntakeClientId === row.id ? null : row.id,
                        )
                      }
                      onRefresh={refresh}
                    />
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------------------

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "r" | "a" | "g";
}) {
  return (
    <div className="h3-kpi">
      <div className="l">{label}</div>
      <div className={`v ${tone ?? ""}`}>{value}</div>
    </div>
  );
}

function Th({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <th
      style={{
        padding: "8px 12px",
        fontSize: 10.5,
        letterSpacing: 0.05,
        textTransform: "uppercase",
        fontWeight: 600,
        borderBottom: "1px solid var(--border-primary)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <td
      style={{
        padding: "8px 12px",
        borderBottom: "1px solid var(--border-primary)",
        verticalAlign: "middle",
        fontVariantNumeric: "tabular-nums",
        ...style,
      }}
    >
      {children}
    </td>
  );
}

// ---------------------------------------------------------------------------

function PendingRow({
  row,
  isExpanded,
  isIntakeExpanded,
  onToggleExpanded,
  onToggleIntake,
  isAdmin,
  onRefresh,
  mode,
}: {
  row: PendingRow;
  isExpanded: boolean;
  isIntakeExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleIntake: () => void;
  isAdmin: boolean;
  onRefresh: () => void;
  mode: "pending" | "done";
}) {
  const days = row.daysSinceOnboarding;
  return (
    <>
      <tr>
        <Td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>{row.name}</span>
            {row.email && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
                {row.email}
              </span>
            )}
          </div>
        </Td>
        <Td>{row.coach || "—"}</Td>
        <Td>
          <span
            style={{
              color: urgencyColor(days),
              fontWeight: days >= 5 ? 700 : 400,
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {days >= 5 && <AlertTriangle size={12} />}
            Day {days}
            {days >= 7 && " · overdue"}
          </span>
        </Td>
        <Td>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <GenerateWithAiButton clientId={row.id} />
            {isAdmin && (
              <PushDoneButton
                clientId={row.id}
                clientName={row.name}
                onDone={onRefresh}
              />
            )}
            {row.intakeForm && (
              <button className="h3-btn s" onClick={onToggleIntake}>
                <Eye size={11} /> {isIntakeExpanded ? "Hide intake" : "View intake"}
              </button>
            )}
            <button className="h3-btn s" onClick={onToggleExpanded}>
              {isExpanded ? "Hide" : "Open"}
            </button>
          </div>
        </Td>
      </tr>
      {isIntakeExpanded && row.intakeForm && (
        <tr>
          <td colSpan={4} style={{ padding: 14, background: "var(--bg-card)" }}>
            <IntakeFormDetail form={row.intakeForm} />
          </td>
        </tr>
      )}
      {isExpanded && (
        <tr>
          <td colSpan={4} style={{ padding: 0 }}>
            <NutritionV2TaskPanel
              client={{ id: row.id, name: row.name, email: row.email }}
              mode={mode}
              intakeForm={row.intakeForm ?? undefined}
              onRefreshClients={onRefresh}
            />
          </td>
        </tr>
      )}
    </>
  );
}

function DoneRow({
  row,
  isExpanded,
  isIntakeExpanded,
  onToggleExpanded,
  onToggleIntake,
  onRefresh,
}: {
  row: PendingRow;
  isExpanded: boolean;
  isIntakeExpanded: boolean;
  onToggleExpanded: () => void;
  onToggleIntake: () => void;
  onRefresh: () => void;
}) {
  return (
    <>
      <tr>
        <Td style={{ fontWeight: 600, color: "var(--text-primary)" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <span>{row.name}</span>
            {row.email && (
              <span style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 400 }}>
                {row.email}
              </span>
            )}
          </div>
        </Td>
        <Td>{row.coach || "—"}</Td>
        <Td>{row.nutritionAssignedTo || "—"}</Td>
        <Td>{row.nutritionCompletedAt ? fmtDate(row.nutritionCompletedAt) : "—"}</Td>
        <Td>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            {row.intakeForm && (
              <button className="h3-btn s" onClick={onToggleIntake}>
                <Eye size={11} /> {isIntakeExpanded ? "Hide intake" : "View intake"}
              </button>
            )}
            <button className="h3-btn s" onClick={onToggleExpanded}>
              {isExpanded ? "Hide" : "Open"}
            </button>
          </div>
        </Td>
      </tr>
      {isIntakeExpanded && row.intakeForm && (
        <tr>
          <td colSpan={5} style={{ padding: 14, background: "var(--bg-card)" }}>
            <IntakeFormDetail form={row.intakeForm} />
          </td>
        </tr>
      )}
      {isExpanded && (
        <tr>
          <td colSpan={5} style={{ padding: 0 }}>
            <NutritionV2TaskPanel
              client={{ id: row.id, name: row.name, email: row.email }}
              mode="done"
              intakeForm={row.intakeForm ?? undefined}
              onRefreshClients={onRefresh}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// V3-local intake preview (legacy version lives inside NutritionTab.tsx and
// isn't exported; per the "don't modify existing coaching UI" rule we don't
// touch that file, so we keep a slim copy here).
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  if (!text) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: copied ? "var(--success)" : "var(--text-muted)",
        padding: 2,
        display: "inline-flex",
      }}
      title="Copy"
    >
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </button>
  );
}

function IntakeFormDetail({ form }: { form: NutritionIntakeForm }) {
  const fields: { label: string; value: string }[] = [
    { label: "Name", value: `${form.firstName} ${form.lastName}`.trim() },
    { label: "Email", value: form.email },
    { label: "Phone", value: form.phone },
    {
      label: "Address",
      value: [form.address, form.city, form.state, form.zipCode].filter(Boolean).join(", "),
    },
    { label: "Age", value: form.age ? String(form.age) : "" },
    { label: "Height", value: form.height },
    { label: "Current weight", value: form.currentWeight },
    { label: "Goal weight", value: form.goalWeight },
    { label: "Fitness goal", value: form.fitnessGoal },
    { label: "Foods enjoyed", value: form.foodsEnjoy },
    { label: "Foods to avoid", value: form.foodsAvoid },
    { label: "Allergies / medical", value: form.allergies },
    { label: "Protein preferences", value: form.proteinPreferences },
    { label: "Can cook / meal prep", value: form.canCook },
    { label: "Preferred meal count", value: form.mealCount },
    { label: "Medications", value: form.medications },
    { label: "Supplements", value: form.supplements },
    { label: "Sleep hours", value: form.sleepHours },
    { label: "Water intake", value: form.waterIntake },
    { label: "Daily meals", value: form.dailyMealsDescription },
    { label: "Daily meals (cont.)", value: form.dailyMealsDescription2 },
    { label: "Under medical supervision?", value: form.medicalSupervisionYn },
    { label: "Medical supervision detail", value: form.medicalSupervisionDetail },
  ].filter((f) => f.value && f.value.trim().length > 0);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
      {fields.map((f) => (
        <div
          key={f.label}
          style={{
            padding: "6px 10px",
            background: "var(--bg-secondary)",
            borderRadius: 6,
            border: "1px solid var(--border-primary)",
          }}
        >
          <div
            style={{
              color: "var(--text-muted)",
              fontSize: 10.5,
              marginBottom: 2,
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {f.label} <CopyButton text={f.value} />
          </div>
          <div style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {f.value}
          </div>
        </div>
      ))}
    </div>
  );
}

