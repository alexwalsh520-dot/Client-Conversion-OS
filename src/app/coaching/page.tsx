"use client";

import { useState, useCallback } from "react";
import {
  Users,
  UserPlus,
  Trophy,
  Calendar,
  Target,
  FileText,
  DollarSign,
  RefreshCw,
} from "lucide-react";
import {
  coachPerformance,
  coachingFeedback as mockFeedback,
  mockClients,
  mockMilestones,
  mockPauses,
  mockEODReports,
} from "@/lib/mock-data";
import {
  getCoachingFeedback,
  getClients,
  getMilestones,
  getPauses,
  getMeetings,
  getEODReports,
} from "@/lib/data";
import { useAsyncData } from "@/lib/use-data";
import type { CoachingTab, Client, CoachMeeting, CoachEODReport } from "@/lib/types";

import ClientRosterTab from "@/components/coaching/ClientRosterTab";
import OnboardingTab from "@/components/coaching/OnboardingTab";
import CoachPerformanceTab from "@/components/coaching/CoachPerformanceTab";
import MeetingsTab from "@/components/coaching/MeetingsTab";
import MilestonesTab from "@/components/coaching/MilestonesTab";
import EODReportsTab from "@/components/coaching/EODReportsTab";
import FinancialsTab from "@/components/coaching/FinancialsTab";

const TABS: { key: CoachingTab; label: string; icon: React.ReactNode }[] = [
  { key: "roster", label: "Client Roster", icon: <Users size={14} /> },
  { key: "onboarding", label: "Onboarding", icon: <UserPlus size={14} /> },
  { key: "performance", label: "Coach Performance", icon: <Trophy size={14} /> },
  { key: "meetings", label: "Meetings", icon: <Calendar size={14} /> },
  { key: "milestones", label: "Milestones", icon: <Target size={14} /> },
  { key: "eod", label: "EOD Reports", icon: <FileText size={14} /> },
  { key: "financials", label: "Financials", icon: <DollarSign size={14} /> },
];

