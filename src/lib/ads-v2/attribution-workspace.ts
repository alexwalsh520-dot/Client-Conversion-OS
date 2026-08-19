// ─────────────────────────────────────────────────────────────────────────
// ATTRIBUTION WORKSPACE — shared server logic for the human review queue.
//
// The queue is the door's resolution_queue (every WIN still awaiting review),
// and a decision is ONE row in warehouse.adsv2_sale_resolutions: keyword set
// means "this ad earned it", keyword NULL means "I looked, not an ad sale".
// Those rows are the HUMAN channel by definition: the sync labeler
// (adsv2_label_sale_origins) applies them to the facts with
// evidence_key 'human_resolution' and the decider's name, so the warehouse
// always shows WHO decided — a person, never the app's matching code.
//
// Used by BOTH the authed route (/api/ads-v2/attribution) and the public
// share-link route (/api/public/attribution/[token]). The only difference
// between the two is where resolved_by comes from.
// ─────────────────────────────────────────────────────────────────────────
import { getServiceSupabase } from "@/lib/supabase";
import { normalizeKeyword } from "@/lib/ads-v2/keyword";
import { ADSV2_SERVED_CLIENTS } from "@/lib/ads-v2/config";

type Db = ReturnType<typeof getServiceSupabase>;

export interface WorkspaceRow {
  saleKey: string;
  day: string;
  prospect: string | null;
  clientKey: string | null;
  cashUsdCents: number;
  callType: string | null;
  setter: string | null;
  closer: string | null;
  manychatLink: string | null;
  hasKeywordEvents: boolean;
}

export interface WorkspacePayload {
  queue: WorkspaceRow[];
  zeroCash: WorkspaceRow[];
  /** Decisions already saved but not yet applied to the numbers. */
  pendingCount: number;
  keywords: { clientKey: string; keyword: string }[];
}

interface QueueRpcRow {
  sale_key: string;
  sale_et_day: string;
  prospect_name: string | null;
  client_key: string | null;
  collected_usd_cents: number | null;
  call_type: string | null;
  setter_name: string | null;
  closer: string | null;
  subscriber_id: string | null;
  manychat_link: string | null;
  blank_reason: string | null;
  has_keyword_events: boolean | null;
}

export async function readWorkspace(db: Db): Promise<WorkspacePayload> {
  const [queueRes, resolvedRes, kwRes] = await Promise.all([
    db.rpc("door_resolution_queue", { p_limit: 300 }),
    db.schema("warehouse").from("adsv2_sale_resolutions").select("sale_key"),
    db.rpc("attribution_keyword_options"),
  ]);
  if (queueRes.error) throw new Error(`queue read failed: ${queueRes.error.message}`);

  // A saved decision leaves the fact table on the next labeler run; until
  // then its queue row would still show. Hide it — the human already decided.
  const decided = new Set(
    ((resolvedRes.data || []) as { sale_key: string }[]).map((r) => r.sale_key),
  );

  const rows = ((queueRes.data || []) as QueueRpcRow[])
    .filter((r) => !decided.has(r.sale_key))
    .map(
      (r): WorkspaceRow => ({
        saleKey: r.sale_key,
        day: r.sale_et_day,
        prospect: r.prospect_name,
        clientKey: r.client_key,
        cashUsdCents: Number(r.collected_usd_cents) || 0,
        callType: r.call_type,
        setter: r.setter_name,
        closer: r.closer,
        manychatLink: r.manychat_link,
        hasKeywordEvents: r.has_keyword_events === true,
      }),
    );

  const keywords = ((kwRes.data || []) as { client_key: string; keyword_normalized: string }[]).map(
    (k) => ({ clientKey: k.client_key, keyword: k.keyword_normalized }),
  );

  return {
    queue: rows.filter((r) => r.cashUsdCents > 0),
    zeroCash: rows.filter((r) => r.cashUsdCents === 0),
    pendingCount: ((queueRes.data || []) as QueueRpcRow[]).filter((r) => decided.has(r.sale_key))
      .length,
    keywords,
  };
}

export interface SaveInput {
  saleKey: string;
  day: string;
  /** Keyword the human chose; null/absent with notAd=true means "not an ad sale". */
  keyword?: string | null;
  notAd?: boolean;
  clientKey?: string | null;
  note?: string | null;
  /** Full resolved_by string, built by the caller from the human's identity. */
  resolvedBy: string;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function saveResolution(
  db: Db,
  input: SaveInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const saleKey = (input.saleKey || "").trim();
  if (!saleKey || saleKey.length > 200) return { ok: false, error: "Missing sale key" };
  if (!ISO_DAY.test(input.day || "")) return { ok: false, error: "Missing sale day" };
  const resolvedBy = (input.resolvedBy || "").trim();
  if (!resolvedBy) return { ok: false, error: "Missing who decided" };

  let keyword: string | null = null;
  if (!input.notAd) {
    keyword = normalizeKeyword(input.keyword || "") || null;
    if (!keyword) return { ok: false, error: "Pick a keyword or mark it not an ad" };
  }

  // The client the resolution credits. A keyword decides it (keywords are
  // unique across clients); otherwise the row's own creator; otherwise the
  // 'unknown' sentinel served views already exclude.
  let clientKey = (input.clientKey || "").trim() || null;
  if (keyword) {
    const { data } = await db.rpc("attribution_keyword_options");
    const match = ((data || []) as { client_key: string; keyword_normalized: string }[]).find(
      (k) => k.keyword_normalized === keyword,
    );
    if (match) clientKey = match.client_key;
  }
  if (!clientKey) clientKey = "unknown";

  const note = (input.note || "").trim().slice(0, 500) || null;

  const { error } = await db
    .schema("warehouse")
    .from("adsv2_sale_resolutions")
    .upsert(
      {
        sale_key: saleKey,
        client_key: clientKey,
        keyword_normalized: keyword,
        resolved_by: resolvedBy,
        note,
      },
      { onConflict: "sale_key" },
    );
  if (error) return { ok: false, error: `Save failed: ${error.message}` };

  // Apply it to the facts right away (same call the hourly sync makes, scoped
  // to this sale's day). Failure is fine — the next sync applies it anyway.
  try {
    await db.rpc("adsv2_label_sale_origins", {
      p_from: input.day,
      p_to: input.day,
      p_active_clients: [...ADSV2_SERVED_CLIENTS],
    });
  } catch {
    /* the hourly sync is the safety net */
  }

  return { ok: true };
}

/** Resolve an attribution share token to its link row, or null. */
export async function resolveAttributionToken(db: Db, rawToken: string): Promise<boolean> {
  let token = rawToken;
  try {
    token = decodeURIComponent(rawToken);
  } catch {
    /* keep the raw value */
  }
  if (!token || token.length > 200) return false;
  const { data, error } = await db
    .from("public_share_links")
    .select("kind, revoked")
    .eq("token", token)
    .maybeSingle();
  if (error || !data) return false;
  return data.kind === "attribution" && !data.revoked;
}
