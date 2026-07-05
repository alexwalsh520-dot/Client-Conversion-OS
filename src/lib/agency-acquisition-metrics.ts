// Agency-level acquisition economics for the Client Acquisition tab.
//
// These are metrics about CoreShift acquiring AGENCY CLIENTS (Tyson, Antwan,
// ...) via cold outreach — not the end-customer coaching economics that
// /api/home/business-metrics computes.
//
// Definitions (set by Matthew, Jul 2026):
// - GP30:  profit from a client's first 30 days of invoices after signing.
//          Only computable for clients signed after Mercury data begins
//          (Jan 2026); earlier clients show "—".
// - CAC:   software cost of acquiring a client (Apify, GHL, Loom, Gamma,
//          Smartlead, domains, inboxes, lead lists). Outreach VA excluded for
//          now by request.
// - LTGP:  all-time profit = ALL money into the CoreShift account minus ALL
//          costs EXCEPT owner draws (Alex / Matt payouts).
// - Capacity: manual — open client slots we could take on today.

import { getServiceSupabase } from "@/lib/supabase";

const REVENUE_ACCOUNT = "coreshift";

// Owner draws — excluded from costs by definition.
const OWNER_MATCHES = ["alex walsh", "matthew conder"];

// Acquisition software allowlist (substring match on counterparty+description).
// Scoped to the CoreShift account only, same as revenue/costs — Forge is
// excluded from these metrics by design. Note: some acquisition tools
// (Smartlead, Influencers.club) have historically been paid from the Forge
// account and therefore do NOT count here.
const ACQUISITION_MATCHES: Array<{ match: string[]; label: string }> = [
  { match: ["apify"], label: "Apify" },
  { match: ["smartlead"], label: "Smartlead" },
  { match: ["gamma"], label: "Gamma" },
  { match: ["loom"], label: "Loom" },
  { match: ["highlevel", "gohighlevel"], label: "GoHighLevel" },
  { match: ["godaddy", "porkbun", "namecheap"], label: "Domains" },
  { match: ["premium inbox"], label: "Premium Inboxes" },
  { match: ["influencers.club", "influencers club"], label: "Influencers.club" },
];

// Agency client roster. Signed dates drive GP30 windows and the CAC
// denominator; null = signed before Mercury data begins (GP30 shows "—").
export const AGENCY_CLIENTS: Array<{
  key: string;
  label: string;
  status: "active" | "onboarding";
  signedDate: string | null; // YYYY-MM-DD
}> = [
  { key: "tyson", label: "Tyson", status: "active", signedDate: null },
  { key: "antwan", label: "Antwan", status: "onboarding", signedDate: "2026-06-15" },
];

const OPEN_CLIENT_SLOTS = 10;

interface MercuryTx {
  posted_at: string;
  amount: number; // cents; positive = credit, negative = debit
  counterparty: string | null;
  description: string | null;
  account: string;
}

export interface AgencyAcquisitionMetrics {
  ltgp: {
    revenueCents: number;
    costCents: number;
    ownerDrawsExcludedCents: number;
    profitCents: number;
    dataSince: string | null;
  };
  cac: {
    totalCents: number;
    monthlyAvgCents: number;
    clientsSignedInWindow: number;
    perClientCents: number | null;
    items: Array<{ label: string; totalCents: number }>;
  };
  gp30: {
    perClient: Array<{
      key: string;
      label: string;
      profitCents: number | null;
      note: string;
    }>;
  };
  capacity: {
    openSlots: number;
    activeClients: number;
    onboardingClients: number;
  };
  generatedAt: string;
}

function textOf(tx: MercuryTx): string {
  return `${tx.counterparty ?? ""} ${tx.description ?? ""}`.toLowerCase();
}

function matchesAny(tx: MercuryTx, needles: string[]): boolean {
  const text = textOf(tx);
  return needles.some((needle) => text.includes(needle));
}

async function loadAllTransactions(): Promise<MercuryTx[]> {
  const sb = getServiceSupabase();
  const rows: MercuryTx[] = [];
  const pageSize = 1000;

  for (let page = 0; page < 20; page++) {
    const { data, error } = await sb
      .from("mozi_mercury_transactions")
      .select("posted_at, amount, counterparty, description, account")
      .order("posted_at", { ascending: true })
      .range(page * pageSize, (page + 1) * pageSize - 1);
    if (error) throw error;
    rows.push(...((data ?? []) as MercuryTx[]));
    if (!data || data.length < pageSize) break;
  }

  return rows.filter((row) => row.posted_at && Number.isFinite(row.amount));
}