export default function CoachingPage() {
  const [activeTab, setActiveTab] = useState<CoachingTab>("roster");

  // Load all data with fallbacks
  const { data: feedback } = useAsyncData(getCoachingFeedback, mockFeedback);
  const { data: clients, refetch: refetchClients } = useAsyncData(getClients, mockClients);
  const { data: milestones, refetch: refetchMilestones } = useAsyncData(getMilestones, mockMilestones);
  const { data: pauses, refetch: refetchPauses } = useAsyncData(getPauses, mockPauses);
  const { data: meetings, refetch: refetchMeetings } = useAsyncData(getMeetings, []);
  const { data: eodReports, refetch: refetchEOD } = useAsyncData(getEODReports, mockEODReports);
  // Sync state
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setSyncMsg(null);
    try {
      const res = await fetch("/api/sync", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Sync failed");
      setSyncMsg("Synced successfully");
      // Refresh all data
      refetchClients();
      refetchMilestones();
      refetchPauses();
      refetchMeetings();
      refetchEOD();
    } catch (err: unknown) {
      setSyncMsg(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setSyncing(false);
      setTimeout(() => setSyncMsg(null), 4000);
    }
  }, [refetchClients, refetchMilestones, refetchPauses, refetchMeetings, refetchEOD]);

  // API helper
  const apiCall = async (action: string, payload: unknown) => {
    const res = await fetch("/api/coaching", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, payload }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || "API error");
    }
    return res.json();
  };

  // Handlers
  const handleSaveClient = async (client: Partial<Client>) => {
    await apiCall("upsert_client", client);
    refetchClients();
  };

  const handleDeleteClient = async (clientId: number) => {
    await apiCall("delete_client", { id: clientId });
    refetchClients();
  };

  const handleSaveMeeting = async (meeting: Partial<CoachMeeting>) => {
    await apiCall("upsert_meeting", meeting);
    refetchMeetings();
  };

  const handleToggleMilestone = async (
    milestoneId: number | null,
    field: string,
    status: "completed" | "failed" | "pending",
    client?: { id: number; name: string; coachName: string },
  ) => {
    let id = milestoneId;
    // If no milestone row exists yet, create one first
    if (!id && client) {
      const result = await apiCall("upsert_milestone", {
        clientId: client.id,
        clientName: client.name,
        coachName: client.coachName,
      });
      id = result?.data?.id;
      if (!id) {
        await refetchMilestones();
        return; // Row created, user can click again
      }
    }
    if (id) {
      await apiCall("update_milestone_checkbox", { milestoneId: id, field, status });
    }
    refetchMilestones();
  };

  const handleSubmitEOD = async (report: Partial<CoachEODReport>) => {
    await apiCall("submit_eod", report);
    refetchEOD();
    // Refetch clients so newly onboarded clients appear in the roster immediately
    refetchClients();
  };

  const handleUpdateEOD = async (report: Partial<CoachEODReport>) => {
    await apiCall("update_eod", report);
    refetchEOD();
  };

  const handleDeleteEOD = async (id: number) => {
    await apiCall("delete_eod", { id });
    refetchEOD();
  };

  return (
    <div className="fade-up">
      {/* Header */}
      <div className="page-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <h1 className="page-title">Coaching Hub</h1>
          <p className="page-subtitle">
            Client management, coach performance, milestones, and daily operations
          </p>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {syncMsg && (
            <span style={{ fontSize: 12, color: syncMsg.includes("success") ? "var(--success)" : "var(--danger)" }}>
              {syncMsg}
            </span>
          )}
          <button
            onClick={handleSync}
            disabled={syncing}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 16px",
              borderRadius: 8,
              border: "1px solid var(--border)",
              cursor: syncing ? "not-allowed" : "pointer",
              fontSize: 13,
              fontWeight: 500,
              background: "var(--bg-glass)",
              color: "var(--text-primary)",
              opacity: syncing ? 0.6 : 1,
            }}
          >
            <RefreshCw size={14} style={{ animation: syncing ? "spin 1s linear infinite" : "none" }} />
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>

      {/* Tab Navigation */}
      <div style={{
        display: "flex",
        gap: 4,
        marginBottom: 24,
        overflowX: "auto",
        paddingBottom: 4,
      }}>
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "8px 14px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontSize: 13,
              fontWeight: activeTab === tab.key ? 600 : 400,
              background: activeTab === tab.key ? "var(--accent)" : "var(--bg-glass)",
              color: activeTab === tab.key ? "var(--bg-primary)" : "var(--text-secondary)",
              whiteSpace: "nowrap",
              transition: "all 0.15s ease",
            }}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <div className="section">
        {activeTab === "roster" && (
          <ClientRosterTab clients={clients} pauses={pauses} milestones={milestones} onSave={handleSaveClient} onDelete={handleDeleteClient} />
        )}
        {activeTab === "onboarding" && (
          <OnboardingTab clients={clients} />
        )}
        {activeTab === "performance" && (
          <CoachPerformanceTab
            clients={clients}
            milestones={milestones}
            meetings={meetings}
            eodReports={eodReports}
            coachPerformance={coachPerformance}
            feedback={feedback}
          />
        )}
        {activeTab === "meetings" && (
          <MeetingsTab meetings={meetings} clients={clients} onSave={handleSaveMeeting} />
        )}
        {activeTab === "milestones" && (
          <MilestonesTab clients={clients} milestones={milestones} onToggle={handleToggleMilestone} />
        )}
        {activeTab === "eod" && (
          <EODReportsTab reports={eodReports} clients={clients} onSubmit={handleSubmitEOD} onUpdate={handleUpdateEOD} onDelete={handleDeleteEOD} />
        )}
        {activeTab === "financials" && (
          <FinancialsTab />
        )}
      </div>
    </div>
  );
}
