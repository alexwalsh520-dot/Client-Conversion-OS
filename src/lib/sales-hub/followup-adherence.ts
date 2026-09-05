import { getServiceSupabase } from "@/lib/supabase";
import { getActiveClients } from "@/lib/registry";
import { addBusinessMinutes, businessMinutesBetween } from "@/lib/sales-hub/business-hours";
import { fetchSheetData } from "@/lib/google-sheets";
import {
  buildAssignments,
  buildLeadLinkMap,
  findAssignmentForMessage,
  isAutomatedOutbound,
  loadAllRows,
  manychatChatUrl,
  toEtDateStr,
  type AssignmentEventRow,
  type ClientDef,
  type LeadAssignment,
  type LeadLinkRow,
  type MessageRow,
} from "@/lib/sales-hub/response-times";

// ─────────────────────────────────────────────────────────────────────────
// Follow-up Adherence — did the setters follow the follow-up cadence?
//
// The cadence (working hours 11am–11pm ET):
//   • Follow-up #1: 15–60 WORKING minutes after any of our DMs the lead
//     didn't answer. (Outbounds within 15 working minutes of each other are
//     one "touch", so double-texting never counts as a follow-up.)
//   • Follow-up #2+: 24 wall-clock hours after the previous follow-up, with
//     ±2h of flexibility → the 22h–26h window.
//   • The chain stops when the lead replies, books, is tagged done
//     (booked/sold/closed/waiting), or after MAX_FOLLOWUPS touches.
//
// A "due point" is one expected follow-up. Its window eventually closes one
// of three ways: sent in-window (adherent), sent outside it (off-cadence),
// or never sent before the window lapsed (missed). Adherence = in-window ÷
// all closed due points. Reply rate = follow-ups that the lead answered next
// ÷ follow-ups sent. Bookings attribute to the DEEPEST follow-up the lead
// had received before they booked (sales-tracker rows with a ManyChat link
// are the booking signal).
// ─────────────────────────────────────────────────────────────────────────

const MAX_FOLLOWUPS = 6;
const SAME_TOUCH_WORK_MINUTES = 15;
const FU1_CLOSE_WORK_MINUTES = 60;
const NEXT_OPEN_HOURS = 22;
const NEXT_CLOSE_HOURS = 26;
// A lead whose chain anchor is older than this is no longer actionable.
const NEEDS_STALE_DAYS = 10;
const STOP_TAG_SUBSTRINGS = ["booked", "sold", "closed", "waiting"];

export interface FollowupStage {
  stage: number;
  due: number;
  inWindow: number;
  offWindow: number;
  missed: number;
  sent: number;
  replies: number;
  booked: number;
  adherenceRate: number | null;
  replyRate: number | null;
}

export interface FollowupGroup {
  id: string;
  label: string;
  due: number;
  inWindow: number;
  offWindow: number;
  missed: number;
  sent: number;
  replies: number;
  booked: number;
  adherenceRate: number | null;
  replyRate: number | null;
  stages: FollowupStage[];
}

export interface NeedsFollowupRow {
  client: string;
  clientLabel: string;
  setterLabel: string;
  leadName: string | null;
  subscriberId: string;
  manychatUrl: string | null;
  stage: number;
  lastFollowupAt: string; // our last unanswered message (the anchor)
  dueAt: string; // when the follow-up window opens
  closeAt: string; // when the window lapses
  overdueMinutes: number; // 0 while the window is still open
}

export interface FollowupAdherenceResult {
  team: FollowupGroup;
  setters: FollowupGroup[];
  needsFollowup: NeedsFollowupRow[];
  maxFollowups: number;
  asOf: string;
  cadence: string;
}

interface DuePoint {
  stage: number;
  status: "in" | "off" | "missed";
  openAt: string;
  sentAt: string | null;
  replied: boolean;
  setterKey: string;
  setterLabel: string;
  subscriberId: string; // ManyChat subscriber id (assignment)
}

