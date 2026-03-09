export type Client = "tyson" | "keith" | "all";
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

export interface ManychatMetrics {
  dashboard: ManychatDashboard;
  setters: Record<string, ManychatDashboard>;
  tagsDetected: boolean;
}
