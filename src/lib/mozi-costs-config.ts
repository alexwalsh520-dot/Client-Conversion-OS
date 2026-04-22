// Allowlisted costs for Mozi math.
// User-confirmed on 2026-04-21. If you change these, update the report.

export type ClientKey = "keith" | "tyson";
export type SplitRule =
  | { kind: "equal" }                                // split 50/50 between Keith and Tyson
  | { kind: "only"; client: ClientKey };             // 100% to one client

// Mercury counterparty substrings (case-insensitive). We sum every debit whose
// counterpartyName OR bankDescription matches one of these, over the last 30d.
//
// Anything NOT in this list is EXCLUDED from CAC by design.
export const ACQUISITION_SOFTWARE: Array<{
  match: string[];           // substring(s) that identify the charge
  label: string;             // pretty name for the report
  split: SplitRule;
}> = [
  { match: ["sendblue"],            label: "SendBlue",        split: { kind: "equal" } },
  { match: ["skool"],               label: "Skool",           split: { kind: "equal" } },
  { match: ["fathom"],              label: "Fathom",          split: { kind: "equal" } },
  { match: ["gamma"],               label: "Gamma",           split: { kind: "equal" } },
  { match: ["elevenlabs"],          label: "ElevenLabs",      split: { kind: "equal" } },

  // Per-client ManyChat (identified by exact monthly amount band since counterparty
  // name is identical across all three). $56 = Zoe (excluded), $62 = Keith, $238 = Tyson.
  // Handled as a special case in mozi-mercury.ts, not here.
];

// Fulfillment payroll — we pull from Mercury directly (the expenses table is
// sparse and missing several coaches). Any Mercury debit whose counterparty
// matches ONE of these substrings counts toward the per-end-client coaching
// cost that flows into GP30.
//
// Includes:
//   - Upwork (bundled coach pay for Waleed/Farrukh/Stef/Belkys/Fatima et al.)
//   - Josh / Joshua Perks (coach, direct)
//   - Muhammad Ahmad Saeed (product manager overseeing coaches → coaching cost per user)
//   - Damanjeet Kaur (nutritionist "Daman")
//   - Farrukh Aslam (coach, sometimes paid direct)
// Extend this list when you hire a new coach or nutritionist.
export const FULFILLMENT_PAYROLL_MATCHES = [
  "upwork",
  "josh perks",
  "joshua perks",
  "muhammad ahmad saeed",
  "damanjeet kaur",
  "farrukh aslam",
];

// Platform costs billed once for the whole coaching ops (divide by total active end-clients).
export const FULFILLMENT_SOFTWARE_MATCHES = [
  "everfit",
];

// Setter commission rates: % of cashCollected per sales-tracker line.
// If the setter name matches, use this rate. Case-insensitive substring match.
export const SETTER_COMMISSION_RULES: Array<{ match: string; ratePct: number }> = [
  { match: "amara",    ratePct: 5 },
  { match: "kelechi",  ratePct: 3 },
  { match: "gideon",   ratePct: 3 },
  { match: "debbie",   ratePct: 3 },
  { match: "nwosu",    ratePct: 3 },   // Chidiebere / Debbie Nwosu are same person
];

// Closers get 10% straight on every closed line.
export const CLOSER_COMMISSION_PCT = 10;

// Explicit per-client ManyChat allocation (all three show up under the same
// counterparty name; disambiguate by the monthly dollar band, first match wins).
// Amounts in cents. Zoe = ~$56 (excluded), Keith = ~$62 + small top-ups,
// Tyson = ~$238 + top-ups.
export const MANYCHAT_PER_CLIENT: Array<{ amountBandCents: [number, number]; client: ClientKey | "exclude" }> = [
  { amountBandCents: [4000,   6000],  client: "exclude" },  // ~$56 Zoe & Emily main charge
  { amountBandCents: [0,      15000], client: "keith" },    // Keith main ~$62 + small top-ups (<$150)
  { amountBandCents: [15000,  50000], client: "tyson" },    // Tyson main ~$238 + larger top-ups
];