function addDaysIso(dateStr: string, days: number) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? (numerator / denominator) * 100 : null;
}

function emptyStage(stage: number): FollowupStage {
  return {
    stage,
    due: 0,
    inWindow: 0,
    offWindow: 0,
    missed: 0,
    sent: 0,
    replies: 0,
    booked: 0,
    adherenceRate: null,
    replyRate: null,
  };
}

function summarizeGroup(id: string, label: string, points: DuePoint[], bookedByStage: Map<number, number>): FollowupGroup {
  const stages = Array.from({ length: MAX_FOLLOWUPS }, (_, i) => emptyStage(i + 1));
  for (const p of points) {
    const s = stages[p.stage - 1];
    if (!s) continue;
    s.due += 1;
    if (p.status === "in") s.inWindow += 1;
    else if (p.status === "off") s.offWindow += 1;
    else s.missed += 1;
    if (p.status !== "missed") {
      s.sent += 1;
      if (p.replied) s.replies += 1;
    }
  }
  for (const [stage, count] of bookedByStage) {
    const s = stages[stage - 1];
    if (s) s.booked += count;
  }
  for (const s of stages) {
    s.adherenceRate = rate(s.inWindow, s.due);
    s.replyRate = rate(s.replies, s.sent);
  }
  const total = stages.reduce(
    (a, s) => ({
      due: a.due + s.due,
      inWindow: a.inWindow + s.inWindow,
      offWindow: a.offWindow + s.offWindow,
      missed: a.missed + s.missed,
      sent: a.sent + s.sent,
      replies: a.replies + s.replies,
      booked: a.booked + s.booked,
    }),
    { due: 0, inWindow: 0, offWindow: 0, missed: 0, sent: 0, replies: 0, booked: 0 },
  );
  return {
    id,
    label,
    ...total,
    adherenceRate: rate(total.inWindow, total.due),
    replyRate: rate(total.replies, total.sent),
    stages,
  };
}

