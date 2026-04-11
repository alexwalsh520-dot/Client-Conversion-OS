"use client";

import { useState } from "react";
import {
  Salad,
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
} from "lucide-react";
import type { Client, NutritionIntakeForm } from "@/lib/types";

interface Props {
  clients: Client[];
  nutritionForms: NutritionIntakeForm[];
  onLinkForm: (clientId: number, nutritionFormId: number) => Promise<void>;
  onAssignTask: (clientId: number, assignedTo: string) => Promise<void>;
  onCompleteTask: (clientId: number, checklist: { checklistAllergies: boolean; checklistEverfit: boolean; checklistMessage: boolean }) => Promise<void>;
  onUnlinkForm: (clientId: number) => Promise<void>;
}

// Assignment options
const ASSIGNEES = ["Daman", "FMZ"];

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

export default function NutritionTab({ clients, nutritionForms, onLinkForm, onAssignTask, onCompleteTask, onUnlinkForm }: Props) {
  const [expandedUnlinked, setExpandedUnlinked] = useState(true);
  const [expandedPending, setExpandedPending] = useState(true);
  const [expandedDone, setExpandedDone] = useState(false);
  const [expandedFormId, setExpandedFormId] = useState<number | null>(null);
  const [expandedClientId, setExpandedClientId] = useState<number | null>(null);
  const [search, setSearch] = useState("");

  // Link-from-unlinked state
  const [linkingFormId, setLinkingFormId] = useState<number | null>(null);
  const [linkClientSearch, setLinkClientSearch] = useState("");

  // Assignment state
  const [assigningClientId, setAssigningClientId] = useState<number | null>(null);
  const [customAssignee, setCustomAssignee] = useState("");

  // Checklist state
  const [checklist, setChecklist] = useState({ allergies: false, everfit: false, message: false });

  // Categorize forms and clients
  const linkedFormIds = new Set(clients.filter((c) => c.nutritionFormId).map((c) => c.nutritionFormId));
  const unlinkedForms = nutritionForms.filter((nf) => !linkedFormIds.has(nf.id));

  const pendingClients = clients.filter((c) => c.nutritionFormId && (c.nutritionStatus === "pending" || c.nutritionStatus === "assigned"));
  const doneClients = clients.filter((c) => c.nutritionFormId && c.nutritionStatus === "done");

  const getFormForClient = (client: Client) => nutritionForms.find((nf) => nf.id === client.nutritionFormId);

  // Search filter
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
          <li><strong>Unlinked:</strong> Intake forms submitted but not yet matched to a client. Link them to existing clients here.</li>
          <li><strong>Pending:</strong> Client onboarded — assign yourself and create their custom meal plan on Everfit.</li>
          <li><strong>Checklist:</strong> Before marking done: (1) no allergic items, (2) plan assigned in Everfit, (3) message sent to client.</li>
          <li><strong>Done:</strong> Meal plan completed and delivered.</li>
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
          <Salad size={16} />
          Unlinked Intake Forms
          <span style={{ background: "rgba(245,158,11,0.2)", color: "#f59e0b", fontSize: 12, padding: "2px 8px", borderRadius: 10, fontWeight: 600, marginLeft: 4 }}>
            {unlinkedForms.length}
          </span>
        </button>

        {expandedUnlinked && (
          <div className="glass-static" style={{ overflow: "auto" }}>
            {unlinkedForms.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No unlinked intake forms. All forms are matched to clients.
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
                  {unlinkedForms
                    .filter((nf) => filterBySearch(`${nf.firstName} ${nf.lastName}`, nf.email))
                    .map((nf) => (
                    <>
                      <tr key={nf.id}>
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
                        <tr key={`detail-${nf.id}`}>
                          <td colSpan={4} style={{ padding: 16, background: "rgba(255,255,255,0.02)" }}>
                            <IntakeFormDetail form={nf} />
                          </td>
                        </tr>
                      )}
                      {linkingFormId === nf.id && (
                        <tr key={`link-${nf.id}`}>
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
                    </>
                  ))}
                </tbody>
              </table>
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
            {pendingClients.length}
          </span>
        </button>

        {expandedPending && (
          <div className="glass-static" style={{ overflow: "auto" }}>
            {pendingClients.length === 0 ? (
              <div style={{ padding: 24, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>
                No pending meal plan tasks.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Client</th>
                    <th>Coach</th>
                    <th>Days Since Onboarding</th>
                    <th>Assigned To</th>
                    <th style={{ width: 120 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingClients
                    .filter((c) => filterBySearch(c.name, c.email))
                    .sort((a, b) => daysSince(b.onboardingDate || b.startDate) - daysSince(a.onboardingDate || a.startDate))
                    .map((client) => {
                      const days = daysSince(client.onboardingDate || client.startDate);
                      const form = getFormForClient(client);
                      const isAssigning = assigningClientId === client.id;
                      const isExpanded = expandedClientId === client.id;

                      return (
                        <>
                          <tr key={client.id}>
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
                              {client.nutritionStatus === "assigned" ? (
                                <span style={{ color: "var(--accent)", fontWeight: 600 }}>{client.nutritionAssignedTo}</span>
                              ) : (
                                <button
                                  onClick={() => setAssigningClientId(isAssigning ? null : client.id!)}
                                  style={{ padding: "3px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.15)", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 12 }}
                                >
                                  Assign
                                </button>
                              )}
                            </td>
                            <td>
                              <button
                                onClick={() => setExpandedClientId(isExpanded ? null : client.id!)}
                                style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: 11 }}
                              >
                                {isExpanded ? "Hide" : "View"}
                              </button>
                            </td>
                          </tr>
                          {isAssigning && (
                            <tr key={`assign-${client.id}`}>
                              <td colSpan={5} style={{ padding: 12, background: "rgba(255,255,255,0.02)" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
                                  <span style={{ color: "var(--text-muted)" }}>Assign to:</span>
                                  {ASSIGNEES.map((a) => (
                                    <button
                                      key={a}
                                      onClick={async () => { await onAssignTask(client.id!, a); setAssigningClientId(null); }}
                                      style={{ padding: "4px 12px", borderRadius: 6, border: "none", background: "var(--accent)", color: "#000", cursor: "pointer", fontWeight: 600, fontSize: 12 }}
                                    >
                                      {a}
                                    </button>
                                  ))}
                                  <input
                                    placeholder="Other..."
                                    value={customAssignee}
                                    onChange={(e) => setCustomAssignee(e.target.value)}
                                    onKeyDown={async (e) => {
                                      if (e.key === "Enter" && customAssignee.trim()) {
                                        await onAssignTask(client.id!, customAssignee.trim());
                                        setCustomAssignee("");
                                        setAssigningClientId(null);
                                      }
                                    }}
                                    style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "var(--text-primary)", fontSize: 12, width: 120 }}
                                  />
                                </div>
                              </td>
                            </tr>
                          )}
                          {isExpanded && (
                            <tr key={`detail-${client.id}`}>
                              <td colSpan={5} style={{ padding: 16, background: "rgba(255,255,255,0.02)" }}>
                                {form ? <IntakeFormDetail form={form} /> : <span style={{ color: "var(--text-muted)", fontSize: 13 }}>No intake form data available</span>}

                                {/* Checklist — only show when assigned */}
                                {client.nutritionStatus === "assigned" && (
                                  <div style={{ marginTop: 16, padding: 12, background: "rgba(255,255,255,0.03)", borderRadius: 8 }}>
                                    <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14, color: "var(--text-primary)" }}>Completion Checklist</div>
                                    {[
                                      { key: "allergies" as const, label: "Made sure no allergic items are assigned" },
                                      { key: "everfit" as const, label: "Meal plan assigned to client in Everfit" },
                                      { key: "message" as const, label: "Message sent to client in Everfit" },
                                    ].map(({ key, label }) => (
                                      <label key={key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", fontSize: 13, color: "var(--text-primary)" }}>
                                        <input
                                          type="checkbox"
                                          checked={checklist[key]}
                                          onChange={(e) => setChecklist({ ...checklist, [key]: e.target.checked })}
                                          style={{ accentColor: "var(--accent)" }}
                                        />
                                        {label}
                                      </label>
                                    ))}
                                    <button
                                      onClick={async () => {
                                        await onCompleteTask(client.id!, {
                                          checklistAllergies: checklist.allergies,
                                          checklistEverfit: checklist.everfit,
                                          checklistMessage: checklist.message,
                                        });
                                        setChecklist({ allergies: false, everfit: false, message: false });
                                        setExpandedClientId(null);
                                      }}
                                      disabled={!checklist.allergies || !checklist.everfit || !checklist.message}
                                      style={{
                                        marginTop: 10, padding: "8px 20px", borderRadius: 8, border: "none",
                                        background: (checklist.allergies && checklist.everfit && checklist.message) ? "var(--success)" : "rgba(255,255,255,0.1)",
                                        color: (checklist.allergies && checklist.everfit && checklist.message) ? "#000" : "var(--text-muted)",
                                        cursor: (checklist.allergies && checklist.everfit && checklist.message) ? "pointer" : "default",
                                        fontWeight: 600, fontSize: 13, display: "flex", alignItems: "center", gap: 6,
                                      }}
                                    >
                                      <CheckCircle size={14} /> Mark as Done
                                    </button>
                                  </div>
                                )}
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                </tbody>
              </table>
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
                  </tr>
                </thead>
                <tbody>
                  {doneClients
                    .filter((c) => filterBySearch(c.name, c.email))
                    .sort((a, b) => new Date(b.nutritionCompletedAt || "").getTime() - new Date(a.nutritionCompletedAt || "").getTime())
                    .map((client) => (
                      <tr key={client.id}>
                        <td style={{ fontWeight: 600 }}>{client.name}</td>
                        <td>{client.coachName}</td>
                        <td>{client.nutritionAssignedTo}</td>
                        <td style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {client.nutritionCompletedAt ? new Date(client.nutritionCompletedAt).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
