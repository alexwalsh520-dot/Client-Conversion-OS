import Anthropic from "@anthropic-ai/sdk";
import { getAdsTrackerDashboard } from "@/lib/ads-tracker/server";
import { displayKeyword, normalizePersonName } from "@/lib/ads-tracker/normalize";
import { getServiceSupabase } from "@/lib/supabase";
import {
  marketingBrainOverview,
  type AdIntel,
  type AntiAvatar,
  type Avatar,
  type BrainSourceStatus,
  type CallBrief,
  type CallHistory,
  type CampaignBrief,
  type DecisionRule,
  type MarketingBrainData,
  type Phrase,
  type UpcomingCall,
  type Verdict,
} from "./data";

type JsonRecord = Record<string, unknown>;

type ServiceDb = ReturnType<typeof getServiceSupabase>;

type SettingRow = {
  value: string;
};

type BrainRuleDbRow = {
  id: string;
  category: DecisionRule["category"];
  active: boolean;
  text: string;
  basis: string | null;
  edited_at: string | null;
};

type BrainBriefDbRow = {
  id: string;
  status: CampaignBrief["status"];
  payload: CampaignBrief;
};

type BrainOcrDbRow = {
  ad_id: string;
  image_url: string | null;
  extracted_text: string;
  confidence: number | null;
  updated_at: string | null;
};

type SalesRow = {
  id?: string;
  date: string | null;
  prospect_name: string | null;
  prospect_name_normalized: string | null;
  call_taken: boolean | null;
  call_taken_status: string | null;
  outcome: string | null;
  closer: string | null;
  objection: string | null;
  contracted_revenue_cents: number | null;
  collected_revenue_cents: number | null;
  setter: string | null;
  call_notes: string | null;
  recording_link: string | null;
  offer: string | null;
};

type AppointmentRow = {
  appointment_id: string | null;
  contact_id: string | null;
  contact_name: string | null;
  start_time: string | null;
  status: string | null;
  event_type: string | null;
  closer_name: string | null;
  client: string | null;
  keyword_raw?: string | null;
  keyword_normalized?: string | null;
  raw_payload?: unknown;
};

type DmMessageRow = {
  client: string | null;
  subscriber_id: string | null;
  contact_id: string | null;
  setter_name: string | null;
  conversation_id: string | null;
  direction: string | null;
  body: string | null;
  sent_at: string | null;
};

type DmTranscriptRow = {
  setter_name: string | null;
  client: string | null;
  transcript: string | null;
  submitted_at: string | null;
  review_result: string | null;
};

type FathomCallRow = {
  meeting_id: string;
  title: string | null;
  share_url: string | null;
  transcript: string | null;
  summary: string | null;
  recorded_at: string | null;
};

type AdsDashboardRow = {
  id: string;
  name?: string;
  adId: string | null;
  adName: string | null;
  campaignName: string | null;
  keyword: string;
  adSpend: number;
  bookedCalls: number;
  callsTaken: number;
  newClients: number;
  collectedRevenue: number;
  contractedRevenue: number;
  callClosingRate: number;
  previewImageUrl: string | null;
  previewThumbnailUrl: string | null;
};

type AdsDashboardPayload = {
  rows?: AdsDashboardRow[];
  sourceStatus?: {
    meta?: { rowCount?: number; latestSyncedAt?: string | null };
    sales?: { rowCount?: number; directCollectedRevenue?: number };
    attributionEvents?: { manychat?: number; ghl?: number };
  } | null;
  summary?: {
    adSpend?: number;
    callsTaken?: number;
    bookedCalls?: number;
    newClients?: number;
  };
};

type LiveSources = {
  hasDb: boolean;
  salesRows: SalesRow[];
  appointments: AppointmentRow[];
  dmMessages: DmMessageRow[];
  dmTranscripts: DmTranscriptRow[];
  fathomCalls: FathomCallRow[];
  adsDashboard: AdsDashboardPayload | null;
  sourceStatus: BrainSourceStatus[];
};

type StoredOcrMap = Record<string, { text: string; imageUrl?: string | null; updatedAt: string; confidence?: number }>;

const SETTINGS = {
  rules: "marketing_brain_rules",
  briefs: "marketing_brain_briefs",
  ocr: "marketing_brain_ad_ocr",
  snapshot: "marketing_brain_last_snapshot",
  run: "marketing_brain_last_run",
};

const AVATAR_LIBRARY = [
  {
    id: "marine",
    name: "The Plateaued Marine",
    keywords: ["marine", "military", "army", "navy", "air force", "veteran", "active duty", "pt", "sergeant", "deployment", "base"],
  },
  {
    id: "athlete",
    name: "The Returning Athlete",
    keywords: ["athlete", "football", "soccer", "lacrosse", "basketball", "baseball", "college sport", "d1", "acl", "sport"],
  },
  {
    id: "dad",
    name: "The New Dad",
    keywords: ["dad", "father", "kid", "kids", "children", "baby", "toddler", "family", "wife", "newborn"],
  },
  {
    id: "trade",
    name: "The Trade Operator",
    keywords: ["shift", "night shift", "police", "firefighter", "electrician", "trades", "union", "truck", "operator", "construction"],
  },
  {
    id: "hybrid",
    name: "The Hybrid Athlete",
    keywords: ["runner", "running", "trail", "hybrid", "climb", "climbing", "race", "athletic", "performance"],
  },
] as const;

const ANTI_LIBRARY = [
  {
    id: "free-plan",
    name: "The Free Plan Collector",
    keywords: ["free", "pdf", "workout first", "send me", "try it", "sample", "challenge", "risk free"],
  },
  {
    id: "exact-proof",
    name: "The Exact Proof Seeker",
    keywords: ["exactly like me", "case study", "proof", "compare", "guarantee", "testimonials"],
  },
  {
    id: "injury-exit",
    name: "The Injury Exit Hatch",
    keywords: ["injury", "hurt", "knee", "shoulder", "back pain", "flare", "risk"],
  },
] as const;

const PHRASE_BANK = [
  "not lacking discipline",
  "lacking a system",
  "who is checking on you",
  "be the dad who",
  "works around shifts",
  "not starting from zero",
  "pay a pro",
  "free challenge",
  "send me the workout",
  "exactly like me",
  "risk free",
  "transform in",
  "hidden potential",
];

function cloneOverview(): MarketingBrainData {
  return JSON.parse(JSON.stringify(marketingBrainOverview)) as MarketingBrainData;
}

function hasSupabaseEnv() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function getDbOrNull() {
  if (!hasSupabaseEnv()) return null;
  try {
    return getServiceSupabase();
  } catch (error) {
    console.warn("[marketing-brain] Supabase unavailable:", error);
    return null;
  }
}

async function readRows<T>(
  label: string,
  run: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  try {
    const { data, error } = await run();
    if (error) {
      console.warn(`[marketing-brain] ${label} unavailable: ${error.message}`);
      return [];
    }
    return data ?? [];
  } catch (error) {
    console.warn(`[marketing-brain] ${label} failed:`, error);
    return [];
  }
}

function missingSource(id: BrainSourceStatus["id"], label: string): BrainSourceStatus {
  return {
    id,
    label,
    status: "missing",
    count: 0,
    detail: "This runtime is missing Supabase service credentials.",
  };
}

