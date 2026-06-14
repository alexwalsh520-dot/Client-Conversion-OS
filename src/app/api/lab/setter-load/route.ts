import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { CREATORS, creatorKeyFromText, type CreatorKey } from "@/lib/creators";
import {
  SETTER_NAMES,
  capacityForSetter,
  defaultSetterCapacityConfig,
  getSetterCapacityConfig,
  type SetterCapacityConfig,
} from "@/lib/lab/setter-capacity";

export const dynamic = "force-dynamic";

const THRESHOLD_PCT = 0.8;
const ET_TIMEZONE = "America/New_York";

// Data source for "leads handled": the canonical ManyChat lead feed. Every time
// a setter picks up a new lead, ManyChat fires the `new_lead` tag → we store it
// in manychat_tag_events with the setter_name + client. Counting today's
// `new_lead` events per setter = the leads they're actively working right now.
const SOURCE = "manychat_tag_events.new_lead (today, ET)";

function todayEtDateString(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: ET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

// Start of the ET day expressed as a UTC ISO string, for the DB range filter.
function startOfEtDayUtcIso(etDate: string): string {
  // Build a Date at ET midnight by probing the offset for that date.
  const probe = new Date(`${etDate}T12:00:00Z`);
  const etParts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIMEZONE,
    hour: "2-digit",
    hourCycle: "h23",
    timeZoneName: "shortOffset",
  }).formatToParts(probe);
  const offsetPart = etParts.find((p) => p.type === "timeZoneName")?.value || "GMT-5";
  const match = offsetPart.match(/GMT([+-]\d{1,2})(?::?(\d{2}))?/);
  const offsetHours = match ? Number(match[1]) : -5;
  const offsetMinutes = match && match[2] ? Number(match[2]) : 0;
  // ET midnight in UTC = 00:00 ET shifted by -offset.
  const sign = offsetHours < 0 ? -1 : 1;
  const totalOffsetMin = offsetHours * 60 + sign * offsetMinutes;
  const utcMs = Date.parse(`${etDate}T00:00:00Z`) - totalOffsetMin * 60_000;
  return new Date(utcMs).toISOString();
}

/** Resolve the ?account= param to a creator and the client strings to match. */
function resolveCreator(accountParam: string | null): {
  creatorKey: CreatorKey | null;
  matchTokens: readonly string[];
} {
  const creatorKey = creatorKeyFromText(accountParam);
  if (!creatorKey) return { creatorKey: null, matchTokens: [] };
  const creator = CREATORS.find((c) => c.key === creatorKey);
  return { creatorKey, matchTokens: creator?.matchTokens ?? [creatorKey] };
}

function clientMatchesCreator(client: string | null, matchTokens: readonly string[]): boolean {
  if (!client) return false;
  const lower = client.toLowerCase();
  return matchTokens.some((token) => lower.includes(token));
}

export async function GET(req: NextRequest) {
  const account = req.nextUrl.searchParams.get("account");
  const updatedAt = new Date().toISOString();
  const reportDate = todayEtDateString();

  // Always resolve capacity first — the gear setting must work regardless of
  // whether the load numerator is available.
  let config: SetterCapacityConfig;
  try {
    config = await getSetterCapacityConfig();
  } catch (error) {
    console.error("[lab/setter-load] capacity read failed, using default", error);
    config = defaultSetterCapacityConfig();
  }

  const { creatorKey, matchTokens } = resolveCreator(account);

  // Build the per-setter handled counts. Default to null (= "unknown / not
  // available") and only fill real numbers when we trust the source.
  const handledByName = new Map<string, number | null>(
    SETTER_NAMES.map((name) => [name, null]),
  );
  let source: string = SOURCE;
  let note =
    "Leads handled = today's `new_lead` ManyChat tag events per setter (ET day).";

  if (!creatorKey) {
    source = "none";
    note =
      "No valid `account` param (expected e.g. tyson/keith/lucy/antwan). Capacity is returned; leads-handled is unknown until an account is supplied.";
  } else {
    try {
      const db = getServiceSupabase();
      const startIso = startOfEtDayUtcIso(reportDate);
      const { data, error } = await db
        .from("manychat_tag_events")
        .select("setter_name, client")
        .eq("tag_name", "new_lead")
        .gte("event_at", startIso);

      if (error) {
        throw new Error(error.message);
      }

      // Seed real zeros for every setter (we have a working source).
      for (const name of SETTER_NAMES) handledByName.set(name, 0);

      const nameByLower = new Map(SETTER_NAMES.map((n) => [n.toLowerCase(), n]));
      for (const row of (data ?? []) as Array<{
        setter_name: string | null;
        client: string | null;
      }>) {
        if (!clientMatchesCreator(row.client, matchTokens)) continue;
        const canonical = nameByLower.get((row.setter_name || "").trim().toLowerCase());
        if (!canonical) continue;
        handledByName.set(canonical, (handledByName.get(canonical) ?? 0) + 1);
      }

      note = `Leads handled = today's (ET, since ${reportDate}) \`new_lead\` ManyChat tag events for ${creatorKey}, counted per setter.`;
    } catch (error) {
      console.error("[lab/setter-load] leads-handled read failed", error);
      source = `${SOURCE} (unavailable)`;
      note =
        "Could not read leads-handled from manychat_tag_events; returning null counts. Capacity below is still valid.";
      // Leave handled as null for each setter — never fabricate.
      for (const name of SETTER_NAMES) handledByName.set(name, null);
    }
  }

  const perSetter = SETTER_NAMES.map((name) => {
    const handled = handledByName.get(name) ?? null;
    const capacity = capacityForSetter(config, name);
    const loadPct =
      handled != null && capacity > 0 ? handled / capacity : null;
    return { name, handled, capacity, loadPct };
  });

  const handledKnown = perSetter.every((s) => s.handled != null);
  const handledTotal = handledKnown
    ? perSetter.reduce((sum, s) => sum + (s.handled ?? 0), 0)
    : null;
  const capacityTotal = perSetter.reduce((sum, s) => sum + s.capacity, 0);
  const teamLoadPct =
    handledTotal != null && capacityTotal > 0 ? handledTotal / capacityTotal : null;
  const status =
    teamLoadPct == null ? "unknown" : teamLoadPct <= THRESHOLD_PCT ? "green" : "red";

  return NextResponse.json(
    {
      account: account ?? null,
      perSetter,
      team: {
        handledTotal,
        capacityTotal,
        loadPct: teamLoadPct,
        thresholdPct: THRESHOLD_PCT,
        status,
      },
      source,
      updatedAt,
      note,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