export async function getFollowupAdherence(params: {
  client: string; // "all" or a registry client key
  dateFrom: string;
  dateTo: string;
}): Promise<FollowupAdherenceResult> {
  const { client, dateFrom, dateTo } = params;
  const sb = getServiceSupabase();
  const nowMs = Date.now();

  // Live client list (same registry the rest of the hub uses).
  let clients: ClientDef[] = [{ id: "tyson", key: "tyson_sonnek", label: "Tyson" }];
  try {
    const actives = await getActiveClients();
    if (actives.length > 0) clients = actives.map((c) => ({ id: c.key, key: c.manychatKey, label: c.name }));
  } catch {
    // registry unreachable — static fallback above keeps the tab rendering
  }
  const visibleClients = client === "all" ? clients : clients.filter((c) => c.id === client);
  const clientKeys = visibleClients.map((c) => c.key);
  if (clientKeys.length === 0) {
    return {
      team: summarizeGroup("team", "Team", [], new Map()),
      setters: [],
      needsFollowup: [],
      maxFollowups: MAX_FOLLOWUPS,
      asOf: iso(nowMs),
      cadence: "FU1 15–60 working min · then every 24h (22–26h window) · 11am–11pm ET",
    };
  }

  // Chains can start before the viewed range; pad the message window a week.
  const msgStart = addDaysIso(dateFrom, -7);
  const msgEnd = addDaysIso(dateTo, 1);
  const assignmentStart = addDaysIso(dateFrom, -120);

  const [assignmentRows, messageRows] = await Promise.all([
    loadAllRows<AssignmentEventRow>(async (from, to) => {
      const { data, error } = await sb
        .from("manychat_tag_events")
        .select("client, subscriber_id, subscriber_name, setter_name, tag_name, event_at, raw_payload")
        .in("client", clientKeys)
        .gte("event_at", `${assignmentStart}T00:00:00.000Z`)
        .lte("event_at", `${msgEnd}T23:59:59.999Z`)
        .order("event_at", { ascending: false })
        .range(from, to);
      return { data: (data as AssignmentEventRow[] | null) ?? null, error };
    }),
    loadAllRows<MessageRow>(async (from, to) => {
      const { data, error } = await sb
        .from("dm_conversation_messages")
        .select("client, subscriber_id, conversation_id, message_id, direction, channel, message_type, body, sent_at, raw_payload")
        .in("client", clientKeys)
        .gte("sent_at", `${msgStart}T00:00:00.000Z`)
        .lte("sent_at", `${msgEnd}T23:59:59.999Z`)
        .order("sent_at", { ascending: false })
        .range(from, to);
      return { data: (data as MessageRow[] | null) ?? null, error };
    }),
  ]);

  let leadLinks: LeadLinkRow[] = [];
  try {
    leadLinks = await loadAllRows<LeadLinkRow>(async (from, to) => {
      const { data, error } = await sb
        .from("instagram_lead_links")
        .select("client, manychat_subscriber_id, instagram_user_id, instagram_handle")
        .in("client", clientKeys)
        .range(from, to);
      return { data: (data as LeadLinkRow[] | null) ?? null, error };
    });
  } catch {
    leadLinks = [];
  }

  // Booking signal: sales-tracker rows carrying a ManyChat link. (Terminal-tag
  // events would be the exact booked-at moment, but those External Requests
  // aren't wired yet — the tracker row is the authoritative booking record.)
  const bookedAtBySubscriber = new Map<string, number>();
  try {
    const sheetRows = await fetchSheetData(dateFrom, dateTo);
    for (const row of sheetRows) {
      if (row.programLength === "Subscription") continue;
      const mcId = row.manychatSubscriberId;
      if (!mcId || !row.date) continue;
      const at = new Date(`${row.date}T23:59:59Z`).getTime();
      const prev = bookedAtBySubscriber.get(mcId);
      if (prev === undefined || at < prev) bookedAtBySubscriber.set(mcId, at);
    }
  } catch {
    // sheet unreachable — bookings column just reads zero
  }

  // The moment a lead was tagged done — no follow-ups are owed after that.
  const doneAtBySubscriber = new Map<string, number>();
  for (const event of assignmentRows) {
    if (!event.subscriber_id || !event.event_at) continue;
    const name = (event.tag_name || "").toLowerCase();
    if (!STOP_TAG_SUBSTRINGS.some((sub) => name.includes(sub))) continue;
    const at = new Date(event.event_at).getTime();
    if (Number.isNaN(at)) continue;
    const prev = doneAtBySubscriber.get(event.subscriber_id);
    if (prev === undefined || at < prev) doneAtBySubscriber.set(event.subscriber_id, at);
  }

  const assignments = buildAssignments(assignmentRows, visibleClients);
  const linkMap = buildLeadLinkMap(leadLinks);

  const grouped = new Map<string, MessageRow[]>();
  for (const m of messageRows) {
    if (!m.conversation_id || !m.sent_at) continue;
    grouped.set(`${m.client}:${m.conversation_id}`, [...(grouped.get(`${m.client}:${m.conversation_id}`) || []), m]);
  }

  const duePoints: DuePoint[] = [];
  const needsFollowup: NeedsFollowupRow[] = [];
  // For booking attribution: every SENT follow-up per lead.
  const sentBySubscriber = new Map<string, { stage: number; sentAtMs: number }[]>();

  const staleCutoffMs = nowMs - NEEDS_STALE_DAYS * 24 * 3600 * 1000;

  const windowFor = (anchorAt: string, stage: number) => {
    if (stage === 1) {
      return {
        openAt: addBusinessMinutes(anchorAt, SAME_TOUCH_WORK_MINUTES),
        closeAt: addBusinessMinutes(anchorAt, FU1_CLOSE_WORK_MINUTES),
      };
    }
    const t = new Date(anchorAt).getTime();
    return { openAt: iso(t + NEXT_OPEN_HOURS * 3600e3), closeAt: iso(t + NEXT_CLOSE_HOURS * 3600e3) };
  };

  const inMetricsRange = (openAt: string) => {
    const et = toEtDateStr(openAt);
    return et >= dateFrom && et <= dateTo;
  };

  for (const messages of grouped.values()) {
    const ordered = [...messages].sort((a, b) => (a.sent_at || "").localeCompare(b.sent_at || ""));

    let assignment: LeadAssignment | null = null;
    let anchorAt: string | null = null;
    let depth = 0;
    let lastFollowup: DuePoint | null = null;

    const resolveAssignment = (m: MessageRow) => {
      if (assignment) return assignment;
      const found = findAssignmentForMessage(assignments, linkMap, m.client, m.subscriber_id, m.sent_at || "");
      if (found?.newLeadAt) assignment = found;
      return assignment;
    };

    const stoppedBefore = (ms: number) => {
      if (!assignment) return false;
      const done = doneAtBySubscriber.get(assignment.subscriberId);
      if (done !== undefined && done <= ms) return true;
      const booked = bookedAtBySubscriber.get(assignment.subscriberId);
      return booked !== undefined && booked <= ms;
    };

    const recordMissedIfLapsed = (beforeMs: number) => {
      // The pending window closed with no follow-up before `beforeMs` happened.
      if (!anchorAt || !assignment) return;
      const stage = depth + 1;
      if (stage > MAX_FOLLOWUPS) return;
      const { openAt, closeAt } = windowFor(anchorAt, stage);
      const closeMs = new Date(closeAt).getTime();
      if (beforeMs <= closeMs) return; // window hadn't lapsed yet — no miss
      if (stoppedBefore(new Date(openAt).getTime())) return; // lead was done first
      if (!inMetricsRange(openAt)) return;
      duePoints.push({
        stage,
        status: "missed",
        openAt,
        sentAt: null,
        replied: false,
        setterKey: assignment.setterKey || "unassigned",
        setterLabel: assignment.setterLabel || "Unassigned",
        subscriberId: assignment.subscriberId,
      });
    };

    for (const m of ordered) {
      if (!m.sent_at || !m.direction) continue;

      if (m.direction === "inbound") {
        // The lead spoke: whatever follow-up they answered gets reply credit,
        // an un-followed lapsed window is a miss, and the chain resets.
        if (lastFollowup && !lastFollowup.replied) lastFollowup.replied = true;
        recordMissedIfLapsed(new Date(m.sent_at).getTime());
        anchorAt = null;
        depth = 0;
        lastFollowup = null;
        continue;
      }

      if (m.direction !== "outbound" || isAutomatedOutbound(m)) continue;

      if (!resolveAssignment(m)) continue; // not a known lead — skip conversation-less noise

      if (anchorAt === null) {
        anchorAt = m.sent_at;
        lastFollowup = null;
        continue;
      }

      const workGap = businessMinutesBetween(anchorAt, m.sent_at);
      if (workGap <= SAME_TOUCH_WORK_MINUTES) {
        // Double-text / same touch: extend the anchor, no follow-up counted.
        anchorAt = m.sent_at;
        continue;
      }

      const stage = depth + 1;
      if (stage <= MAX_FOLLOWUPS && assignment && !stoppedBefore(new Date(m.sent_at).getTime())) {
        const { openAt } = windowFor(anchorAt, stage);
        let status: "in" | "off";
        if (stage === 1) {
          status = workGap <= FU1_CLOSE_WORK_MINUTES ? "in" : "off";
        } else {
          const hours = (new Date(m.sent_at).getTime() - new Date(anchorAt).getTime()) / 3600e3;
          status = hours >= NEXT_OPEN_HOURS && hours <= NEXT_CLOSE_HOURS ? "in" : "off";
        }
        const point: DuePoint = {
          stage,
          status,
          openAt,
          sentAt: m.sent_at,
          replied: false,
          setterKey: assignment.setterKey || "unassigned",
          setterLabel: assignment.setterLabel || "Unassigned",
          subscriberId: assignment.subscriberId,
        };
        if (inMetricsRange(openAt)) duePoints.push(point);
        lastFollowup = point;
        const sentList = sentBySubscriber.get(assignment.subscriberId) || [];
        sentList.push({ stage, sentAtMs: new Date(m.sent_at).getTime() });
        sentBySubscriber.set(assignment.subscriberId, sentList);
      }
      depth = Math.min(stage, MAX_FOLLOWUPS);
      anchorAt = m.sent_at;
    }

    // Conversation ended on our unanswered message: is a follow-up owed now?
    if (anchorAt && assignment && depth < MAX_FOLLOWUPS) {
      const stage = depth + 1;
      const { openAt, closeAt } = windowFor(anchorAt, stage);
      const openMs = new Date(openAt).getTime();
      const closeMs = new Date(closeAt).getTime();
      const anchorMs = new Date(anchorAt).getTime();
      const stopped = stoppedBefore(nowMs);

      if (!stopped && nowMs > closeMs) {
        recordMissedIfLapsed(nowMs);
      }
      if (!stopped && nowMs >= openMs && anchorMs >= staleCutoffMs) {
        needsFollowup.push({
          client: assignment.client.id,
          clientLabel: assignment.client.label,
          setterLabel: assignment.setterLabel || "Unassigned",
          leadName: assignment.leadName,
          subscriberId: assignment.subscriberId,
          manychatUrl: manychatChatUrl(assignment.client.id, assignment.subscriberId),
          stage,
          lastFollowupAt: anchorAt,
          dueAt: openAt,
          closeAt,
          overdueMinutes: nowMs > closeMs ? Math.round((nowMs - closeMs) / 60000) : 0,
        });
      }
    }
  }

  // Bookings by follow-up depth: the deepest follow-up the lead had received
  // before they booked. Counted once per lead.
  const bookedByStageTeam = new Map<number, number>();
  const bookedByStageSetter = new Map<string, Map<number, number>>();
  const setterOfSubscriber = new Map<string, string>();
  for (const p of duePoints) setterOfSubscriber.set(p.subscriberId, p.setterKey);
  for (const [subscriberId, bookedAt] of bookedAtBySubscriber) {
    const sent = sentBySubscriber.get(subscriberId);
    if (!sent || sent.length === 0) continue;
    const before = sent.filter((s) => s.sentAtMs <= bookedAt);
    if (before.length === 0) continue;
    const stage = Math.max(...before.map((s) => s.stage));
    bookedByStageTeam.set(stage, (bookedByStageTeam.get(stage) || 0) + 1);
    const setterKey = setterOfSubscriber.get(subscriberId) || "unassigned";
    const perSetter = bookedByStageSetter.get(setterKey) || new Map<number, number>();
    perSetter.set(stage, (perSetter.get(stage) || 0) + 1);
    bookedByStageSetter.set(setterKey, perSetter);
  }

  const bySetter = new Map<string, { label: string; points: DuePoint[] }>();
  for (const p of duePoints) {
    const entry = bySetter.get(p.setterKey) || { label: p.setterLabel, points: [] };
    entry.points.push(p);
    bySetter.set(p.setterKey, entry);
  }

  const setters = [...bySetter.entries()]
    .map(([key, entry]) =>
      summarizeGroup(key, entry.label, entry.points, bookedByStageSetter.get(key) || new Map()),
    )
    .sort((a, b) => b.due - a.due);

  needsFollowup.sort((a, b) => b.overdueMinutes - a.overdueMinutes || a.dueAt.localeCompare(b.dueAt));

  return {
    team: summarizeGroup("team", "Team", duePoints, bookedByStageTeam),
    setters,
    needsFollowup: needsFollowup.slice(0, 100),
    maxFollowups: MAX_FOLLOWUPS,
    asOf: iso(nowMs),
    cadence: "FU1: 15–60 working min · FU2+: every 24h (22–26h window) · 11am–11pm ET",
  };
}
