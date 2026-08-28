// ─────────────────────────────────────────────────────────────────────────
// DM INBOX — the conversations behind the "Messages" numbers.
//
// The lists are driven by adsv2_dm_facts with EXACTLY the filters the window
// RPC uses to count the Messages cell (not organic, not awaiting review,
// et_day inside the window), so the people listed always reconcile with the
// number that was clicked. Works for one keyword (an ad row) or many (a
// campaign / ad set row), grouped per keyword. Threads resolve in two hops,
// the same live derivation the door's get_dms_for_ad uses:
//   ManyChat subscriber -> instagram_lead_links -> dm_conversation_messages
// Some subscribers have no stored thread yet (the DM webhook captures recent
// threads); those rows are still listed, marked "no stored messages", never
// silently dropped.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";

type Row = Record<string, unknown>;
type Db = ReturnType<typeof getServiceSupabase>;

/** client_key -> the client id dm_conversation_messages / instagram_lead_links
 *  are stored under (the creator's DM handle id). */
const DM_STORE_CLIENT: Record<string, string> = {
  tyson: "tyson_sonnek",
  jake: "jake_divljak",
};

// Bulk-load ceilings. Latest messages win when a thread is longer than the
// per-thread cap; the response flags truncation instead of hiding it.
const THREAD_CAP = 300;
const SINGLE_THREAD_CAP = 800;
const MSG_TEXT_CAP = 2000;

export interface DmMessage {
  who: "lead" | "creator";
  text: string;
  at: string;
}

export interface DmConversation {
  subscriberId: string; // ManyChat id (the hard key everywhere else)
  name: string | null;
  handle: string | null;
  dmEtDay: string; // the ET day the keyword fired (facts row)
  hasThread: boolean;
  messageCount: number;
  lastMessageAt: string | null;
  lastFrom: "lead" | "creator" | null;
  snippet: string | null;
}

export interface DmGroup {
  keyword: string;
  total: number; // equals that keyword's Messages cell for the same window
  withThread: number;
  conversations: DmConversation[];
}

export interface DmInboxGrouped {
  groups: DmGroup[];
  total: number; // sum of groups = the clicked rollup cell
  withThread: number;
}

export interface DmThreadsBulk {
  /** ManyChat subscriber id -> full thread (ascending, latest THREAD_CAP). */
  threads: Record<string, DmMessage[]>;
  /** Subscriber ids whose thread was longer than the cap. */
  capped: string[];
}

export interface DmThread {
  subscriberId: string;
  name: string | null;
  handle: string | null;
  messages: DmMessage[];
  truncated: boolean;
}

function who(direction: unknown): "lead" | "creator" {
  return String(direction || "").toLowerCase().startsWith("in") ? "lead" : "creator";
}

function msgText(body: unknown): string {
  return String(body ?? "").slice(0, MSG_TEXT_CAP);
}

/** The cell's own people, per keyword: same table, same filters as the
 *  adsv2_window_leaves dm CTE. Distinct per (keyword, subscriber). */
async function factsFor(
  db: Db,
  clientKey: string,
  keywords: string[],
  from: string | null,
  to: string | null,
): Promise<Map<string, Map<string, { name: string | null; day: string }>>> {
  // PostgREST caps every request at 1000 rows regardless of .limit(), so a
  // big campaign scope must be PAGED, never single-shot. Null dates = the
  // keyword's whole history (the words feed's "all activity" scope).
  const PAGE = 1000;
  const all: Row[] = [];
  for (let page = 0; page < 20; page++) {
    let q = db
      .from("adsv2_dm_facts")
      .select("subscriber_id,subscriber_name,et_day,keyword_normalized")
      .eq("client_key", clientKey)
      .in("keyword_normalized", keywords)
      .eq("is_organic", false)
      .eq("awaiting_review", false);
    if (from) q = q.gte("et_day", from);
    if (to) q = q.lte("et_day", to);
    const { data, error } = await q
      .order("et_day", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data as Row[]) || [];
    all.push(...rows);
    if (rows.length < PAGE) break;
  }
  const byKw = new Map<string, Map<string, { name: string | null; day: string }>>();
  for (const kw of keywords) byKw.set(kw, new Map());
  for (const f of all) {
    const kw = String(f.keyword_normalized ?? "");
    const id = String(f.subscriber_id ?? "");
    const m = byKw.get(kw);
    if (!m || !id || m.has(id)) continue;
    m.set(id, { name: f.subscriber_name ? String(f.subscriber_name) : null, day: String(f.et_day) });
  }
  return byKw;
}

/** RPC payload shapes (single jsonb responses, so no row cap applies). */
interface RpcStat {
  count: number;
  lastAt: string;
  lastBody: string | null;
  lastDirection: string | null;
}
interface RpcThread {
  total: number;
  msgs: Array<{ d: string; b: string; a: string }> | null;
}

