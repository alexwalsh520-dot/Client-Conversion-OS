// Shared types for the partner (creator/influencer) onboarding feature.

export type StepAudience = "client" | "internal";
// "ig_connect" is a virtual step the portal injects as step 1 (the client's
// personal Instagram-connect link) — it never exists as an onboarding_steps row.
export type StepKind =
  | "task"
  | "login"
  | "twofa"
  | "link"
  | "text"
  | "bank"
  | "ig_connect"
  | "meta_token";

/** The partner's personal Instagram-connect link + live status. */
export interface PartnerIgConnect {
  url: string;
  connected: boolean;
  username: string | null;
}
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
  /**
   * Extra status for the meta_token step: whether the pasted token was
   * auto-extended to a long-lived one, its expiry, or the exchange error.
   * `{ long_lived, expires_at, exchanged_at }` or `{ exchange_error, ... }`.
   */
  tokenMeta?: Record<string, unknown> | null;
}

/** What the public welcome page receives (no other partners' data, no raw creds). */
export interface PublicPartnerView {
  name: string;
  status: PartnerStatus;
  steps: OnboardingStep[];
  progress: StepProgress[];
  /** Which platforms already have a saved login (so the form can show "saved"). */
  savedCredentialPlatforms: string[];
  /** Their personal IG-connect link — rendered as step 1 of the flow. */
  igConnect: PartnerIgConnect | null;
}

/** Full partner detail for the back office. */
export interface PartnerDetail extends OnboardingPartner {
  progress: StepProgress[];
  credentials: PartnerCredential[];
  igConnect: PartnerIgConnect | null;
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
  /** For the meta_token step (Meta / Facebook API access). */
  appId?: string;
  appSecret?: string;
  token?: string;
  /** Explicit completion toggle (e.g. bank/task steps). */
  completed?: boolean;
  /**
   * Auto-save (background) rather than an explicit "Continue" tap. Server treats
   * it the same, but the client uses this to keep partial answers safe as the
   * partner types without advancing the flow.
   */
  autosave?: boolean;
}
