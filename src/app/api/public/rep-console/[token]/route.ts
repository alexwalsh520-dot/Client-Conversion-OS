// ─────────────────────────────────────────────────────────────────────────
// PUBLIC, NO-LOGIN REP CONSOLE API — the data boundary for the tokenized
// rep page at /p/rep-console/<token>.
//
// The console launches VIEW-ONLY (closers keep their spreadsheet while the
// owner tests it); editing is enabled later per token via the settings on
// the public_share_links row (settings->>'can_edit' === 'true').
//
// Contract (mirrors /api/public/client-metrics):
//   * Access is decided SOLELY by the token row in public_share_links
//     (kind = 'rep-console', not revoked). Client scope comes from the token
//     row's client_key — no client param is honored.
//   * GET returns:
//       - appointments: last 14 + next 7 ET days from ghl_appointments on
//         the engine's pinned calendars, enriched with ledger lead info,
//         the sheet's outcome for that person, and any manual entries.
//        If settings->>'rep_key' is set, the list is scoped to that rep.
//       - leaderboard: per-rep cash / shows / calls due / show rate /
//         closes / close rate over the requested range (same from/to/preset
//         params as the summary API, default MTD) + a total row. The
//         leaderboard ALWAYS shows every rep — it is a leaderboard.
//       - can_edit: whether this token accepts POSTs.
//   * POST inserts a metrics_manual_entries row ({appointment_key?,
//     entry_type, value, rep_name}); 403 when the token is view-only. The
//     build job merges outcome/cash entries as source='manual' override
//     events.
//   * Per-token rate limit, no-store, noindex. Missing 113 tables degrade
//     to empty enrichment + migration_pending: true.
// ─────────────────────────────────────────────────────────────────────────
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";
import { etDay, todayEt, shiftDay, rangeForPreset, type PresetId, type DayRange } from "@/lib/ads-v2/time";
import { isCreatorKey, CREATORS_BY_KEY, creatorKeyFromText, type CreatorKey } from "@/lib/creators";
import { engineCalendar, ENGINE_CALENDARS } from "@/lib/metrics-engine/calendars";
import { REPS, REPS_BY_KEY, repKeyFromGhlUserId, isRepKey } from "@/lib/metrics-engine/team";
import { trackerNameKey } from "@/lib/metrics-engine/build";
import { chunk, isMissingRelation, safeFetchAllRows } from "@/lib/metrics-engine/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const KIND = "rep-console";
const PAST_DAYS = 14;
const FUTURE_DAYS = 7;

// Per-token rate limit (per instance): fine for a page someone leaves open,
// hostile to token-guessing scripts.
const RATE_LIMIT = { windowMs: 10_000, max: 30 };
const rateBuckets = new Map<string, { windowStart: number; count: number }>();

