import { postToSlack } from "./slack";

// The real destinations tracked links redirect to, by audience. Override per
// environment if a doc moves.
const DEFAULT_GAMMA_DOC_URL =
  "https://gamma.app/docs/YOUR-SUPER-DOC-ob9pqkhvctlyj9s?mode=doc";
const DEFAULT_AGENCY_DOC_URL =
  "https://gamma.app/docs/The-Creator-Affiliate-Program-2kmvgekgmds5h0s?mode=doc";

// #cc-call-updates — also the super-doc default channel. Bot posts here.
const DEFAULT_OUTREACH_SLACK_CHANNEL = "C0AFKJUQ2UT";

export type OutreachDocKey = "influencer" | "agency";

export interface TrackedLead {
  email: string;
  firstName: string;
  lastName: string;
  instagram: string;
  company: string;
  docKey: OutreachDocKey;
}

interface TrackedTokenPayload {
  e?: string; // email
  f?: string; // first name
  l?: string; // last name
  ig?: string; // instagram handle
  c?: string; // company / agency name
  d?: string; // doc key ("agency"; absent = influencer)
}

export function getGammaDocUrl(docKey?: OutreachDocKey): string {
  if (docKey === "agency") {
    return (process.env.OUTREACH_AGENCY_DOC_URL || DEFAULT_AGENCY_DOC_URL).trim();
  }
  return (process.env.OUTREACH_GAMMA_DOC_URL || DEFAULT_GAMMA_DOC_URL).trim();
}

function getOutreachSlackChannel(): string {
  return (
    process.env.OUTREACH_SLACK_CHANNEL_ID?.trim() ||
    DEFAULT_OUTREACH_SLACK_CHANNEL
  );
}

// Identity-only, stateless token (no DB lookup). The redirect destination is
// fixed server-side (getGammaDocUrl), so the token cannot be used to point the
// link anywhere else — no open-redirect surface.
export function encodeLeadToken(lead: Partial<TrackedLead>): string {
  const payload: TrackedTokenPayload = {
    e: lead.email?.trim().toLowerCase() || undefined,
    f: lead.firstName?.trim() || undefined,
    l: lead.lastName?.trim() || undefined,
    ig: lead.instagram?.trim().replace(/^@/, "") || undefined,
    c: lead.company?.trim() || undefined,
    d: lead.docKey === "agency" ? "agency" : undefined,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeLeadToken(token: string): TrackedLead | null {
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    const payload = JSON.parse(json) as TrackedTokenPayload;
    if (!payload || typeof payload !== "object") return null;
    return {
      email: payload.e || "",
      firstName: payload.f || "",
      lastName: payload.l || "",
      instagram: payload.ig || "",
      company: payload.c || "",
      docKey: payload.d === "agency" ? "agency" : "influencer",
    };
  } catch {
    return null;
  }
}

export function buildTrackedDocUrl(baseUrl: string, lead: Partial<TrackedLead>): string {
  const token = encodeLeadToken(lead);
  return `${baseUrl.replace(/\/$/, "")}/r/${token}`;
}

// Mail scanners / link pre-fetchers hit tracked links without a human. Skip
// Slack pings for obvious bots so opens stay high-signal.
const BOT_UA = /bot|crawl|spider|preview|scan|monitor|fetch|slackbot|facebookexternalhit|whatsapp|telegram|proofpoint|barracuda|mimecast|microsoft|outlook|googleimageproxy/i;

export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent) return true; // no UA at all → almost always a scanner
  return BOT_UA.test(userAgent);
}

export async function notifyGammaOpen(lead: TrackedLead): Promise<boolean> {
  const channel = getOutreachSlackChannel();
  if (!channel) return false;

  const name = `${lead.firstName} ${lead.lastName}`.trim() || "A lead";
  const igHandle = lead.instagram.replace(/^@/, "");
  const docLabel =
    lead.docKey === "agency" ? "Opened the AGENCY affiliate doc" : "Opened the Gamma doc";
  const headline = lead.company ? `${name} (${lead.company})` : name;
  const lines = [
    `🔗 *${docLabel}* — ${headline}`,
    lead.email ? `*Email:* ${lead.email}` : "",
    igHandle
      ? `*Instagram:* <https://instagram.com/${igHandle}|@${igHandle}>`
      : "",
  ].filter(Boolean);

  return postToSlack(channel, lines.join("\n"));
}