function sourceStatus(
  id: BrainSourceStatus["id"],
  label: string,
  rows: unknown[],
  detail: string,
  latest?: string | null,
): BrainSourceStatus {
  return {
    id,
    label,
    status: rows.length ? "connected" : "empty",
    count: rows.length,
    detail,
    latest,
  };
}

async function readLiveRows<T>(
  id: BrainSourceStatus["id"],
  label: string,
  detail: string,
  run: () => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  latestFrom?: (rows: T[]) => string | null | undefined,
): Promise<{ rows: T[]; status: BrainSourceStatus }> {
  try {
    const { data, error } = await run();
    if (error) {
      console.warn(`[marketing-brain] ${label} unavailable: ${error.message}`);
      return {
        rows: [],
        status: { id, label, status: "error", count: 0, detail: error.message },
      };
    }
    const rows = data ?? [];
    return {
      rows,
      status: sourceStatus(id, label, rows, detail, latestFrom?.(rows) ?? null),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown read failure";
    console.warn(`[marketing-brain] ${label} failed:`, error);
    return {
      rows: [],
      status: { id, label, status: "error", count: 0, detail: message },
    };
  }
}

async function readSetting<T>(db: ServiceDb | null, key: string, fallback: T): Promise<T> {
  if (!db) return fallback;
  try {
    const { data, error } = await db
      .from("app_settings")
      .select("value")
      .eq("key", key)
      .maybeSingle<SettingRow>();

    if (error || !data?.value) return fallback;
    return JSON.parse(data.value) as T;
  } catch {
    return fallback;
  }
}

async function writeSetting(db: ServiceDb, key: string, value: unknown, updatedBy = "marketing-brain") {
  const { error } = await db.from("app_settings").upsert(
    {
      key,
      value: JSON.stringify(value),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy,
    },
    { onConflict: "key" },
  );
  if (error) throw new Error(error.message);
}

async function readStoredRules(db: ServiceDb | null): Promise<DecisionRule[]> {
  if (!db) return cloneOverview().rules;
  const rows = await readRows<BrainRuleDbRow>("marketing brain rules", () =>
    db
      .from("marketing_brain_rules")
      .select("id,category,active,text,basis,edited_at")
      .order("edited_at", { ascending: false }),
  );
  if (rows.length) {
    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      active: row.active,
      text: row.text,
      basis: row.basis || "User taught rule",
      edited: row.edited_at ? "synced" : "just now",
    }));
  }
  return readSetting<DecisionRule[]>(db, SETTINGS.rules, cloneOverview().rules);
}

async function writeStoredRules(db: ServiceDb, rules: DecisionRule[]) {
  await writeSetting(db, SETTINGS.rules, rules, "user");
  try {
    const { error } = await db.from("marketing_brain_rules").upsert(
      rules.map((rule) => ({
        id: rule.id,
        category: rule.category,
        active: rule.active,
        text: rule.text,
        basis: rule.basis,
        edited_at: new Date().toISOString(),
        updated_by: "user",
      })),
      { onConflict: "id" },
    );
    if (error) console.warn("[marketing-brain] rule table write skipped:", error.message);
  } catch (error) {
    console.warn("[marketing-brain] rule table write failed:", error);
  }
}

async function readStoredBriefs(db: ServiceDb | null): Promise<CampaignBrief[]> {
  if (!db) return [];
  const rows = await readRows<BrainBriefDbRow>("marketing brain briefs", () =>
    db
      .from("marketing_brain_campaign_briefs")
      .select("id,status,payload")
      .order("generated_at", { ascending: false })
      .limit(20),
  );
  if (rows.length) return rows.map((row) => ({ ...row.payload, id: row.id, status: row.status }));
  return readSetting<CampaignBrief[]>(db, SETTINGS.briefs, []);
}

async function writeStoredBriefs(db: ServiceDb, briefs: CampaignBrief[]) {
  await writeSetting(db, SETTINGS.briefs, briefs, "marketing-brain");
  try {
    const { error } = await db.from("marketing_brain_campaign_briefs").upsert(
      briefs.map((brief) => ({
        id: brief.id,
        status: brief.status,
        title: brief.title,
        payload: brief,
        approved_at: brief.status === "approved" ? new Date().toISOString() : null,
      })),
      { onConflict: "id" },
    );
    if (error) console.warn("[marketing-brain] brief table write skipped:", error.message);
  } catch (error) {
    console.warn("[marketing-brain] brief table write failed:", error);
  }
}

async function readStoredOcr(db: ServiceDb | null): Promise<StoredOcrMap> {
  if (!db) return {};
  const rows = await readRows<BrainOcrDbRow>("marketing brain OCR", () =>
    db
      .from("marketing_brain_ad_ocr")
      .select("ad_id,image_url,extracted_text,confidence,updated_at")
      .order("updated_at", { ascending: false })
      .limit(500),
  );
  if (rows.length) {
    return Object.fromEntries(rows.map((row) => [row.ad_id, {
      text: row.extracted_text,
      imageUrl: row.image_url,
      updatedAt: row.updated_at || new Date().toISOString(),
      confidence: row.confidence ?? undefined,
    }]));
  }
  return readSetting<StoredOcrMap>(db, SETTINGS.ocr, {});
}

async function writeStoredOcr(db: ServiceDb, map: StoredOcrMap) {
  await writeSetting(db, SETTINGS.ocr, map, "marketing-brain-ocr");
  try {
    const { error } = await db.from("marketing_brain_ad_ocr").upsert(
      Object.entries(map).map(([adId, result]) => ({
        ad_id: adId,
        image_url: result.imageUrl ?? null,
        extracted_text: result.text,
        confidence: result.confidence ?? null,
        updated_at: result.updatedAt,
      })),
      { onConflict: "ad_id" },
    );
    if (error) console.warn("[marketing-brain] OCR table write skipped:", error.message);
  } catch (error) {
    console.warn("[marketing-brain] OCR table write failed:", error);
  }
}

