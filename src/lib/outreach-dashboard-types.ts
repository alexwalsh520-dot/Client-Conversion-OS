export type OutreachRangePreset = "mtd" | "wtd" | "custom";

export interface OutreachRange {
  preset: OutreachRangePreset;
  startDate: string;
  endDate: string;
  timeZone: string;
}

export interface OutreachChannelMetrics {
  reachedInRange: number;
  reachedAllTime: number;
  messagesInRange: number;
  messagesAllTime: number;
  repliesInRange: number;
  replyRateInRange: number;
  interestedRepliesInRange: number;
  interestedReplyRateInRange: number;
  notInterestedRepliesInRange: number;
  notInterestedReplyRateInRange: number;
  avgFollowUpsToReplyInRange: number | null;
  // Opens — email only (Smartlead open tracking). DM leaves these at 0.
  opensInRange: number;
  openRateInRange: number;
  opensAllTime: number;
}

export interface OutreachCombinedMetrics {
  reachedInRange: number;
  reachedAllTime: number;
}

export interface OutreachSourceStatus {
  connected: boolean;
  label: string;
  description: string;
}

export interface OutreachChartPoint {
  date: string;
  label: string;
  emailMessages: number;
  emailOpens: number;
  dmMessages: number;
  emailReplies: number;
  dmReplies: number;
}

export interface OutreachDashboardResponse {
  range: OutreachRange;
  combined: OutreachCombinedMetrics;
  email: OutreachChannelMetrics;
  dm: OutreachChannelMetrics;
  sources: {
    email: OutreachSourceStatus;
    dm: OutreachSourceStatus;
  };
  chart: OutreachChartPoint[];
  notes: string[];
  generatedAt: string;
}