function rateLimited(token: string): boolean {
  const now = Date.now();
  const bucket = rateBuckets.get(token);
  if (!bucket || now - bucket.windowStart > RATE_LIMIT.windowMs) {
    rateBuckets.set(token, { windowStart: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT.max;
}

interface TokenScope {
  // 'all' = business-wide token (every engine client): the owner's master
  // console, and the right scope for full-cycle reps who work both clients.
  clientKey: CreatorKey | "all";
  canEdit: boolean;
  repKey: string | null;
}

const ALL_ENGINE_CLIENTS = [...new Set(ENGINE_CALENDARS.map((c) => c.client))] as CreatorKey[];

const clientsForScope = (scope: TokenScope): CreatorKey[] =>
  scope.clientKey === "all" ? ALL_ENGINE_CLIENTS : [scope.clientKey];

async function resolveToken(token: string): Promise<TokenScope | null> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from("public_share_links")
      .select("kind, revoked, client_key, settings")
      .eq("token", token)
      .maybeSingle();
    if (error || !data || data.revoked || data.kind !== KIND) return null;
    const clientKey =
      data.client_key === "all" ? ("all" as const) : isCreatorKey(data.client_key) ? data.client_key : null;
    if (!clientKey) return null;
    const settings = (data.settings as { can_edit?: string; rep_key?: string } | null) ?? {};
    const repKey = settings.rep_key && isRepKey(settings.rep_key) ? settings.rep_key : null;
    return {
      clientKey,
      canEdit: settings.can_edit === "true",
      repKey,
    };
  } catch {
    return null;
  }
}

const isIsoDay = (v: string | null): v is string => Boolean(v && /^\d{4}-\d{2}-\d{2}$/.test(v));

const PRESET_IDS: readonly string[] = [
  "today", "yesterday", "last3", "last7", "last14", "last30", "mtd", "lmtd", "custom",
];

function resolveRange(req: NextRequest): DayRange {
  const from = req.nextUrl.searchParams.get("from");
  const to = req.nextUrl.searchParams.get("to");
  if (isIsoDay(from) && isIsoDay(to)) {
    let [f, t] = from <= to ? [from, to] : [to, from];
    // Cap hostile windows at a year.
    if (shiftDay(f, 366) < t) t = shiftDay(f, 366);
    return { from: f, to: t };
  }
  const presetRaw = req.nextUrl.searchParams.get("preset");
  const preset: PresetId =
    presetRaw && PRESET_IDS.includes(presetRaw) ? (presetRaw as PresetId) : "mtd";
  return rangeForPreset(preset, todayEt());
}

// ── GET: appointments + leaderboard ──────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (rateLimited(token)) {
    return NextResponse.json(
      { error: "Too many requests. Give it a few seconds." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const scope = await resolveToken(token);
  if (!scope) {
    return NextResponse.json(
      { error: "This link is not available." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }

  const db = getServiceSupabase();
  const today = todayEt();
  const apptFrom = shiftDay(today, -PAST_DAYS);
  const apptTo = shiftDay(today, FUTURE_DAYS);
  const nowIso = new Date().toISOString();
  let migrationPending = false;

  // 1) Appointments on the pinned calendars, scheduled in the window.
  const apptRes = await safeFetchAllRows<{
    appointment_id: string;
    calendar_id: string | null;
    contact_id: string | null;
    contact_name: string | null;
    contact_phone: string | null;
    start_time: string | null;
    assigned_user_id: string | null;
    status: string | null;
    event_type: string | null;
    created_at: string | null;
  }>((from, to) =>
    db
      .schema("warehouse")
      .from("ghl_appointments")
      .select(
        "appointment_id, calendar_id, contact_id, contact_name, contact_phone, start_time, assigned_user_id, status, event_type, created_at",
      )
      .gte("start_time", `${shiftDay(apptFrom, -1)}T00:00:00Z`)
      .lte("start_time", `${shiftDay(apptTo, 1)}T23:59:59Z`)
      .order("start_time", { ascending: true })
      .range(from, to),
  );

  const appts = apptRes.rows
    .map((r) => ({ row: r, cal: engineCalendar(r.calendar_id) }))
    .filter((x): x is { row: (typeof apptRes.rows)[number]; cal: NonNullable<ReturnType<typeof engineCalendar>> } =>
      Boolean(x.cal && (scope.clientKey === "all" || x.cal.client === scope.clientKey)),
    )
    .filter((x) => {
      const day = x.row.start_time ? etDay(x.row.start_time) : null;
      return Boolean(day && day >= apptFrom && day <= apptTo);
    });

  // 2) Ledger enrichment: the booking events the build wrote for these
  //    appointments carry the resolved lead_key + channel.
  const apptIds = appts.map((x) => x.row.appointment_id);
  const bookingByAppt = new Map<string, { lead_key: string | null; channel: string | null; rep_key: string | null }>();
  for (const ids of chunk(apptIds, 100)) {
    const res = await safeFetchAllRows<{
      lead_key: string | null;
      channel: string | null;
      rep_key: string | null;
      source_row_key: string;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("metrics_lead_events")
        .select("lead_key, channel, rep_key, source_row_key")
        .eq("source", "ghl_appointments")
        .in("source_row_key", ids.map((id) => `booking:${id}`))
        .order("source_row_key", { ascending: true })
        .range(from, to),
    );
    if (res.missing) migrationPending = true;
    for (const b of res.rows) {
      bookingByAppt.set(b.source_row_key.replace(/^booking:/, ""), b);
    }
  }

  const leadKeys = [...new Set([...bookingByAppt.values()].map((b) => b.lead_key).filter(Boolean))] as string[];
  const leadByKey = new Map<string, {
    lead_key: string;
    display_name: string | null;
    ig_handle: string | null;
    origin_source: string;
    conversion_source: string | null;
    lm_optin_at: string | null;
    acquired_et_day: string;
  }>();
  for (const keys of chunk(leadKeys, 200)) {
    const res = await safeFetchAllRows<{
      lead_key: string;
      display_name: string | null;
      ig_handle: string | null;
      origin_source: string;
      conversion_source: string | null;
      lm_optin_at: string | null;
      acquired_et_day: string;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("metrics_leads")
        .select("lead_key, display_name, ig_handle, origin_source, conversion_source, lm_optin_at, acquired_et_day")
        .in("client_key", clientsForScope(scope))
        .in("lead_key", keys)
        .order("lead_key", { ascending: true })
        .range(from, to),
    );
    if (res.missing) migrationPending = true;
    for (const l of res.rows) leadByKey.set(l.lead_key, l);
  }

  // 3) Sheet outcome per person (interim truth): match by pasted ManyChat
  //    id first, else by normalized name, within the appointment window.
  const sheetRes = await safeFetchAllRows<{
    date: string;
    prospect_name: string | null;
    call_taken_status: string | null;
    outcome: string | null;
    closer: string | null;
    collected_revenue_cents: number | null;
    manychat_subscriber_id: string | null;
    program_length: string | null;
    offer: string | null;
  }>((from, to) =>
    db
      .schema("warehouse")
      .from("sales_tracker_rows")
      .select(
        "date, prospect_name, call_taken_status, outcome, closer, collected_revenue_cents, manychat_subscriber_id, program_length, offer:raw_payload->>offer",
      )
      .gte("date", apptFrom)
      .lte("date", apptTo)
      .order("date", { ascending: true })
      .range(from, to),
  );
  const sheetRows = sheetRes.rows.filter(
    (r) =>
      (r.program_length || "").trim().toLowerCase() !== "subscription" &&
      clientsForScope(scope).includes(creatorKeyFromText(r.offer) as CreatorKey),
  );
  const sheetByMc = new Map<string, (typeof sheetRows)[number]>();
  const sheetByName = new Map<string, (typeof sheetRows)[number]>();
  for (const r of sheetRows) {
    const mc = (r.manychat_subscriber_id || "").trim();
    if (mc && !sheetByMc.has(mc)) sheetByMc.set(mc, r);
    const nk = trackerNameKey(r.prospect_name);
    if (nk && !sheetByName.has(nk)) sheetByName.set(nk, r);
  }

  // 4) Manual entries for these appointments.
  const entriesByAppt = new Map<string, Array<Record<string, unknown>>>();
  for (const ids of chunk(apptIds, 100)) {
    const res = await safeFetchAllRows<{
      id: string;
      appointment_key: string | null;
      entry_type: string;
      value: Record<string, unknown> | null;
      rep_name: string | null;
      entered_at: string;
      applied: boolean;
    }>((from, to) =>
      db
        .schema("warehouse")
        .from("metrics_manual_entries")
        .select("id, appointment_key, entry_type, value, rep_name, entered_at, applied")
        .in("client_key", clientsForScope(scope))
        .in("appointment_key", ids)
        .order("entered_at", { ascending: true })
        .range(from, to),
    );
    if (res.missing) migrationPending = true;
    for (const e of res.rows) {
      if (!e.appointment_key) continue;
      const list = entriesByAppt.get(e.appointment_key) ?? [];
      list.push({
        id: e.id,
        entry_type: e.entry_type,
        value: e.value,
        rep_name: e.rep_name,
        entered_at: e.entered_at,
        applied: e.applied,
      });
      entriesByAppt.set(e.appointment_key, list);
    }
  }

  const appointments = appts
    .map(({ row, cal }) => {
      const booking = bookingByAppt.get(row.appointment_id) ?? null;
      const lead = booking?.lead_key ? leadByKey.get(booking.lead_key) ?? null : null;
      const repKey = cal.repKey ?? repKeyFromGhlUserId(row.assigned_user_id);
      const mc = booking?.lead_key?.startsWith("mc:") ? booking.lead_key.slice(3) : null;
      const nameKey = trackerNameKey(row.contact_name);
      const sheet = (mc ? sheetByMc.get(mc) : null) ?? (nameKey ? sheetByName.get(nameKey) : null) ?? null;
      const cancelled = `${row.status || ""} ${row.event_type || ""}`.toLowerCase().includes("cancel");
      const upcoming = Boolean(row.start_time && row.start_time > nowIso);
      const sheetTaken = (sheet?.call_taken_status || "").toLowerCase();
      const sheetStatus = !sheet
        ? null
        : (sheet.outcome || "").toUpperCase() === "WIN"
          ? "closed"
          : sheetTaken === "yes"
            ? "taken"
            : sheetTaken === "no"
              ? "no_show"
              : "upcoming";
      return {
        appointment_id: row.appointment_id,
        client: cal.client,
        calendar_name: cal.name,
        side: cal.side,
        channel: booking?.channel ?? (cal.side === "dm" ? "dm" : "outbound"),
        rep_key: repKey,
        rep_name: repKey ? REPS_BY_KEY[repKey]?.name ?? repKey : null,
        contact_name: row.contact_name,
        start_time: row.start_time,
        start_et_day: row.start_time ? etDay(row.start_time) : null,
        status: row.status,
        cancelled,
        upcoming,
        lead: lead
          ? {
              lead_key: lead.lead_key,
              display_name: lead.display_name,
              ig_handle: lead.ig_handle,
              origin_source: lead.origin_source,
              conversion_source: lead.conversion_source,
              lm_optin_at: lead.lm_optin_at,
              acquired_et_day: lead.acquired_et_day,
            }
          : null,
        sheet_outcome: sheet
          ? {
              status: sheetStatus,
              outcome: sheet.outcome,
              closer: sheet.closer,
              date: sheet.date,
              cash_collected_cents: Number(sheet.collected_revenue_cents || 0),
            }
          : null,
        manual_entries: entriesByAppt.get(row.appointment_id) ?? [],
      };
    })
    .filter((a) => !scope.repKey || a.rep_key === scope.repKey);

  // 5) Leaderboard over the requested range (default MTD). Always every
  //    rep — a leaderboard with people hidden is not a leaderboard.
  const range = resolveRange(req);
  const leaderboard = await buildLeaderboard(clientsForScope(scope), range, nowIso, () => {
    migrationPending = true;
  });

  return NextResponse.json(
    {
      clientLabel:
        scope.clientKey === "all" ? "All Clients" : CREATORS_BY_KEY[scope.clientKey].name,
      client: scope.clientKey,
      can_edit: scope.canEdit,
      rep_scope: scope.repKey,
      appointments_window: { from: apptFrom, to: apptTo },
      appointments,
      leaderboard_range: range,
      leaderboard,
      migration_pending: migrationPending,
      generatedAt: new Date().toISOString(),
    },
    { headers: NO_STORE_HEADERS },
  );
}

async function buildLeaderboard(
  clientKeys: CreatorKey[],
  range: DayRange,
  nowIso: string,
  onMissing: () => void,
) {
  const db = getServiceSupabase();

  interface Ev {
    id: string;
    lead_key: string | null;
    event_type: string;
    rep_key: string | null;
    et_day: string;
    amount_cents: number | null;
    source: string;
    metadata: { start_et_day?: string | null; start_time?: string | null } | null;
  }

  // Activity events in the window…
  const evRes = await safeFetchAllRows<Ev>((from, to) =>
    db
      .schema("warehouse")
      .from("metrics_lead_events")
      .select("id, lead_key, event_type, rep_key, et_day, amount_cents, source, metadata")
      .in("client_key", clientKeys)
      .in("event_type", ["show", "no_show", "close", "payment"])
      .gte("et_day", range.from)
      .lte("et_day", range.to)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (evRes.missing) onMissing();

  // …plus bookings whose call is DUE in the window (denominator).
  const dueRes = await safeFetchAllRows<Ev>((from, to) =>
    db
      .schema("warehouse")
      .from("metrics_lead_events")
      .select("id, lead_key, event_type, rep_key, et_day, amount_cents, source, metadata")
      .in("client_key", clientKeys)
      .eq("event_type", "booking")
      .gte("metadata->>start_et_day", range.from)
      .lte("metadata->>start_et_day", range.to)
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (dueRes.missing) onMissing();

  // Manual overrides sheet for the same lead+day+type (build.ts discipline).
  const chosen = new Map<string, Ev>();
  let anon = 0;
  for (const e of evRes.rows) {
    const key = e.lead_key
      ? `${e.lead_key}|${e.event_type}|${e.et_day}`
      : `anon:${anon++}:${e.id}`;
    const cur = chosen.get(key);
    if (!cur) chosen.set(key, e);
    else if (e.source === "manual" && cur.source !== "manual") chosen.set(key, e);
  }

  interface Row {
    shows: number;
    closes: number;
    cash: number;
    due: number;
  }
  const perRep = new Map<string, Row>();
  const rowFor = (rep: string) => {
    let r = perRep.get(rep);
    if (!r) perRep.set(rep, (r = { shows: 0, closes: 0, cash: 0, due: 0 }));
    return r;
  };
  const total: Row = { shows: 0, closes: 0, cash: 0, due: 0 };

  for (const e of chosen.values()) {
    const bump = (r: Row) => {
      if (e.event_type === "show") r.shows += 1;
      else if (e.event_type === "close") r.closes += 1;
      else if (e.event_type === "payment") r.cash += Number(e.amount_cents ?? 0);
    };
    bump(total);
    if (e.rep_key) bump(rowFor(e.rep_key));
  }
  for (const e of dueRes.rows) {
    const upcoming = Boolean(e.metadata?.start_time && e.metadata.start_time > nowIso);
    if (upcoming) continue;
    total.due += 1;
    if (e.rep_key) rowFor(e.rep_key).due += 1;
  }

  const rows = REPS.map((rep) => {
    const r = perRep.get(rep.key) ?? { shows: 0, closes: 0, cash: 0, due: 0 };
    return {
      rep_key: rep.key,
      rep_name: rep.name,
      cash_collected_cents: r.cash,
      shows: r.shows,
      calls_due: r.due,
      show_rate: r.due > 0 ? r.shows / r.due : null,
      closes: r.closes,
      close_rate: r.shows > 0 ? r.closes / r.shows : null,
    };
  }).sort((a, b) => b.cash_collected_cents - a.cash_collected_cents);

  return {
    rows,
    total: {
      rep_key: "total",
      rep_name: "Total",
      cash_collected_cents: total.cash,
      shows: total.shows,
      calls_due: total.due,
      show_rate: total.due > 0 ? total.shows / total.due : null,
      closes: total.closes,
      close_rate: total.shows > 0 ? total.closes / total.shows : null,
    },
  };
}

// ── POST: manual entries (gated on the token's can_edit) ─────────────────

const ENTRY_TYPES = new Set(["outcome", "reschedule", "show_fix", "cash", "note"]);
const MAX_VALUE_BYTES = 4_000;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (rateLimited(token)) {
    return NextResponse.json(
      { error: "Too many requests. Give it a few seconds." },
      { status: 429, headers: NO_STORE_HEADERS },
    );
  }

  const scope = await resolveToken(token);
  if (!scope) {
    return NextResponse.json(
      { error: "This link is not available." },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (!scope.canEdit) {
    return NextResponse.json(
      { error: "This console is view-only. Ask the operator to enable editing for this link." },
      { status: 403, headers: NO_STORE_HEADERS },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const entryType = typeof body.entry_type === "string" ? body.entry_type.trim() : "";
  if (!ENTRY_TYPES.has(entryType)) {
    return NextResponse.json(
      { error: `entry_type must be one of: ${[...ENTRY_TYPES].join(", ")}` },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const appointmentKey =
    typeof body.appointment_key === "string" && body.appointment_key.trim()
      ? body.appointment_key.trim().slice(0, 120)
      : null;
  const leadKey =
    typeof body.lead_key === "string" && body.lead_key.trim()
      ? body.lead_key.trim().slice(0, 120)
      : null;
  const repName =
    typeof body.rep_name === "string" && body.rep_name.trim()
      ? body.rep_name.trim().slice(0, 100)
      : null;

  // Business-wide tokens must say which client the entry belongs to; the
  // console UI sends the appointment's own client. Scoped tokens ignore it.
  const entryClientKey =
    scope.clientKey !== "all"
      ? scope.clientKey
      : isCreatorKey(body.client_key)
        ? body.client_key
        : null;
  if (!entryClientKey) {
    return NextResponse.json(
      { error: "client_key (tyson | jake) is required on business-wide links" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  const value =
    body.value && typeof body.value === "object" && !Array.isArray(body.value)
      ? (body.value as Record<string, unknown>)
      : {};
  if (JSON.stringify(value).length > MAX_VALUE_BYTES) {
    return NextResponse.json(
      { error: "value payload too large" },
      { status: 400, headers: NO_STORE_HEADERS },
    );
  }

  // Type-specific validation, so the build job never has to guess.
  if (entryType === "outcome") {
    const outcome = value.outcome;
    if (outcome !== "show" && outcome !== "no_show" && outcome !== "close") {
      return NextResponse.json(
        { error: "outcome entries need value.outcome = show | no_show | close" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    if (value.cash_cents !== undefined) {
      const cash = Number(value.cash_cents);
      if (!Number.isFinite(cash) || cash < 0 || cash > 100_000_000) {
        return NextResponse.json(
          { error: "value.cash_cents must be integer cents between 0 and 100,000,000" },
          { status: 400, headers: NO_STORE_HEADERS },
        );
      }
      value.cash_cents = Math.round(cash);
    }
  } else if (entryType === "cash") {
    const cash = Number(value.amount_cents);
    if (!Number.isFinite(cash) || cash <= 0 || cash > 100_000_000) {
      return NextResponse.json(
        { error: "cash entries need value.amount_cents (integer cents, up to 100,000,000)" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    value.amount_cents = Math.round(cash);
  } else if (entryType === "note") {
    if (typeof value.note !== "string" || !value.note.trim()) {
      return NextResponse.json(
        { error: "note entries need value.note" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
    value.note = value.note.trim().slice(0, 2000);
  }
  if (value.occurred_at !== undefined) {
    const at = typeof value.occurred_at === "string" ? new Date(value.occurred_at) : null;
    if (!at || Number.isNaN(at.getTime())) {
      return NextResponse.json(
        { error: "value.occurred_at must be an ISO timestamp" },
        { status: 400, headers: NO_STORE_HEADERS },
      );
    }
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .schema("warehouse")
    .from("metrics_manual_entries")
    .insert({
      client_key: entryClientKey,
      appointment_key: appointmentKey,
      lead_key: leadKey,
      entry_type: entryType,
      value,
      rep_name: repName,
      share_token: token,
    })
    .select("id, entered_at")
    .maybeSingle();

  if (error) {
    if (isMissingRelation(error)) {
      return NextResponse.json(
        { error: "The console is not ready yet (migration pending).", migration_pending: true },
        { status: 503, headers: NO_STORE_HEADERS },
      );
    }
    console.error("[public/rep-console] entry insert failed:", error);
    return NextResponse.json(
      { error: "Could not save the entry. Try again." },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }

  return NextResponse.json(
    { ok: true, id: data?.id ?? null, entered_at: data?.entered_at ?? null, applied: false },
    { headers: NO_STORE_HEADERS },
  );
}