function todayIso() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftDate(date: string, days: number) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function shortDate(value: string | null | undefined) {
  if (!value) return "Unknown";
  const date = new Date(value.includes("T") ? value : `${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return value;
  const now = new Date();
  if (date.toISOString().slice(0, 10) === now.toISOString().slice(0, 10)) return "Today";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function shortTime(value: string | null | undefined) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

function moneyFromCents(cents: number | null | undefined) {
  const value = Math.round((cents ?? 0) / 100);
  if (value <= 0) return "$0";
  if (value >= 1000) return `$${Math.round(value / 100) / 10}k`;
  return `$${value.toLocaleString()}`;
}

function centsToFullCurrency(cents: number | null | undefined) {
  const value = Math.round((cents ?? 0) / 100);
  return value > 0 ? `$${value.toLocaleString()}` : null;
}

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 72) || "item";
}

function textOf(...values: Array<unknown>) {
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function outcomeStatus(outcome: string | null | undefined): CallHistory["status"] {
  const value = (outcome ?? "").toLowerCase();
  if (/\b(close|closed|won|sale|paid|enrolled|client)\b/.test(value) && !/\b(no|lost|dead)\b/.test(value)) return "closed";
  if (/\b(follow|pending|resched|call back)\b/.test(value)) return "followup";
  if (/\b(no show|noshow|lost|no sale|dead|cancel|bad fit)\b/.test(value)) return "lost";
  return "lost";
}

function detectAvatarId(text: string) {
  let best: (typeof AVATAR_LIBRARY)[number] = AVATAR_LIBRARY[0];
  let bestScore = -1;
  for (const avatar of AVATAR_LIBRARY) {
    const score = avatar.keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      best = avatar;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best.id : "athlete";
}

function avatarName(id: string) {
  return AVATAR_LIBRARY.find((avatar) => avatar.id === id)?.name ?? "Returning Athlete";
}

function detectAntiId(text: string) {
  let bestId: string | null = null;
  let bestScore = 0;
  for (const anti of ANTI_LIBRARY) {
    const score = anti.keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 1 : 0), 0);
    if (score > bestScore) {
      bestId = anti.id;
      bestScore = score;
    }
  }
  return bestId;
}

function scoreLead(text: string, sourceRate = 0) {
  const avatarBoost = detectAvatarId(text) ? 16 : 0;
  const paidIntent = /\b(coaching|paid|invest|price|program|accountability|coach)\b/.test(text) ? 18 : 0;
  const urgency = /\b(now|today|ready|need|stuck|tired|12 months|this year)\b/.test(text) ? 11 : 0;
  const antiPenalty = detectAntiId(text) ? -24 : 0;
  const sourceBoost = Math.round(Math.min(sourceRate, 70) / 4);
  return Math.max(28, Math.min(96, 48 + avatarBoost + paidIntent + urgency + antiPenalty + sourceBoost));
}

function sourceForAppointment(appointment: AppointmentRow) {
  return displayKeyword(appointment.keyword_raw || appointment.keyword_normalized || null);
}

function findAppointmentForName(appointments: AppointmentRow[], name: string | null) {
  const normalized = normalizePersonName(name);
  if (!normalized) return null;
  return appointments.find((appointment) => normalizePersonName(appointment.contact_name) === normalized) ?? null;
}

function dmMessagesForContact(messages: DmMessageRow[], contactId?: string | null, fallbackName?: string | null) {
  const normalizedName = normalizePersonName(fallbackName);
  return messages
    .filter((message) => {
      if (contactId && message.contact_id === contactId) return true;
      if (!normalizedName) return false;
      return normalizePersonName(message.body)?.includes(normalizedName) ?? false;
    })
    .sort((a, b) => (a.sent_at ?? "").localeCompare(b.sent_at ?? ""))
    .slice(-8)
    .map((message) => ({
      time: shortTime(message.sent_at) ?? "DM",
      text: message.body?.trim() || "(blank message)",
    }));
}

function fathomTextForName(calls: FathomCallRow[], name: string | null | undefined) {
  const normalized = normalizePersonName(name);
  if (!normalized) return null;
  const match = calls.find((call) => normalizePersonName(call.title)?.includes(normalized));
  if (!match) return null;
  return [match.summary, match.transcript].filter(Boolean).join("\n").slice(0, 6000);
}

function sourceRateMap(ads: AdIntel[]) {
  const map = new Map<string, number>();
  for (const ad of ads) map.set(ad.id.toLowerCase(), ad.rate);
  return map;
}

function buildAds(adsDashboard: AdsDashboardPayload | null, ocr: StoredOcrMap): AdIntel[] {
  const rows = (adsDashboard?.rows ?? [])
    .filter((row) => row.callsTaken > 0 || row.bookedCalls > 0 || row.adSpend > 0)
    .sort((a, b) => {
      const rateA = a.callsTaken > 0 ? a.newClients / a.callsTaken : 0;
      const rateB = b.callsTaken > 0 ? b.newClients / b.callsTaken : 0;
      return rateB - rateA || b.collectedRevenue - a.collectedRevenue;
    })
    .slice(0, 10);

  if (!rows.length) return [];

  return rows.map((row) => {
    const key = row.adId || row.id || row.keyword;
    const ocrResult = ocr[key] || ocr[row.keyword] || ocr[row.adName ?? ""];
    const calls = row.callsTaken || row.bookedCalls;
    const rate = calls > 0 ? Math.round((row.newClients / calls) * 100) : Math.round(row.callClosingRate || 0);
    return {
      id: (row.keyword || row.adName || row.id).toUpperCase().slice(0, 18),
      copy: row.adName || row.campaignName || `${row.keyword} ad`,
      imageText: ocrResult?.text || (row.previewImageUrl ? "OCR pending" : "No image captured"),
      calls,
      closed: row.newClients,
      rate,
    };
  });
}

function buildCalls(
  salesRows: SalesRow[],
  appointments: AppointmentRow[],
  dmMessages: DmMessageRow[],
  fathomCalls: FathomCallRow[],
  adRates: Map<string, number>,
): { callsHistory: CallHistory[]; upcoming: UpcomingCall[]; callBriefs: Record<string, CallBrief> } {
  const now = Date.now();
  const upcomingAppointments = appointments
    .filter((appointment) => {
      if (!appointment.start_time) return false;
      const start = new Date(appointment.start_time).getTime();
      return start >= now - 2 * 60 * 60 * 1000;
    })
    .sort((a, b) => (a.start_time ?? "").localeCompare(b.start_time ?? ""))
    .slice(0, 10);

  const upcoming: UpcomingCall[] = upcomingAppointments.map((appointment) => {
    const dm = dmMessagesForContact(dmMessages, appointment.contact_id, appointment.contact_name);
    const context = textOf(appointment.contact_name, appointment.keyword_raw, appointment.keyword_normalized, ...dm.map((message) => message.text));
    const source = sourceForAppointment(appointment);
    const score = scoreLead(context, adRates.get(source.toLowerCase()) ?? 0);
    return {
      name: appointment.contact_name || "Unknown prospect",
      score,
      avatar: avatarName(detectAvatarId(context)),
      source,
      time: shortTime(appointment.start_time) ?? "Upcoming",
      angle: openerAngle(context, source),
    };
  });

  const historyFromSales: CallHistory[] = salesRows
    .filter((row) => row.prospect_name)
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, 40)
    .map((row) => {
      const appointment = findAppointmentForName(appointments, row.prospect_name);
      const source = appointment ? sourceForAppointment(appointment) : displayKeyword(row.offer || row.setter || "organic");
      const dm = dmMessagesForContact(dmMessages, appointment?.contact_id, row.prospect_name);
      const fathomText = fathomTextForName(fathomCalls, row.prospect_name);
      const context = textOf(row.prospect_name, row.offer, row.outcome, row.objection, row.call_notes, source, fathomText, ...dm.map((message) => message.text));
      const score = scoreLead(context, adRates.get(source.toLowerCase()) ?? 0);
      const status = outcomeStatus(row.outcome);
      return {
        name: row.prospect_name || "Unknown prospect",
        date: shortDate(row.date),
        status,
        score,
        avatar: status === "lost" && detectAntiId(context) ? "Filter risk" : avatarName(detectAvatarId(context)),
        source,
        deal: status === "closed" ? centsToFullCurrency(row.collected_revenue_cents || row.contracted_revenue_cents) : null,
        detail: {
          dm: dm.length ? dm : [{ time: "Notes", text: row.call_notes || row.objection || "No DM thread attached yet." }],
          outcome: row.outcome || row.call_taken_status || "Outcome not labeled",
          quote: pullQuote(fathomText || row.call_notes || row.objection || row.outcome || "No call quote captured yet."),
        },
      };
    });

  const historyFromUpcoming: CallHistory[] = upcoming.map((call) => ({
    name: call.name,
    date: "Today",
    time: call.time,
    status: "upcoming",
    score: call.score,
    avatar: call.avatar,
    source: call.source,
    deal: null,
  }));

  const callsHistory = [...historyFromUpcoming, ...historyFromSales].slice(0, 40);
  const callBriefs: Record<string, CallBrief> = {};
  for (const call of upcoming) {
    const appointment = upcomingAppointments.find((item) => item.contact_name === call.name);
    const dm = dmMessagesForContact(dmMessages, appointment?.contact_id, call.name);
    callBriefs[call.name] = buildCallBrief(call, dm);
  }

  return {
    upcoming,
    callsHistory,
    callBriefs,
  };
}

function openerAngle(context: string, source: string) {
  if (context.includes("free") || context.includes("pdf")) return "Free-plan risk. Qualify paid intent before diagnosing.";
  if (context.includes("dad") || context.includes("kid")) return "Dad identity signal. Open on energy, presence, and long-term health.";
  if (context.includes("shift")) return "Schedule constraint. Open with making the plan fit their real week.";
  if (context.includes("military") || context.includes("marine")) return "Structure signal. Open with system/accountability, not motivation.";
  return `Source ${source}. Start by confirming what made them book and what they want solved now.`;
}

function pullQuote(text: string) {
  const sentence = text.split(/[.!?]\s+/).find((part) => part.trim().length > 24);
  return sentence ? sentence.trim() : text.trim() || "No quote captured yet.";
}

function buildCallBrief(call: UpcomingCall, dm: Array<{ time: string; text: string }>): CallBrief {
  const context = textOf(call.name, call.avatar, call.source, call.angle, ...dm.map((message) => message.text));
  const anti = detectAntiId(context);
  const avatar = avatarName(detectAvatarId(context));
  return {
    takeaway: call.angle,
    avatarMatch: `${call.score}% ${anti ? "filter-risk" : avatar}`,
    breakdown: [
      { label: "Avatar match", value: anti ? 8 : 28, positive: true },
      { label: "Paid intent", value: context.includes("paid") || context.includes("coaching") ? 22 : 8, positive: true },
      { label: "Source ad quality", value: Math.round(call.score / 4), positive: true },
      { label: "Filter risk", value: anti ? -24 : -2, positive: false },
    ],
    pains: inferredPains(context),
    goals: inferredGoals(context),
    dm: dm.length ? dm : [{ time: "DM", text: "No DM thread attached yet. Use the source ad and first five minutes to qualify." }],
    dmMeta: `Source ad/keyword: ${call.source}. Avatar: ${avatar}.`,
    opener: suggestedOpener(call.name, context),
    ask: suggestedQuestions(context),
    dont: anti ? ["Do not give away a free plan.", "Do not over-diagnose before paid intent is clear."] : ["Do not lead with generic motivation.", "Do not ignore the words they used in DMs."],
  };
}

function inferredPains(context: string) {
  const pains = [];
  if (context.includes("shift")) pains.push("Schedule breaks normal plans.");
  if (context.includes("dad") || context.includes("kid")) pains.push("Family identity is creating urgency.");
  if (context.includes("system") || context.includes("discipline")) pains.push("They know what to do but lack a repeatable system.");
  if (context.includes("injury")) pains.push("Old injury may create hesitation.");
  return pains.length ? pains : ["Stuck despite knowing the basics.", "Needs accountability before the next drift."];
}

function inferredGoals(context: string) {
  const goals = [];
  if (context.includes("dad") || context.includes("kid")) goals.push("Be healthy and present for family.");
  if (context.includes("athlete")) goals.push("Feel athletic again.");
  if (context.includes("shift")) goals.push("Make progress around real work constraints.");
  goals.push("Consistency");
  return [...new Set(goals)];
}

function suggestedOpener(name: string, context: string) {
  const firstName = name.split(" ")[0] || name;
  if (context.includes("dad") || context.includes("kid")) {
    return `${firstName}, the family piece is the thing I would not skip. What do you want your health to look like for them a year from now?`;
  }
  if (context.includes("system") || context.includes("discipline")) {
    return `${firstName}, you already diagnosed this as a system problem. Walk me through where the system breaks first.`;
  }
  if (context.includes("free") || context.includes("pdf")) {
    return `${firstName}, before we go deep, are you looking for coaching or just a plan to try on your own?`;
  }
  return `${firstName}, what did you see before booking that made this feel worth a real conversation?`;
}

function suggestedQuestions(context: string) {
  const questions = ["Why now?", "What happens if nothing changes in 12 months?"];
  if (context.includes("shift")) questions.push("What does the hardest work week actually look like?");
  if (context.includes("dad") || context.includes("kid")) questions.push("What do you want your kids or family to see change?");
  if (context.includes("free") || context.includes("pdf")) questions.push("What would need to be true for you to pay for coaching today?");
  return questions;
}

function buildAvatars(salesRows: SalesRow[]): Avatar[] {
  const base = cloneOverview();
  const rowsByAvatar = new Map<string, SalesRow[]>();
  for (const row of salesRows) {
    const context = textOf(row.offer, row.outcome, row.objection, row.call_notes, row.prospect_name);
    const id = detectAvatarId(context);
    rowsByAvatar.set(id, [...(rowsByAvatar.get(id) ?? []), row]);
  }

  const avatars = Array.from(rowsByAvatar.entries()).map(([id, rows]) => {
    const template = base.avatars.find((avatar) => avatar.id === id) ?? base.avatars[0];
    const closed = rows.filter((row) => outcomeStatus(row.outcome) === "closed");
    const revenueCents = closed.reduce((sum, row) => sum + (row.collected_revenue_cents || row.contracted_revenue_cents || 0), 0);
    const avgCents = closed.length ? revenueCents / closed.length : 0;
    return {
      ...template,
      id,
      name: avatarName(id),
      calls: rows.length,
      closeRate: Math.round((closed.length / rows.length) * 100),
      avgDeal: moneyFromCents(avgCents),
      revenue: moneyFromCents(revenueCents),
      ltv: moneyFromCents(avgCents ? avgCents * 1.35 : 0),
    };
  }).sort((a, b) => parseMoney(b.revenue) - parseMoney(a.revenue));

  return avatars.map((avatar, index) => ({ ...avatar, rank: index + 1 }));
}

function parseMoney(value: string) {
  const normalized = value.replace(/[$,]/g, "").toLowerCase();
  if (normalized.endsWith("k")) return Number(normalized.slice(0, -1)) * 1000;
  return Number(normalized) || 0;
}

function buildAntiAvatars(salesRows: SalesRow[]): AntiAvatar[] {
  const base = cloneOverview();
  const rowsByAnti = new Map<string, SalesRow[]>();
  for (const row of salesRows.filter((item) => outcomeStatus(item.outcome) === "lost")) {
    const context = textOf(row.offer, row.outcome, row.objection, row.call_notes, row.prospect_name);
    const id = detectAntiId(context);
    if (!id) continue;
    rowsByAnti.set(id, [...(rowsByAnti.get(id) ?? []), row]);
  }
  return Array.from(rowsByAnti.entries()).map(([id, rows]) => {
    const anti = base.antiAvatars.find((item) => item.id === id) ?? base.antiAvatars[0];
    const lostCents = rows.reduce((sum, row) => sum + Math.max(row.contracted_revenue_cents || 0, 400000), 0);
    return {
      ...anti,
      id,
      calls: rows.length,
      lostRevenue: moneyFromCents(lostCents),
      examples: rows.map((row) => row.objection || row.call_notes || row.outcome || "Lost call").slice(0, 3),
    };
  }).sort((a, b) => parseMoney(b.lostRevenue) - parseMoney(a.lostRevenue));
}

function buildPhrases(
  salesRows: SalesRow[],
  dmMessages: DmMessageRow[],
  dmTranscripts: DmTranscriptRow[],
  fathomCalls: FathomCallRow[],
  ads: AdIntel[],
): { up: Phrase[]; down: Phrase[] } {
  const closedTexts = salesRows
    .filter((row) => outcomeStatus(row.outcome) === "closed")
    .map((row) => textOf(row.offer, row.outcome, row.objection, row.call_notes, row.prospect_name));
  const lostTexts = salesRows
    .filter((row) => outcomeStatus(row.outcome) === "lost")
    .map((row) => textOf(row.offer, row.outcome, row.objection, row.call_notes, row.prospect_name));
  const dmText = dmMessages.map((message) => message.body ?? "").join(" ").toLowerCase();
  const dmTranscriptText = dmTranscripts.map((transcript) => `${transcript.transcript ?? ""} ${transcript.review_result ?? ""}`).join(" ").toLowerCase();
  const fathomText = fathomCalls.map((call) => `${call.summary ?? ""} ${call.transcript ?? ""}`).join(" ").toLowerCase();
  const adText = ads.map((ad) => `${ad.copy} ${ad.imageText}`).join(" ").toLowerCase();
  const closed = `${closedTexts.join(" ")} ${dmText} ${dmTranscriptText} ${fathomText} ${adText}`;
  const lost = lostTexts.join(" ");

  const scored = PHRASE_BANK.map((phrase) => {
    const win = occurrences(closed, phrase);
    const lose = occurrences(lost, phrase);
    return { phrase: prettyPhrase(phrase), score: Math.round((win + 0.25) * 18 - lose * 22) };
  });

  const up = scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((item) => ({ phrase: item.phrase, lift: `+${item.score}%` }));
  const down = scored
    .filter((item) => item.score < 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5)
    .map((item) => ({ phrase: item.phrase, lift: `${item.score}%` }));

  return {
    up,
    down,
  };
}

function occurrences(haystack: string, needle: string) {
  if (!needle) return 0;
  return haystack.split(needle).length - 1;
}

function prettyPhrase(value: string) {
  if (value === "not lacking discipline") return "You are not lacking discipline.";
  if (value === "lacking a system") return "You are lacking a system.";
  if (value === "who is checking on you") return "Who is checking on you now?";
  if (value === "be the dad who") return "Be the dad who can keep up.";
  return value;
}

function buildBriefs(avatars: Avatar[], phrasesUp: Phrase[], phrasesDown: Phrase[], stored: CampaignBrief[]): CampaignBrief[] {
  const topAvatar = avatars[0];
  const generated: CampaignBrief[] = topAvatar ? [{
    id: `live-${slug(topAvatar.name)}`,
    status: "draft",
    title: `${topAvatar.name.replace(/^The /, "")} - Live Brief`,
    generated: "synced just now",
    calls: topAvatar.calls,
    ads: 0,
    summary: `Built from live call outcomes. Lead with ${phrasesUp[0]?.phrase ?? topAvatar.closesOn} and avoid ${phrasesDown[0]?.phrase ?? "generic transformation language"}.`,
    audience: topAvatar.targeting,
    hooks: phrasesUp.slice(0, 3).map((phrase) => ({ text: phrase.phrase, lift: phrase.lift })),
    avoid: phrasesDown.slice(0, 3).map((phrase) => phrase.phrase),
    creative: "Use the winning avatar context from calls. Show the real constraint, not generic fitness hype.",
    budget: "Start as a controlled sibling test. Scale only when cash quality and show rate hold.",
  }] : [];

  const merged = [...stored, ...generated];
  return Array.from(new Map(merged.map((brief) => [brief.id, brief])).values()).slice(0, 8);
}

function buildVerdicts(ads: AdIntel[], avatars: Avatar[], antiAvatars: AntiAvatar[], phrasesUp: Phrase[], phrasesDown: Phrase[]): Verdict[] {
  const verdicts: Verdict[] = [];
  const topAd = ads.filter((ad) => ad.calls >= 3).sort((a, b) => b.rate - a.rate)[0];
  const topAvatar = avatars[0];
  const topAnti = antiAvatars.sort((a, b) => parseMoney(b.lostRevenue) - parseMoney(a.lostRevenue))[0];

  if (topAd && topAd.rate >= 45) {
    verdicts.push({
      id: `scale-${slug(topAd.id)}`,
      type: "scale",
      when: "synced just now",
      claim: `Scale the ${topAd.id} angle before inventing new hooks.`,
      why: `${topAd.id} is producing the strongest close rate in the live ad table. Test sibling copy before moving budget away.`,
      basis: `${topAd.calls} calls, ${topAd.closed} closes, ${topAd.rate}% close`,
      action: "Generate campaign brief",
      receipts: [
        { type: "stats", title: "Ad result", items: [
          { label: "Calls", value: String(topAd.calls) },
          { label: "Closed", value: String(topAd.closed) },
          { label: "Close rate", value: `${topAd.rate}%` },
        ] },
        { type: "quotes", title: "Copy being scored", items: [
          { source: "Primary text", text: topAd.copy },
          { source: "Image text", text: topAd.imageText },
        ] },
      ],
    });
  }

  if (topAnti && parseMoney(topAnti.lostRevenue) > 0) {
    verdicts.push({
      id: `filter-${topAnti.id}`,
      type: "kill",
      when: "synced just now",
      claim: `Filter ${topAnti.name.replace(/^The /, "").toLowerCase()} leads before they book.`,
      why: "This lost-call pattern is showing up often enough to handle in DMs instead of discovering it on the call.",
      basis: `${topAnti.calls} calls, ${topAnti.lostRevenue} lost pipeline`,
      action: "Add filter to DM flow",
      receipts: [
        { type: "text", title: "Filter action", body: topAnti.action },
        { type: "quotes", title: "Examples", items: topAnti.examples.map((text) => ({ source: "Lost call", text })) },
      ],
    });
  }

  if (topAvatar) {
    verdicts.push({
      id: `brief-${topAvatar.id}`,
      type: "test",
      when: "synced just now",
      claim: `Generate a fresh campaign brief for ${topAvatar.name.replace(/^The /, "")}.`,
      why: `${topAvatar.name} is the top current revenue segment. The Brain should turn that back into hooks, audience, and creative direction.`,
      basis: `${topAvatar.calls} calls, ${topAvatar.revenue} revenue, ${topAvatar.closeRate}% close`,
      action: "Generate campaign brief",
      receipts: [
        { type: "phrases", title: "Language to use", items: phrasesUp.slice(0, 3).map((phrase) => ({ phrase: phrase.phrase, lift: phrase.lift })) },
        { type: "phrases", title: "Language to avoid", items: phrasesDown.slice(0, 3).map((phrase) => ({ phrase: phrase.phrase, lift: phrase.lift, negative: true })) },
      ],
    });
  }

  const ocrPending = ads.filter((ad) => ad.imageText === "OCR pending").length;
  if (ocrPending > 0) {
    verdicts.push({
      id: "fix-ocr-coverage",
      type: "fix",
      when: "synced just now",
      claim: "Finish OCR on image ads before trusting phrase rankings.",
      why: "Some live creatives still have image text missing. Those words need to enter the same copy intel layer as primary text.",
      basis: `${ocrPending} ads need OCR`,
      action: "Run creative OCR",
      receipts: [
        { type: "stats", title: "Coverage", items: [
          { label: "Ads ranked", value: String(ads.length) },
          { label: "OCR pending", value: String(ocrPending) },
        ] },
      ],
    });
  }

  if (verdicts.length) return verdicts.slice(0, 5);

  return [{
    id: "watch-more-live-signal",
    type: "watch",
    when: "synced just now",
    claim: "The Brain needs more live signal before making a scaling call.",
    why: "The data pipes are connected, but the current window does not have enough closed/lost calls tied to ads and DMs to produce a strong verdict.",
    basis: `${ads.length} ads, ${avatars.reduce((sum, avatar) => sum + avatar.calls, 0)} sales rows, ${phrasesUp.length + phrasesDown.length} scored phrases`,
    action: "Run sync now",
    receipts: [
      { type: "stats", title: "Current signal", items: [
        { label: "Ads ranked", value: String(ads.length) },
        { label: "Buyer avatars", value: String(avatars.length) },
        { label: "Filter patterns", value: String(antiAvatars.length) },
      ] },
    ],
  }];
}

function buildOperationalVerdicts(sources: LiveSources): Verdict[] {
  const supabase = sources.sourceStatus.find((source) => source.id === "supabase");
  const errorSources = sources.sourceStatus.filter((source) => source.status === "error");
  if (!sources.hasDb || supabase?.status === "missing") {
    return [{
      id: "connect-supabase-preview",
      type: "fix",
      when: "now",
      claim: "Connect Supabase before judging the Brain.",
      why: "This deployment has no Supabase service credentials, so it cannot read sales calls, DMs, Fathom calls, or ad tracker rows. Showing fake buyer data here would be lying.",
      basis: "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are missing in this runtime",
      action: "Open cost + sync status",
      receipts: [
        { type: "text", title: "What this means", body: "The frontend is running, but the live data layer is disconnected in this environment. Add the Supabase env vars to Preview or run this branch in an environment that has them." },
      ],
    }];
  }

  if (errorSources.length) {
    return [{
      id: "fix-source-errors",
      type: "fix",
      when: "synced just now",
      claim: "Fix the source reads before trusting Marketing Brain output.",
      why: "At least one live source returned an error. The Brain is built to show this instead of silently falling back to prototype data.",
      basis: errorSources.map((source) => `${source.label}: ${source.detail}`).join(" | "),
      action: "Run sync now",
      receipts: [
        { type: "stats", title: "Source errors", items: errorSources.map((source) => ({ label: source.label, value: source.status })) },
      ],
    }];
  }

  return [{
    id: "waiting-for-live-rows",
    type: "watch",
    when: "synced just now",
    claim: "The Brain is connected, but no live marketing rows are in this window yet.",
    why: "Sales tracker, booked calls, DMs, Fathom calls, and ad tracker rows all came back empty for the current analysis window.",
    basis: sources.sourceStatus.map((source) => `${source.label}: ${source.count}`).join(" | "),
    action: "Run sync now",
    receipts: [
      { type: "stats", title: "Source counts", items: sources.sourceStatus.map((source) => ({ label: source.label, value: String(source.count) })) },
    ],
  }];
}

function buildTrends(calls: CallHistory[]): MarketingBrainData["trends"] {
  if (calls.length < 4) return emptyTrends();
  const weeks = Array.from({ length: 12 }, () => ({ closed: 0, total: 0, avatars: new Map<string, number>(), anti: new Map<string, number>() }));
  const now = new Date();
  for (const call of calls) {
    if (call.date === "Today" || call.status === "upcoming") continue;
    const date = new Date(`${call.date} ${now.getFullYear()} 12:00:00`);
    if (Number.isNaN(date.getTime())) continue;
    const diffWeeks = Math.max(0, Math.min(11, 11 - Math.floor((now.getTime() - date.getTime()) / (7 * 86400000))));
    weeks[diffWeeks].total += 1;
    if (call.status === "closed") weeks[diffWeeks].closed += 1;
    const key = call.avatar.replace(/^The /, "").replace("Plateaued ", "").replace("Returning ", "").split(" ")[0];
    weeks[diffWeeks].avatars.set(key, (weeks[diffWeeks].avatars.get(key) ?? 0) + 1);
    if (call.avatar === "Filter risk") weeks[diffWeeks].anti.set("filter risk", (weeks[diffWeeks].anti.get("filter risk") ?? 0) + 1);
  }
  const base = cloneOverview().trends;
  return {
    ...base,
    closeRate: weeks.map((week) => week.total ? Math.round((week.closed / week.total) * 100) : 0),
  };
}

function emptyTrends(): MarketingBrainData["trends"] {
  return {
    closeRate: Array.from({ length: 12 }, () => 0),
    phrases: [],
    avatarMix: {
      stages: [],
      colors: [],
      weeks: Array.from({ length: 12 }, () => []),
    },
    antiICP: [],
  };
}

async function collectLiveSources(db: ServiceDb | null): Promise<LiveSources> {
  if (!db) {
    return {
      hasDb: false,
      salesRows: [],
      appointments: [],
      dmMessages: [],
      dmTranscripts: [],
      fathomCalls: [],
      adsDashboard: null,
      sourceStatus: [
        missingSource("supabase", "Supabase"),
        missingSource("sales", "Sales tracker"),
        missingSource("appointments", "Booked calls"),
        missingSource("dm_messages", "DM messages"),
        missingSource("dm_transcripts", "DM transcripts"),
        missingSource("fathom", "Fathom calls"),
        missingSource("ads", "Ads tracker"),
        missingSource("ocr", "Ad OCR"),
      ],
    };
  }

  const today = todayIso();
  const from = shiftDate(today, -120);
  const to = shiftDate(today, 14);
  const [sales, appointmentsResult, dmMessagesResult, dmTranscriptsResult, fathomCallsResult, adsResult] = await Promise.all([
    readLiveRows<SalesRow>("sales", "Sales tracker", "Closed/lost/follow-up call outcomes from sales_tracker_rows.", () =>
      db
        .from("sales_tracker_rows")
        .select("id,date,prospect_name,prospect_name_normalized,call_taken,call_taken_status,outcome,closer,objection,contracted_revenue_cents,collected_revenue_cents,setter,call_notes,recording_link,offer")
        .gte("date", from)
        .order("date", { ascending: false })
        .limit(300),
      (rows) => rows[0]?.date,
    ),
    readLiveRows<AppointmentRow>("appointments", "Booked calls", "Upcoming and recent booked calls from ghl_appointments.", () =>
      db
        .from("ghl_appointments")
        .select("appointment_id,contact_id,contact_name,start_time,status,event_type,closer_name,client,keyword_raw,keyword_normalized,raw_payload")
        .gte("start_time", `${from}T00:00:00.000Z`)
        .lte("start_time", `${to}T23:59:59.999Z`)
        .order("start_time", { ascending: true })
        .limit(300),
      (rows) => rows[rows.length - 1]?.start_time,
    ),
    readLiveRows<DmMessageRow>("dm_messages", "DM messages", "Message-level IG/GHL DM context before booked calls.", () =>
      db
        .from("dm_conversation_messages")
        .select("client,subscriber_id,contact_id,setter_name,conversation_id,direction,body,sent_at")
        .gte("sent_at", `${from}T00:00:00.000Z`)
        .order("sent_at", { ascending: false })
        .limit(1000),
      (rows) => rows[0]?.sent_at,
    ),
    readLiveRows<DmTranscriptRow>("dm_transcripts", "DM transcripts", "Legacy/summary DM transcripts and review notes.", () =>
      db
        .from("dm_transcripts")
        .select("setter_name,client,transcript,submitted_at,review_result")
        .gte("submitted_at", `${from}T00:00:00.000Z`)
        .order("submitted_at", { ascending: false })
        .limit(200),
      (rows) => rows[0]?.submitted_at,
    ),
    readLiveRows<FathomCallRow>("fathom", "Fathom calls", "Stored Fathom transcripts and summaries captured by webhook.", () =>
      db
        .from("marketing_brain_fathom_calls")
        .select("meeting_id,title,share_url,transcript,summary,recorded_at")
        .gte("recorded_at", `${from}T00:00:00.000Z`)
        .order("recorded_at", { ascending: false })
        .limit(300),
      (rows) => rows[0]?.recorded_at,
    ),
    loadAdsDashboard(from, today),
  ]);

  return {
    hasDb: true,
    salesRows: sales.rows,
    appointments: appointmentsResult.rows,
    dmMessages: dmMessagesResult.rows,
    dmTranscripts: dmTranscriptsResult.rows,
    fathomCalls: fathomCallsResult.rows,
    adsDashboard: adsResult.dashboard,
    sourceStatus: [
      { id: "supabase", label: "Supabase", status: "connected", count: 1, detail: "Service role connected for server-side synthesis." },
      sales.status,
      appointmentsResult.status,
      dmMessagesResult.status,
      dmTranscriptsResult.status,
      fathomCallsResult.status,
      adsResult.status,
    ],
  };
}

async function loadAdsDashboard(dateFrom: string, dateTo: string): Promise<{ dashboard: AdsDashboardPayload | null; status: BrainSourceStatus }> {
  try {
    const dashboard = await getAdsTrackerDashboard({
      account: "all",
      status: "all",
      level: "ad",
      dateFrom,
      dateTo,
    }) as AdsDashboardPayload;
    const rows = dashboard.rows ?? [];
    return {
      dashboard,
      status: sourceStatus("ads", "Ads tracker", rows, "Ads tracker attribution rows at ad level.", dashboard.sourceStatus?.meta?.latestSyncedAt ?? null),
    };
  } catch (error) {
    console.warn("[marketing-brain] Ads tracker unavailable:", error);
    return {
      dashboard: null,
      status: {
        id: "ads",
        label: "Ads tracker",
        status: "error",
        count: 0,
        detail: error instanceof Error ? error.message : "Ads tracker unavailable",
      },
    };
  }
}

function hasLiveData(sources: LiveSources) {
  return Boolean(
    sources.salesRows.length ||
    sources.appointments.length ||
    sources.dmMessages.length ||
    sources.dmTranscripts.length ||
    sources.fathomCalls.length ||
    sources.adsDashboard?.rows?.length,
  );
}

export async function getMarketingBrainOverview(): Promise<MarketingBrainData> {
  const db = getDbOrNull();
  const [storedRules, storedBriefs, ocr] = await Promise.all([
    readStoredRules(db),
    readStoredBriefs(db),
    readStoredOcr(db),
  ]);
  const collected = await collectLiveSources(db);
  const sources: LiveSources = {
    ...collected,
    sourceStatus: [
      ...collected.sourceStatus.filter((source) => source.id !== "ocr"),
      {
        id: "ocr",
        label: "Ad OCR",
        status: Object.keys(ocr).length ? "connected" : collected.hasDb ? "empty" : "missing",
        count: Object.keys(ocr).length,
        detail: Object.keys(ocr).length ? "Stored image text from ad creatives." : collected.hasDb ? "No ad image text has been extracted yet." : "This runtime is missing Supabase service credentials.",
      },
    ],
  };

  if (!hasLiveData(sources)) {
    return {
      ...emptyBrainData(sources),
      verdicts: buildOperationalVerdicts(sources),
      rules: storedRules,
      briefs: storedBriefs,
      cost: {
        spend: "$0",
        cap: "$250",
        perCall: "$0.00",
        backfill: db ? "ready" : "connect Supabase",
      },
    };
  }

  const ads = buildAds(sources.adsDashboard, ocr);
  const rates = sourceRateMap(ads);
  const { callsHistory, upcoming, callBriefs } = buildCalls(sources.salesRows, sources.appointments, sources.dmMessages, sources.fathomCalls, rates);
  const avatars = buildAvatars(sources.salesRows);
  const antiAvatars = buildAntiAvatars(sources.salesRows);
  const phrases = buildPhrases(sources.salesRows, sources.dmMessages, sources.dmTranscripts, sources.fathomCalls, ads);
  const briefs = buildBriefs(avatars, phrases.up, phrases.down, storedBriefs);
  const verdicts = buildVerdicts(ads, avatars, antiAvatars, phrases.up, phrases.down);

  return {
    ...cloneOverview(),
    syncLabel: "synced just now",
    verdicts,
    avatars,
    antiAvatars,
    phrasesUp: phrases.up,
    phrasesDown: phrases.down,
    ads,
    briefs,
    upcoming,
    callBriefs,
    callsHistory,
    trends: buildTrends(callsHistory),
    rules: storedRules,
    cost: buildCost(sources),
    sourceStatus: buildSourceStatus(sources),
  };
}

function emptyBrainData(sources: LiveSources): MarketingBrainData {
  return {
    ...cloneOverview(),
    syncLabel: sources.hasDb ? "connected, no rows" : "not connected",
    verdicts: [],
    avatars: [],
    antiAvatars: [],
    phrasesUp: [],
    phrasesDown: [],
    ads: [],
    briefs: [],
    upcoming: [],
    callBriefs: {},
    callsHistory: [],
    trends: emptyTrends(),
    neural: cloneOverview().neural,
    rules: [],
    cost: {
      spend: "$0",
      cap: "$250",
      perCall: "$0.00",
      backfill: sources.hasDb ? "ready" : "connect Supabase",
    },
    sourceStatus: buildSourceStatus(sources),
  };
}

function buildSourceStatus(sources: LiveSources): MarketingBrainData["sourceStatus"] {
  const hasErrors = sources.sourceStatus.some((source) => source.status === "error");
  const hasLive = hasLiveData(sources);
  return {
    runtime: {
      mode: !sources.hasDb ? "not_connected" : hasErrors || !hasLive ? "partial" : "live",
      generatedAt: new Date().toISOString(),
      window: "last 120 days + next 14 days",
      hasDb: sources.hasDb,
      hasLiveData: hasLive,
    },
    sources: sources.sourceStatus,
  };
}

function buildCost(sources: LiveSources): MarketingBrainData["cost"] {
  const calls = Math.max(sources.salesRows.length + sources.appointments.length, 1);
  const estimatedCents = Math.min(25000, Math.round((calls * 1.7 + sources.fathomCalls.length * 0.8 + (sources.dmMessages.length / 200) * 9) * 100));
  return {
    spend: moneyFromCents(estimatedCents),
    cap: "$250",
    perCall: `$${(estimatedCents / 100 / calls).toFixed(2)}`,
    backfill: "ready",
  };
}

export async function runMarketingBrainSync() {
  const db = getDbOrNull();
  const data = await getMarketingBrainOverview();
  if (db) {
    await writeSetting(db, SETTINGS.snapshot, data);
    await writeSetting(db, SETTINGS.run, {
      status: "success",
      completedAt: new Date().toISOString(),
      counts: {
        verdicts: data.verdicts.length,
        calls: data.callsHistory.length,
        ads: data.ads.length,
        rules: data.rules.length,
      },
    });
    try {
      await db.from("marketing_brain_runs").insert({
        status: "success",
        mode: "manual",
        input_counts: {
          verdicts: data.verdicts.length,
          calls: data.callsHistory.length,
          ads: data.ads.length,
          rules: data.rules.length,
        },
        cost_cents: Math.round(parseMoney(data.cost.spend) * 100),
        snapshot: data,
        completed_at: new Date().toISOString(),
      });
    } catch (error) {
      console.warn("[marketing-brain] run table write failed:", error);
    }
  }
  return data;
}

export async function addMarketingBrainRule(input: { text: string; category: DecisionRule["category"] }) {
  const db = getDbOrNull();
  const now = new Date().toISOString();
  const rule: DecisionRule = {
    id: `${slug(input.category)}-${slug(input.text).slice(0, 40)}-${Date.now().toString(36)}`,
    category: input.category,
    active: true,
    text: input.text.trim(),
    basis: "User taught rule",
    edited: "just now",
  };
  if (!db) {
    const data = await getMarketingBrainOverview();
    return { ...data, rules: [rule, ...data.rules] };
  }
  const rules = await readStoredRules(db);
  await writeStoredRules(db, [rule, ...rules]);
  await writeSetting(db, SETTINGS.run, { status: "rule_added", completedAt: now, ruleId: rule.id });
  return getMarketingBrainOverview();
}

export async function updateMarketingBrainRule(id: string, patch: Partial<Pick<DecisionRule, "active" | "text" | "category">>) {
  const db = getDbOrNull();
  if (!db) {
    const data = await getMarketingBrainOverview();
    return { ...data, rules: data.rules.map((rule) => rule.id === id ? { ...rule, ...patch, edited: "just now" } : rule) };
  }
  const rules = await readStoredRules(db);
  const next = rules.map((rule) => rule.id === id ? { ...rule, ...patch, edited: "just now" } : rule);
  await writeStoredRules(db, next);
  return getMarketingBrainOverview();
}

export async function approveMarketingBrainBrief(id: string) {
  const db = getDbOrNull();
  const current = await getMarketingBrainOverview();
  const stored = current.briefs.map((brief) => brief.id === id ? { ...brief, status: "approved" as const } : brief);
  if (!db) return { ...current, briefs: stored };
  await writeStoredBriefs(db, stored);
  return getMarketingBrainOverview();
}

export async function generateMarketingBrainBrief(verdictId?: string) {
  const db = getDbOrNull();
  const current = await getMarketingBrainOverview();
  const verdict = current.verdicts.find((item) => item.id === verdictId) ?? current.verdicts[0];
  const avatar = current.avatars[0];
  const brief: CampaignBrief = {
    id: `generated-${slug(verdict?.id ?? avatar.name)}-${Date.now().toString(36)}`,
    status: "draft",
    title: verdict?.claim.replace(/\.$/, "") || `${avatar.name} campaign brief`,
    generated: "just now",
    calls: avatar.calls,
    ads: current.ads.length,
    summary: verdict?.why || `Generated from the current ${avatar.name} signal.`,
    audience: avatar.targeting,
    hooks: current.phrasesUp.slice(0, 4).map((phrase) => ({ text: phrase.phrase, lift: phrase.lift })),
    avoid: current.phrasesDown.slice(0, 4).map((phrase) => phrase.phrase),
    creative: "Make the constraint visible in the creative. Keep the promise specific and grounded in buyer language.",
    budget: "Launch as a sibling test beside the winner. Increase spend only when show rate, close rate, and cash collected hold.",
  };
  if (!db) return { ...current, briefs: [brief, ...current.briefs] };
  const stored = await readStoredBriefs(db);
  await writeStoredBriefs(db, [brief, ...stored]);
  return getMarketingBrainOverview();
}

export async function extractAndStoreAdImageText(input: {
  adId: string;
  imageUrl?: string;
  imageBase64?: string;
  imageText?: string;
}) {
  const db = getDbOrNull();
  if (!input.adId?.trim()) throw new Error("adId is required");

  const text = input.imageText?.trim() || await extractImageTextWithAnthropic(input);
  if (!db) {
    const current = await getMarketingBrainOverview();
    return {
      ...current,
      ads: current.ads.map((ad) => ad.id === input.adId ? { ...ad, imageText: text } : ad),
    };
  }
  const map = await readStoredOcr(db);
  map[input.adId] = {
    text,
    imageUrl: input.imageUrl ?? null,
    updatedAt: new Date().toISOString(),
    confidence: input.imageText ? 1 : 0.86,
  };
  await writeStoredOcr(db, map);
  return getMarketingBrainOverview();
}

async function extractImageTextWithAnthropic(input: { imageUrl?: string; imageBase64?: string }) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is required for image OCR unless imageText is provided.");
  const image = input.imageBase64 || (input.imageUrl ? await imageUrlToDataUrl(input.imageUrl) : null);
  if (!image) throw new Error("imageUrl or imageBase64 is required for OCR.");
  const match = image.match(/^data:(image\/(?:png|jpeg|jpg|webp|gif));base64,(.+)$/);
  if (!match) throw new Error("Image must be a data URL with base64 data.");

  const mediaType = match[1] === "image/jpg" ? "image/jpeg" : match[1];
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 500,
    system: "Extract only the visible marketing/ad text from this image. Return plain text. If there is no text, return: No visible text.",
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp",
            data: match[2],
          },
        },
        { type: "text", text: "Read the ad creative. What words are visible on the image?" },
      ],
    }],
  });

  return response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function imageUrlToDataUrl(url: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed to fetch image (${response.status})`);
  const contentType = response.headers.get("content-type") || "image/jpeg";
  const buffer = Buffer.from(await response.arrayBuffer());
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

export function responsePayload(data: MarketingBrainData, extra: JsonRecord = {}) {
  return { success: true, data, ...extra };
}
