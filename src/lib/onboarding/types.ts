// Shared types for the partner (creator/influencer) onboarding feature.

export type StepAudience = "client" | "internal";
export type StepKind = "task" | "login" | "twofa" | "link" | "text" | "bank";
export type PartnerStatus = "invited" | "in_progress" | "submitted" | "complete";

export interface OnboardingStep {
  id: string;
  title: string;
  description: string | null;
  audience: StepAudience;
  kind: StepKind;
  sort_order: number;
  sop_slug: string | null;
  sop_url: string | null;
  meta: Record<string, unknown> | null;
  active: boolean;
}

export interface OnboardingPartner {
  id: string;
  token: string;
  name: string;
  handle: string | null;
  email: string | null;
  status: PartnerStatus;
  created_at: string;
  updated_at: string;
}

export interface StepProgress {
  step_id: string;
  completed: boolean;
  value: string | null;
  completed_at: string | null;
}

/** Decrypted credential — only ever leaves the server for authenticated admins. */
export interface PartnerCredential {
  id: string;
  step_id: string | null;
  platform: string;
  username: string | null;
  secret: string | null;
  twofa: string | null;
  notes: string | null;
}

/** What the public welcome page receives (no other partners' data, no raw creds). */
export interface PublicPartnerView {
  name: string;
  status: PartnerStatus;
  steps: OnboardingStep[];
  progress: StepProgress[];
  /** Which platforms already have a saved login (so the form can show "saved"). */
  savedCredentialPlatforms: string[];
}

/** Full partner detail for the back office. */
export interface PartnerDetail extends OnboardingPartner {
  progress: StepProgress[];
  credentials: PartnerCredential[];
}

/** Row in the back-office partner list. */
export interface PartnerListItem extends OnboardingPartner {
  clientStepsTotal: number;
  clientStepsDone: number;
  internalStepsTotal: number;
  internalStepsDone: number;
}

/** Shape of a single submission from the public form. */
export interface PublicStepSubmission {
  stepId: string;
  /** For text/link steps. */
  value?: string;
  /** For login/twofa steps. */
  username?: string;
  secret?: string;
  twofa?: string;
  notes?: string;
  /** Explicit completion toggle (e.g. bank/task steps). */
  completed?: boolean;
}
