// ─────────────────────────────────────────────────────────────────────────
// DM INBOX — the conversations behind one keyword's "Messages" number.
//
// The list is driven by adsv2_dm_facts with EXACTLY the filters the window
// RPC uses to count the Messages cell (not organic, not awaiting review,
// et_day inside the window), so the people listed always reconcile with the
// number that was clicked. Threads then resolve in two hops, the same live
// derivation the door's get_dms_for_ad uses:
//   ManyChat subscriber -> instagram_lead_links -> dm_conversation_messages
// Some subscribers have no stored thread yet (the DM webhook captures recent
// threads); those rows are still listed, marked "no stored messages", never
// silently dropped.
// ─────────────────────────────────────────────────────────────────────────

import { getServiceSupabase } from "@/lib/supabase";

type Row = Record<string, unknown>;

/** client_key -> the client id dm_conversation_messages / instagram_lead_links
 *  are stored under (the creator's DM handle id). */
const DM_STORE_CLIENT: Record<string, string> = {
  tyson: "tyson_sonnek",
  jake: "jake_divljak",
};

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

export interface DmInboxList {
  total: number; // equals the Messages cell for the same window
  withThread: number;
  conversations: DmConversation[];
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

/** Bridge ManyChat subscriber ids to Instagram identity, batched. */
async function bridge(
  db: ReturnType<typeof getServiceSupabase>,
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

export async function dmInboxList(
  clientKey: string,
  keyword: string,
  from: string,
  to: string,
): Promise<DmInboxList> {
  const db = getServiceSupabase();
  const kw = keyword.toLowerCase();

  // 1. The cell's own people: same table, same filters as adsv2_window_leaves.
  const { data: facts, error } = await db
    .from("adsv2_dm_facts")
    .select("subscriber_id,subscriber_name,et_day")
    .eq("client_key", clientKey)
    .eq("keyword_normalized", kw)
    .gte("et_day", from)
    .lte("et_day", to)
    .eq("is_organic", false)
    .eq("awaiting_review", false)
    .order("et_day", { ascending: false })
    .limit(6000);
  if (error) throw new Error(error.message);

  const byMc = new Map<string, { name: string | null; day: string }>();
  for (const f of (facts as Row[]) || []) {
    const id = String(f.subscriber_id ?? "");
    if (!id || byMc.has(id)) continue;
    byMc.set(id, {
      name: f.subscriber_name ? String(f.subscriber_name) : null,
      day: String(f.et_day),
    });
  }
  const mcIds = [...byMc.keys()];
  if (!mcIds.length) return { total: 0, withThread: 0, conversations: [] };

  // 2. Bridge to Instagram identity.
  const dmClient = DM_STORE_CLIENT[clientKey] || clientKey;
  const igByMc = await bridge(db, dmClient, mcIds);

  // 3. Thread stats per Instagram id: count + the latest message. Newest-first
  //    so the first row seen per thread IS its latest message.
  const igIds = [...new Set(Object.values(igByMc).map((v) => v.ig))];
  const stats: Record<string, { count: number; lastAt: string; lastBody: string; lastFrom: "lead" | "creator" }> = {};
  for (let i = 0; i < igIds.length; i += 200) {
    const chunk = igIds.slice(i, i + 200);
    const { data: msgs } = await db
      .from("dm_conversation_messages")
      .select("subscriber_id,direction,body,sent_at")
      .eq("client", dmClient)
      .in("subscriber_id", chunk)
      .order("sent_at", { ascending: false })
      .limit(20000);
    for (const m of (msgs as Row[]) || []) {
      const ig = String(m.subscriber_id);
      const s = stats[ig];
      if (s) s.count += 1;
      else
        stats[ig] = {
          count: 1,
          lastAt: String(m.sent_at),
          lastBody: String(m.body ?? ""),
          lastFrom: who(m.direction),
        };
    }
  }

  const conversations: DmConversation[] = mcIds.map((mc) => {
    const fact = byMc.get(mc)!;
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
      lastFrom: st?.lastFrom ?? null,
      snippet: st ? st.lastBody.replace(/\s+/g, " ").trim().slice(0, 140) : null,
    };
  });

  // Stored threads first (freshest conversation on top), then the not-yet-
  // captured subscribers by keyword day.
  conversations.sort((a, b) => {
    if (a.hasThread !== b.hasThread) return a.hasThread ? -1 : 1;
    if (a.hasThread) return (b.lastMessageAt || "").localeCompare(a.lastMessageAt || "");
    return b.dmEtDay.localeCompare(a.dmEtDay);
  });

  return {
    total: conversations.length,
    withThread: conversations.filter((c) => c.hasThread).length,
    conversations,
  };
}

const THREAD_CAP = 800;

export async function dmThread(clientKey: string, subscriberId: string): Promise<DmThread | null> {
  const db = getServiceSupabase();
  const dmClient = DM_STORE_CLIENT[clientKey] || clientKey;
  const igByMc = await bridge(db, dmClient, [subscriberId]);
  const link = igByMc[subscriberId];
  if (!link) return null;
  const { data: msgs } = await db
    .from("dm_conversation_messages")
    .select("direction,body,sent_at")
    .eq("client", dmClient)
    .eq("subscriber_id", link.ig)
    .order("sent_at", { ascending: true })
    .limit(THREAD_CAP + 1);
  const rows = (msgs as Row[]) || [];
  return {
    subscriberId,
    name: link.name,
    handle: link.handle,
    truncated: rows.length > THREAD_CAP,
    messages: rows.slice(0, THREAD_CAP).map((m) => ({
      who: who(m.direction),
      text: String(m.body ?? ""),
      at: String(m.sent_at),
    })),
  };
}
