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
  // 2026-04-30 simplification (migration 023): collapsed to two values.
  //   active    = client is currently on the program
  //   completed = client is no longer on the program (finished, refunded,
  //               cancelled — all roll up to "completed")
  // Legacy values (paused, retained, cancelled, refunded) were migrated
  // into one of the two and a CHECK constraint enforces the contract DB-side.
  status: 'active' | 'completed';
  paymentPlatform: string;
  salesFathomLink: string;
  onboardingFathomLink: string;
  amountPaid: number;
  salesPerson: string;
  comments: string;
  phoneNumber: string;
  nutritionFormId: number | null;
  nutritionStatus: '' | 'pending' | 'assigned' | 'done';
  nutritionAssignedTo: string;
  nutritionAssignedAt: string | null;
  nutritionCompletedAt: string | null;
  nutritionChecklistAllergies: boolean;
  nutritionChecklistEverfit: boolean;
  nutritionChecklistMessage: boolean;
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
  role: 'coach' | 'onboarding' | 'nutrition';
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
  onboardingEmail?: string;
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

export type CoachingTab = 'roster' | 'onboarding' | 'performance' | 'meetings' | 'milestones' | 'eod' | 'financials' | 'expenses' | 'nutrition';

export interface Expense {
  id?: number;
  month: string;        // 'YYYY-MM'
  name: string;
  role: string;
  base: number;
  commissions: number;
  platform: string;
  comments: string;
  createdAt?: string;
}

export interface NutritionIntakeForm {
  id?: number;
  timestamp: string | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  age: number | null;
  height: string;
  currentWeight: string;
  goalWeight: string;
  fitnessGoal: string;
  foodsEnjoy: string;
  foodsAvoid: string;
  allergies: string;
  proteinPreferences: string;
  canCook: string;
  mealCount: string;
  medications: string;
  supplements: string;
  sleepHours: string;
  waterIntake: string;
  dailyMealsDescription: string;
  dailyMealsDescription2: string;
  // Two new questions added to the intake form (2026-04-30):
  //   medicalSupervisionYn     — "Yes"/"No" to "are you working with a
  //                              dietitian/nutritionist/healthcare provider
  //                              on a prescribed diet plan?"
  //   medicalSupervisionDetail — when Yes: free-text describing what they're
  //                              being treated for + any dietary guidelines
  //                              from the provider. Coaches use this to
  //                              decide safety / referral.
  medicalSupervisionYn: string;
  medicalSupervisionDetail: string;
  dietPlanSent: string;
  createdAt?: string;
}