/** Bridge ManyChat subscriber ids to Instagram identity, batched. */
async function bridge(
  db: Db,
  dmClient: string,
  mcIds: string[],
): Promise<Record<string, { ig: string; handle: string | null; name: string | null }>> {
  const out: Record<string, { ig: string; handle: string | null; name: string | null }> = {};
  for (let i = 0; i < mcIds.length; i += 500) {
    const chunk = mcIds.slice(i, i + 500);
    const { data } = await db
      .from("instagram_lead_links")
      .select("manychat_subscriber_id,instagram_user_id,instagram_handle,lead_name")
      .eq("client", dmClient)
      .in("manychat_subscriber_id", chunk);
    for (const l of (data as Row[]) || []) {
      if (!l.instagram_user_id) continue;
      out[String(l.manychat_subscriber_id)] = {
        ig: String(l.instagram_user_id),
        handle: l.instagram_handle ? String(l.instagram_handle) : null,
        name: l.lead_name ? String(l.lead_name) : null,
      };
    }
  }
  return out;
}

export async function dmInboxGrouped(
  clientKey: string,
  keywords: string[],
  from: string,
  to: string,
): Promise<DmInboxGrouped> {
  const db = getServiceSupabase();
  const byKw = await factsFor(db, clientKey, keywords, from, to);

  const allMc = new Set<string>();
  for (const m of byKw.values()) for (const id of m.keys()) allMc.add(id);
  if (!allMc.size) return { groups: [], total: 0, withThread: 0 };

  const dmClient = DM_STORE_CLIENT[clientKey] || clientKey;
  const igByMc = await bridge(db, dmClient, [...allMc]);

  // Thread stats per Instagram id via RPC: one jsonb response, no row cap.
  const igIds = [...new Set(Object.values(igByMc).map((v) => v.ig))];
  const { data: statData, error: statErr } = await db.rpc("adsv2_dm_stats", {
    p_client: dmClient,
    p_ig_ids: igIds,
  });
  if (statErr) throw new Error(statErr.message);
  const stats = (statData || {}) as Record<string, RpcStat>;

  const groups: DmGroup[] = [];
  for (const kw of keywords) {
    const people = byKw.get(kw);
    if (!people || !people.size) continue;
    const conversations: DmConversation[] = [...people.entries()].map(([mc, fact]) => {
      const link = igByMc[mc];
      const st = link ? stats[link.ig] : undefined;
      return {
        subscriberId: mc,
        name: link?.name || fact.name,
        handle: link?.handle ?? null,
        dmEtDay: fact.day,
        hasThread: !!st,
        messageCount: st?.count ?? 0,
        lastMessageAt: st?.lastAt ?? null,
        lastFrom: st ? who(st.lastDirection) : null,
        snippet: st ? String(st.lastBody ?? "").replace(/\s+/g, " ").trim().slice(0, 140) : null,
      };
    });
    // Stored threads first (freshest conversation on top), then the not-yet-
    // captured subscribers by keyword day.
    conversations.sort((a, b) => {
      if (a.hasThread !== b.hasThread) return a.hasThread ? -1 : 1;
      if (a.hasThread) return (b.lastMessageAt || "").localeCompare(a.lastMessageAt || "");
      return b.dmEtDay.localeCompare(a.dmEtDay);
    });
    groups.push({
      keyword: kw,
      total: conversations.length,
      withThread: conversations.filter((c) => c.hasThread).length,
      conversations,
    });
  }

  return {
    groups,
    total: groups.reduce((s, g) => s + g.total, 0),
    withThread: groups.reduce((s, g) => s + g.withThread, 0),
  };
}

/** Every thread in the scope in one shot, so the panel can flip between
 *  conversations and build the words-only feed with zero further requests. */
export async function dmThreadsBulk(
  clientKey: string,
  keywords: string[],
  from: string,
  to: string,
): Promise<DmThreadsBulk> {
  const db = getServiceSupabase();
  const byKw = await factsFor(db, clientKey, keywords, from, to);
  const allMc = new Set<string>();
  for (const m of byKw.values()) for (const id of m.keys()) allMc.add(id);
  if (!allMc.size) return { threads: {}, capped: [] };

  const dmClient = DM_STORE_CLIENT[clientKey] || clientKey;
  const igByMc = await bridge(db, dmClient, [...allMc]);
  const igIds = [...new Set(Object.values(igByMc).map((v) => v.ig))];

  // One RPC: every thread, capped server-side to the latest THREAD_CAP
  // messages each, returned as a single jsonb value (no row cap).
  const { data, error } = await db.rpc("adsv2_dm_threads", {
    p_client: dmClient,
    p_ig_ids: igIds,
    p_cap: THREAD_CAP,
  });
  if (error) throw new Error(error.message);
  const byIg = (data || {}) as Record<string, RpcThread>;

  const threads: Record<string, DmMessage[]> = {};
  const capped: string[] = [];
  for (const mc of allMc) {
    const link = igByMc[mc];
    if (!link) continue;
    const t = byIg[link.ig];
    if (!t || !t.msgs || !t.msgs.length) continue;
    threads[mc] = t.msgs.map((m) => ({ who: who(m.d), text: msgText(m.b), at: m.a }));
    if (t.total > t.msgs.length) capped.push(mc);
  }
  return { threads, capped };
}