export async function getAgencyAcquisitionMetrics(): Promise<AgencyAcquisitionMetrics> {
  const txs = await loadAllTransactions();
  const coreshift = txs.filter((tx) => tx.account === REVENUE_ACCOUNT);
  const dataSince = coreshift.length > 0 ? coreshift[0].posted_at.slice(0, 10) : null;

  // ── LTGP: all money in, minus all costs except owner draws ──
  let revenueCents = 0;
  let costCents = 0;
  let ownerDrawsExcludedCents = 0;

  for (const tx of coreshift) {
    if (tx.amount > 0) {
      revenueCents += tx.amount;
      continue;
    }
    const debit = Math.abs(tx.amount);
    if (matchesAny(tx, OWNER_MATCHES)) {
      ownerDrawsExcludedCents += debit;
    } else {
      costCents += debit;
    }
  }

  // ── CAC: acquisition software spend (CoreShift account only) ──
  const cacItems = new Map<string, number>();
  let cacTotalCents = 0;
  for (const tx of coreshift) {
    if (tx.amount >= 0) continue;
    for (const spec of ACQUISITION_MATCHES) {
      if (!matchesAny(tx, spec.match)) continue;
      const debit = Math.abs(tx.amount);
      cacItems.set(spec.label, (cacItems.get(spec.label) ?? 0) + debit);
      cacTotalCents += debit;
      break;
    }
  }

  const windowDays =
    dataSince !== null
      ? Math.max(30, Math.round((Date.now() - Date.parse(dataSince)) / 86_400_000))
      : 30;
  const monthlyAvgCents = Math.round((cacTotalCents / windowDays) * 30);

  const clientsSignedInWindow = AGENCY_CLIENTS.filter(
    (client) => client.signedDate !== null && (dataSince === null || client.signedDate >= dataSince),
  ).length;
  const perClientCents =
    clientsSignedInWindow > 0 ? Math.round(cacTotalCents / clientsSignedInWindow) : null;

  // ── GP30 per client: first 30 days of money-in after signing ──
  const gp30PerClient = AGENCY_CLIENTS.map((client) => {
    if (!client.signedDate) {
      return {
        key: client.key,
        label: client.label,
        profitCents: null,
        note: "Signed before payment data begins — ignored by design.",
      };
    }

    const windowStartMs = Date.parse(`${client.signedDate}T00:00:00Z`);
    const windowEndMs = windowStartMs + 30 * 86_400_000;
    if (Date.now() < windowEndMs) {
      return {
        key: client.key,
        label: client.label,
        profitCents: null,
        note: "First 30 days still in progress.",
      };
    }

    // v1: with revenue defined as "any money in", the 30-day window uses all
    // CoreShift credits in the window minus non-owner-draw debits in the same
    // window. Refine to per-client counterparty mapping once invoices flow.
    let windowRevenue = 0;
    let windowCosts = 0;
    for (const tx of coreshift) {
      const ms = Date.parse(tx.posted_at);
      if (!Number.isFinite(ms) || ms < windowStartMs || ms >= windowEndMs) continue;
      if (tx.amount > 0) windowRevenue += tx.amount;
      else if (!matchesAny(tx, OWNER_MATCHES)) windowCosts += Math.abs(tx.amount);
    }

    return {
      key: client.key,
      label: client.label,
      profitCents: windowRevenue - windowCosts,
      note: `Money in minus costs, ${client.signedDate} +30d.`,
    };
  });

  return {
    ltgp: {
      revenueCents,
      costCents,
      ownerDrawsExcludedCents,
      profitCents: revenueCents - costCents,
      dataSince,
    },
    cac: {
      totalCents: cacTotalCents,
      monthlyAvgCents,
      clientsSignedInWindow,
      perClientCents,
      items: Array.from(cacItems.entries())
        .map(([label, totalCents]) => ({ label, totalCents }))
        .sort((a, b) => b.totalCents - a.totalCents),
    },
    gp30: { perClient: gp30PerClient },
    capacity: {
      openSlots: OPEN_CLIENT_SLOTS,
      activeClients: AGENCY_CLIENTS.filter((c) => c.status === "active").length,
      onboardingClients: AGENCY_CLIENTS.filter((c) => c.status === "onboarding").length,
    },
    generatedAt: new Date().toISOString(),
  };
}
