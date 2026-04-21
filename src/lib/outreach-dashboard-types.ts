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
