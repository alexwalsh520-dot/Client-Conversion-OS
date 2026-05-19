// Testimonials feature types — shared between server routes and client UI.

export type TestimonialLeadStatus = "new" | "contacted" | "dismissed";

export interface TestimonialLead {
  id: number;
  name: string;
  email: string;
  phone: string;
  message: string | null;
  status: TestimonialLeadStatus;
  submitted_at: string;
  status_changed_at: string | null;
  status_changed_by: string | null;
}

export const STATUS_LABELS: Record<TestimonialLeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  dismissed: "Dismissed",
};
