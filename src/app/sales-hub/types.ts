export type Client = "tyson" | "antwan" | "all";
export type DatePreset = "mtd" | "last7" | "last30" | "custom";

export interface Filters {
  client: Client;
  datePreset: DatePreset;
  dateFrom: string;
  dateTo: string;
}

export interface SheetRow {
  callNumber: string;
  date: string;
  name: string;
  callTaken: boolean;
  callTakenStatus: "yes" | "no" | "pending";
  callLength: string;
  recorded: boolean;
  outcome: string;
  closer: string;
  objection: string;
  programLength: string;
  revenue: number;
  cashCollected: number;
  method: string;
  setter: string;
  callNotes: string;
  recordingLink: string;
  offer: string;
}

export interface ManychatDashboard {
  newLeads: number;
  leadsEngaged: number;
  callLinksSent: number;
  subLinksSent: number;
}

export interface LeadSourceMetric {
  id:
    | "direct_cta_ad"
    | "lead_magnet_ad"
    | "direct_coaching_organic_cta"
    | "organic_lead_magnet"
    | "unmapped";
  label: string;
  newLeads: number;
  callsBooked: number;
  callsTaken: number;
  wins: number;
  noShows: number;
  cashCollected: number;
}

export interface ManychatFunnelStage {
  id: string;
  label: string;
  count: number;
  tracked: boolean;
}

export interface ManychatMetrics {
  dashboard: ManychatDashboard;
  leadSources: LeadSourceMetric[];
  funnel: ManychatFunnelStage[];
  setters: Record<string, ManychatDashboard>;
  tagsDetected: boolean;
}
