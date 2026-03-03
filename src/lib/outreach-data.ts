// TODO: Replace mock data with real API calls
// GHL API: https://services.leadconnectorhq.com (needs server-side proxy)
// Smartlead API: https://server.smartlead.ai/api/v1 (needs server-side proxy)
// These APIs require authentication and should be called from a backend/serverless function

// ── Pipeline stages ─────────────────────────────────────────────
export interface PipelineStage {
  name: string;
  count: number;
  color: string;
}

export interface ActivityItem {
  message: string;
  timestamp: string;
  type: "import" | "email" | "dm" | "reply" | "move";
}

export interface ChannelPerformance {
  sent: { total: number; today: number };
  replyRate: number;
  activeSequences: number;
}

export interface EmailPerformance extends ChannelPerformance {
  openRate: number;
  bounceRate: number;
  domainsActive: number;
}

export interface DMPerformance extends ChannelPerformance {
  responseRate: number;
  igAccountsActive: number;
}

export interface DailyTrend {
  date: string;
  leadsImported: number;
  emailsSent: number;
  dmsSent: number;
  repliesReceived: number;
}

// ── Top-level stats ─────────────────────────────────────────────
export const topStats = {
  totalLeadsInPipeline: 2850,
  leadsContactedToday: 98,
  emailsSentToday: 1047,
  dmsSentToday: 723,
  emailReplyRate: 3.5,
  dmReplyRate: 5.2,
  activeSequences: 2180,
};

// ── Pipeline stages ─────────────────────────────────────────────
export const pipelineStages: PipelineStage[] = [
  { name: "New Lead", count: 50, color: "#6b8cff" },
  { name: "Contacted", count: 2400, color: "#5b9bd5" },
  { name: "Follow Up Needed", count: 200, color: "#82c5c5" },
  { name: "In Contact", count: 85, color: "#7ec9a0" },
  { name: "In Contact (Contacted)", count: 72, color: "#6dbb8a" },
  { name: "In Contact (Follow Up Needed)", count: 43, color: "#5cad74" },
  { name: "Lost", count: 150, color: "#d98e8e" },
];

// ── Activity feed ───────────────────────────────────────────────
export const activityFeed: ActivityItem[] = [
  {
    message: "Imported 100 new leads from CSV",
    timestamp: new Date(Date.now() - 1000 * 60 * 12).toISOString(),
    type: "import",
  },
  {
    message: "Added 98 leads to Smartlead campaign",
    timestamp: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
    type: "email",
  },
  {
    message: "Generated DM queue: 95 Day 1, 340 follow-ups",
    timestamp: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    type: "dm",
  },
  {
    message: "3 email replies received",
    timestamp: new Date(Date.now() - 1000 * 60 * 45).toISOString(),
    type: "reply",
  },
  {
    message: "Moved 2 leads to In Contact",
    timestamp: new Date(Date.now() - 1000 * 60 * 50).toISOString(),
    type: "move",
  },
  {
    message: "5 DM replies received",
    timestamp: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    type: "reply",
  },
  {
    message: "Imported 100 new leads from CSV",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24).toISOString(),
    type: "import",
  },
  {
    message: "Added 97 leads to Smartlead campaign",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 - 1000 * 60).toISOString(),
    type: "email",
  },
  {
    message: "Generated DM queue: 97 Day 1, 328 follow-ups",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 24 - 1000 * 60 * 2).toISOString(),
    type: "dm",
  },
  {
    message: "7 email replies received",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 25).toISOString(),
    type: "reply",
  },
  {
    message: "Moved 4 leads to In Contact",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
    type: "move",
  },
  {
    message: "2 leads marked as Lost (bounced email)",
    timestamp: new Date(Date.now() - 1000 * 60 * 60 * 27).toISOString(),
    type: "move",
  },
];

// ── Channel performance ─────────────────────────────────────────
export const emailPerformance: EmailPerformance = {
  sent: { total: 28450, today: 1047 },
  openRate: 44.8,
  replyRate: 3.5,
  bounceRate: 2.1,
  activeSequences: 1340,
  domainsActive: 8,
};

export const dmPerformance: DMPerformance = {
  sent: { total: 18920, today: 723 },
  replyRate: 5.2,
  responseRate: 7.8,
  activeSequences: 840,
  igAccountsActive: 5,
};

// ── 30-day trend data ───────────────────────────────────────────
function generateTrendData(): DailyTrend[] {
  const data: DailyTrend[] = [];
  const now = new Date();

  for (let i = 29; i >= 0; i--) {
    const date = new Date(now);
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split("T")[0];

    // Ramp up over the first week, then stabilize
    const rampFactor = Math.min(1, (30 - i) / 7);
    const dayVariation = 0.8 + Math.random() * 0.4;

    data.push({
      date: dateStr,
      leadsImported: Math.round(100 * rampFactor * dayVariation),
      emailsSent: Math.round(
        (800 + Math.random() * 400) * rampFactor * dayVariation
      ),
      dmsSent: Math.round(
        (500 + Math.random() * 400) * rampFactor * dayVariation
      ),
      repliesReceived: Math.round(
        (15 + Math.random() * 25) * rampFactor * dayVariation
      ),
    });
  }

  return data;
}

export const trendData: DailyTrend[] = generateTrendData();
