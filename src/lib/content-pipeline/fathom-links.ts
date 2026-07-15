// Hard-key linkage from a Fathom call to a sale (and thus its subscriber + ad keyword). The ONLY keys
// used are EXACT string matches: the Fathom share token (fathom_calls.raw.share_url) equals the token a
// closer pasted into sales_tracker_rows.recording_link, or the numeric recording id. NO name matching,
// NO fuzzy matching, ever. A call with no exact key stays unlinked. Populates fathom_call_links.
import { getServiceSupabase } from "@/lib/supabase";

type Sb = ReturnType<typeof getServiceSupabase>;
type Row = Record<string, unknown>;

// Extract the durable identifier from a Fathom URL: the /share/<token> or the /calls/<recording_id>.
export function fathomUrlKey(url: string | null | undefined): { kind: "share" | "call"; value: string } | null {
  const u = String(url || "");
  const share = u.match(/fathom\.video\/share\/([A-Za-z0-9_-]+)/);
  if (share) return { kind: "share", value: share[1] };
  const call = u.match(/fathom\.video\/calls\/(\d+)/);
  if (call) return { kind: "call", value: call[1] };
  return null;
}

// Duration in seconds from the raw recording window. The Fathom API has no duration field, but it does
// carry recording_start_time / recording_end_time, so we derive it at ingest. Null when unavailable.
export function fathomDurationSec(recStart: unknown, recEnd: unknown): number | null {
  if (!recStart || !recEnd) return null;
  const d = Math.round((new Date(String(recEnd)).getTime() - new Date(String(recStart)).getTime()) / 1000);
  return Number.isFinite(d) && d > 0 ? d : null;
}

export async function linkFathomCalls(sb: Sb): Promise<{ linked: number; calls: number; sales_with_link: number; method_counts: Record<string, number> }> {
  const { data: calls } = await sb.from("fathom_calls").select("fathom_id,client_key,prospect_name,recorded_at,share_url:raw->>share_url,call_url:raw->>url");
  const byShare: Record<string, Row> = {};
  const byCall: Record<string, Row> = {};
  for (const c of (calls as Row[]) || []) {
    const st = fathomUrlKey(c.share_url as string);
    if (st?.kind === "share") byShare[st.value] = c;
    if (c.fathom_id) byCall[String(c.fathom_id)] = c; // fathom_id IS the recording id
    const cu = fathomUrlKey(c.call_url as string);
    if (cu?.kind === "call") byCall[cu.value] = c;
  }

  const { data: sales } = await sb.from("sales_tracker_rows")
    .select("recording_link,date,prospect_name,manychat_subscriber_id,offer")
    .ilike("recording_link", "%fathom%");

  // Enrich with the sale's ad keyword from the canonical facts (by name|day), so a linked call can
  // report which ad it traces to. Facts lookup is a hard-derived attribution, not a name guess for linkage.
  const { data: facts } = await sb.from("sale_attribution_facts").select("occurred_day,prospect_name,keyword_normalized,method");
  const kwByKey: Record<string, string> = {};
  const rank = (m: string) => (m === "link_dm" ? 3 : m === "link_booking" ? 2 : m === "name" ? 1 : 0);
  const rankSeen: Record<string, number> = {};
  for (const f of (facts as Row[]) || []) {
    const key = `${String(f.prospect_name || "").toLowerCase().trim()}|${String(f.occurred_day || "").slice(0, 10)}`;
    if (kwByKey[key] === undefined || rank(String(f.method || "")) > (rankSeen[key] || 0)) {
      kwByKey[key] = String(f.keyword_normalized || "");
      rankSeen[key] = rank(String(f.method || ""));
    }
  }

  const rows: Row[] = [];
  const seen = new Set<string>();
  const method_counts: Record<string, number> = {};
  let salesWithLink = 0;
  for (const s of (sales as Row[]) || []) {
    salesWithLink++;
    const tok = fathomUrlKey(s.recording_link as string);
    if (!tok) continue;
    const call = tok.kind === "share" ? byShare[tok.value] : byCall[tok.value];
    if (!call) continue;
    const fid = String(call.fathom_id);
    if (seen.has(fid)) continue; // one link per call (first exact match wins)
    seen.add(fid);
    const nameKey = `${String(s.prospect_name || "").toLowerCase().trim()}|${String(s.date || "").slice(0, 10)}`;
    const method = tok.kind === "share" ? "recording_share_url" : "recording_id";
    method_counts[method] = (method_counts[method] || 0) + 1;
    rows.push({
      fathom_id: fid,
      client_key: (call.client_key as string) ?? null,
      sale_date: s.date ?? null,
      prospect_name: s.prospect_name ?? null,
      subscriber_id: s.manychat_subscriber_id ?? null,
      keyword_normalized: kwByKey[nameKey] || null,
      linkage_method: method,
      matched_value: tok.value,
      linked_at: new Date().toISOString(),
    });
  }
  if (rows.length) await sb.from("fathom_call_links").upsert(rows, { onConflict: "fathom_id" });
  return { linked: rows.length, calls: (calls as Row[] | null)?.length || 0, sales_with_link: salesWithLink, method_counts };
}
