// Shared TypeScript interfaces for CCOS (Client Conversion OS)

export interface InsightCard {
  id: string;
  type: 'alert' | 'opportunity' | 'win' | 'experiment' | 'bottleneck';
  priority: number;
  title: string;
  body: string;
  metric: {
    label: string;
    value: string;
    trend: 'up' | 'down' | 'flat';
    isGood: boolean;
  };
  impactDollars: number | null;
  impactLabel: string;
  actions: {
    label: string;
    type: 'navigate' | 'log' | 'slack' | 'model';
    payload: string;
  }[];
  relatedArea: 'funnel' | 'sales' | 'coaching' | 'ads';
  clientFilter: 'keith' | 'tyson' | 'both';
}

export interface BottleneckAnalysis {
  stage: string;
  currentRate: number;
  benchmarkRate: number;
  gap: number;
  revenueImpact: number;
  description: string;
}

export interface MoneyOnTable {
  total: number;
  breakdown: BottleneckAnalysis[];
  biggestLever: string;
}

export interface AdSpendScenario {
  currentSpend: number;
  newSpend: number;
  currentROI: number;
  projectedRevenue: number;
  projectedNewClients: number;
  revenueIncrease: number;
}

export type ClientFilter = 'keith' | 'tyson' | 'both';
export type XRayTab = 'funnel' | 'sales' | 'coaching' | 'ads';

// ============================================================
// Coaching Hub types (match Supabase coaching tables)
// ============================================================

export interface Client {
  id?: number;
  name: string;
  email: string;
  coachName: string;
  program: string;
  offer: string;
  startDate: string;
  endDate: string;
  onboardingDate: string | null; // Actual onboarding date (from Nicole's EOD confirmation)
  onboardingStatus: 'scheduled' | 'onboarded' | 'no_show' | 'rescheduled' | null;
  status: 'active' | 'paused' | 'completed' | 'cancelled' | 'refunded';
  paymentPlatform: string;
  salesFathomLink: string;
  onboardingFathomLink: string;
  amountPaid: number;
  salesPerson: string;
  comments: string;
  createdAt?: string;
}

export interface CoachMilestone {
  id?: number;
  clientId: number;
  clientName: string;
  coachName: string;
  trustPilotPromptedDate: string | null;
  trustPilotCompleted: boolean;
  trustPilotCompletionDate: string | null;
  videoTestimonialPromptedDate: string | null;
  videoTestimonialCompleted: boolean;
  videoTestimonialCompletionDate: string | null;
  retentionPromptedDate: string | null;
  retentionCompleted: boolean;
  retentionCompletionDate: string | null;
  referralPromptedDate: string | null;
  referralCompleted: boolean;
  referralCompletionDate: string | null;
}

export interface ProgramPause {
  id?: number;
  clientId: number;
  clientName: string;
  coachName: string;
  pauseStartDate: string;
  pauseDays: number;
  reason: string;
  approved: boolean;
  createdAt?: string;
}

export interface CoachMeeting {
  id?: number;
  clientId: number;
  clientName: string;
  coachName: string;
  meetingDate: string;
  durationMinutes: number;
  notes: string;
  createdAt?: string;
}

export interface CoachEODReport {
  id?: number;
  submittedBy: string;
  role: 'coach' | 'onboarding';
  date: string;
  activeClientCount: number;
  newClients: number;
  newClientNames: string[]; // Names of new clients (dropdown selections)
  accountsDeactivated: number;
  deactivatedClientNames: string[]; // Names of deactivated clients (dropdown selections)
  communityEngagement: string;
  summary: string;
  questionsForManagement: string;
  hoursLogged: number;
  feelingToday: string;
  videoTestimonialToday?: boolean;
  videoTestimonialClient?: string;
  createdAt?: string;
  // Joined from eod_client_checkins
  clientCheckins?: EODClientCheckin[];
}

export interface EODClientCheckin {
  id?: number;
  eodId: number;
  clientName: string;
  checkedIn: boolean;
  notes: string;
  // Nicole-specific: onboarding outcome for scheduled clients
  onboardingStatus?: 'onboarded' | 'no_show' | 'rescheduled' | 'internal_meeting';
  // Onboarding details (populated when status is 'onboarded')
  onboardingCoach?: string;
  onboardingStartDate?: string;
  onboardingEndDate?: string;
  onboardingProgram?: string; // '6 Weeks' | '12 Weeks' | '24 Weeks' | '48 Weeks'
  onboardingOffer?: string; // 'Tyson' | 'Keith' | etc.
  onboardingSalesPerson?: string;
  onboardingFathomLink?: string;
  onboardingPaymentComments?: string;
}

export interface FinanceRecord {
  id?: number;
  clientId: number;
  clientName: string;
  coachName: string;
  amountPaid: number;
  refundAmount: number;
  refundReason: string;
  refundDate: string | null;
  retentionRevenue: number;
  retentionDate: string | null;
}

export type CoachingTab = 'roster' | 'onboarding' | 'performance' | 'meetings' | 'milestones' | 'eod' | 'financials';