export interface DmFeedItem {
  subscriberId: string;
  name: string | null;
  handle: string | null;
  text: string;
  at: string;
}

export interface DmWordsFeed {
  scope: "window" | "all";
  items: DmFeedItem[];
  /** Messages dropped because the person had already become a client. */
  buyersTrimmed: number;
  truncated: boolean;
}

const FEED_CAP = 3000;

/** The ET calendar day of a timestamp, DST-proof. */
function etDayOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

/**
 * The words-only feed: every message LEADS typed inside the window, newest
 * first. scope 'window' = only people whose keyword DM started inside the
 * window (matches the inbox cohort); scope 'all' = anyone these keywords
 * ever pulled in who typed inside the window. Messages sent on or after the
 * day a person became a client are trimmed, so the feed stays lead talk.
 */
export async function dmWordsFeed(
  clientKey: string,
  keywords: string[],
  from: string,
  to: string,
  scope: "window" | "all",
): Promise<DmWordsFeed> {
  const db = getServiceSupabase();
  const byKw = await factsFor(db, clientKey, keywords, scope === "window" ? from : null, scope === "window" ? to : null);
  const nameByMc = new Map<string, string | null>();
  for (const m of byKw.values())
    for (const [id, fact] of m.entries()) if (!nameByMc.has(id)) nameByMc.set(id, fact.name);
  const mcIds = [...nameByMc.keys()];
  if (!mcIds.length) return { scope, items: [], buyersTrimmed: 0, truncated: false };

  const dmClient = DM_STORE_CLIENT[clientKey] || clientKey;
  const igByMc = await bridge(db, dmClient, mcIds);
  const igIds = [...new Set(Object.values(igByMc).map((v) => v.ig))];
  const { data, error } = await db.rpc("adsv2_dm_threads", {
    p_client: dmClient,
    p_ig_ids: igIds,
    p_cap: THREAD_CAP,
  });
  if (error) throw new Error(error.message);
  const byIg = (data || {}) as Record<string, RpcThread>;

  // First-win day per subscriber: messages from that day on are client talk.
  const winDayByMc = new Map<string, string>();
  {
    const PAGE = 1000;
    for (let page = 0; page < 5; page++) {
      const { data: wins } = await db
        .from("adsv2_sale_facts")
        .select("subscriber_id,sale_et_day")
        .eq("client_key", clientKey)
        .eq("is_win", true)
        .not("subscriber_id", "is", null)
        .order("sale_et_day", { ascending: true })
        .range(page * PAGE, page * PAGE + PAGE - 1);
      const rows = (wins as Row[]) || [];
      for (const w of rows) {
        const id = String(w.subscriber_id);
        if (!winDayByMc.has(id)) winDayByMc.set(id, String(w.sale_et_day));
      }
      if (rows.length < PAGE) break;
    }
  }

  const items: DmFeedItem[] = [];
  let buyersTrimmed = 0;
  for (const mc of mcIds) {
    const link = igByMc[mc];
    if (!link) continue;
    const t = byIg[link.ig];
    if (!t?.msgs) continue;
    const winDay = winDayByMc.get(mc);
    for (const m of t.msgs) {
      if (!String(m.d || "").toLowerCase().startsWith("in")) continue; // leads only
      const text = String(m.b ?? "").trim();
      if (!text) continue;
      const day = etDayOf(m.a);
      if (day < from || day > to) continue;
      if (winDay && day >= winDay) {
        buyersTrimmed++;
        continue;
      }
      items.push({
        subscriberId: mc,
        name: link.name || nameByMc.get(mc) || null,
        handle: link.handle,
        text: text.slice(0, MSG_TEXT_CAP),
        at: m.a,
      });
    }
  }
  items.sort((a, b) => b.at.localeCompare(a.at));
  const truncated = items.length > FEED_CAP;
  return { scope, items: items.slice(0, FEED_CAP), buyersTrimmed, truncated };
}

export async function dmThread(clientKey: string, subscriberId: string): Promise<DmThread | null> {
  const db = getServiceSupabase();
  const dmClient = DM_STORE_CLIENT[clientKey] || clientKey;
  const igByMc = await bridge(db, dmClient, [subscriberId]);
  const link = igByMc[subscriberId];
  if (!link) return null;
  const { data, error } = await db.rpc("adsv2_dm_threads", {
    p_client: dmClient,
    p_ig_ids: [link.ig],
    p_cap: SINGLE_THREAD_CAP,
  });
  if (error) throw new Error(error.message);
  const t = ((data || {}) as Record<string, RpcThread>)[link.ig];
  if (!t || !t.msgs) return null;
  return {
    subscriberId,
    name: link.name,
    handle: link.handle,
    truncated: t.total > t.msgs.length,
    messages: t.msgs.map((m) => ({ who: who(m.d), text: msgText(m.b), at: m.a })),
  };
}
