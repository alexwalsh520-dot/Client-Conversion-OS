// Buyer DNA — shared helpers. Assemble everything we know about ONE buyer from the data we
// already store: their sales call transcript (name-matched), their DM thread (ManyChat id bridged
// to the IG id), and the ad + on-image ad copy that brought them in. No money math here; the point
// is content research, not attribution. Be honest about gaps (see data_completeness on each dossier).

import type { SupabaseClient } from "@supabase/supabase-js";

// offer label in sales_tracker_rows (e.g. "Tyson Sonnek") contains this
const OFFER_MATCH: Record<string, string> = { tyson: "tyson", antwan: "antwan" };

export function normName(s: string | null | undefined): string {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type QualifiedBuyer = {
  personKey: string;
  name: string;
  nn: string; // normalized name
  subscriberId: string | null;
  amountCents: number;
  closer: string | null;
  setter: string | null;
  closeDate: string | null;
  objection: string | null;
  callNotes: string | null;
};

// Buyers who paid >= threshold for this creator, one row per person (deduped, max amount kept).
export async function listQualifiedBuyers(
  sb: SupabaseClient,
  client: string,
  thresholdCents: number,
): Promise<QualifiedBuyer[]> {
  const { data } = await sb
    .from("sales_tracker_rows")
    .select(
      "prospect_name, prospect_name_normalized, collected_revenue_cents, contracted_revenue_cents, manychat_subscriber_id, offer, date, closer, setter, objection, call_notes",
    )
    .ilike("offer", `%${OFFER_MATCH[client] || client}%`);

  const byKey = new Map<string, QualifiedBuyer>();
  for (const r of (data || []) as Record<string, unknown>[]) {
    const amt = Math.max(Number(r.collected_revenue_cents) || 0, Number(r.contracted_revenue_cents) || 0);
    if (amt < thresholdCents) continue;
    const nn = normName((r.prospect_name_normalized as string) || (r.prospect_name as string));
    const sub = r.manychat_subscriber_id ? String(r.manychat_subscriber_id) : null;
    // need either a hard subscriber id or a real multi-token name to research + match
    if (!sub && nn.split(" ").length < 2) continue;
    const personKey = sub ? `sub:${sub}` : `name:${nn}`;
    const prev = byKey.get(personKey);
    if (prev && prev.amountCents >= amt) continue;
    byKey.set(personKey, {
      personKey,
      name: String(r.prospect_name || nn).trim(),
      nn,
      subscriberId: sub,
      amountCents: amt,
      closer: (r.closer as string) || null,
      setter: (r.setter as string) || null,
      closeDate: (r.date as string) || null,
      objection: (r.objection as string) || null,
      callNotes: (r.call_notes as string) || null,
    });
  }
  return [...byKey.values()];
}

export type BuyerData = {
  callTranscript: string | null;
  callTitle: string | null;
  dmText: string | null;
  dmCount: number;
  firstKeyword: string | null;
  adId: string | null;
  adName: string | null;
  adOnImage: string | null;
  adPrimary: string | null;
  completeness: { has_call: boolean; has_dms: boolean; dm_count: number; has_ad: boolean; link_confidence: "id" | "name" };
};

// Pull the call transcript (name match), the entry keyword + the ad it maps to + the on-image copy,
// and the full DM thread (bridge ManyChat subscriber -> IG user id) for one buyer.
export async function gatherBuyerData(
  sb: SupabaseClient,
  client: string,
  buyer: QualifiedBuyer,
): Promise<BuyerData> {
  // 1. Sales call transcript — Fathom links by name only, so match on normalized prospect_name.
  let callTranscript: string | null = null;
  let callTitle: string | null = null;
  {
    const { data: calls } = await sb
      .from("fathom_calls")
      .select("prospect_name, transcript, title")
      .eq("client_key", client)
      .not("transcript", "is", null)
      .order("recorded_at", { ascending: false })
      .limit(500);
    const match = (calls || []).find((c) => normName((c as { prospect_name: string }).prospect_name) === buyer.nn);
    if (match) {
      callTranscript = (match as { transcript: string }).transcript || null;
      callTitle = (match as { title: string }).title || null;
    }
  }

  // 2. Entry keyword — prefer the buyer's first dm_keyword event, else person_context.first_keyword.
  let firstKeyword: string | null = null;
  if (buyer.subscriberId) {
    const { data: kw } = await sb
      .from("ads_keyword_events")
      .select("keyword_normalized, event_at")
      .eq("client_key", client)
      .eq("subscriber_id", buyer.subscriberId)
      .eq("event_type", "dm_keyword")
      .order("event_at", { ascending: true })
      .limit(1);
    if (kw && kw[0]) firstKeyword = (kw[0] as { keyword_normalized: string }).keyword_normalized || null;
  }
  if (!firstKeyword) {
    const q = sb.from("person_context").select("first_keyword").eq("client_key", client).limit(1);
    const { data: pc } = buyer.subscriberId
      ? await q.contains("subscriber_ids", [buyer.subscriberId])
      : await q.eq("person_key", buyer.personKey);
    if (pc && pc[0]) firstKeyword = (pc[0] as { first_keyword: string }).first_keyword || null;
  }

  // 3. Ad + on-image copy from the keyword.
  let adId: string | null = null;
  let adName: string | null = null;
  let adOnImage: string | null = null;
  let adPrimary: string | null = null;
  if (firstKeyword) {
    const { data: ins } = await sb
      .from("ads_meta_insights_daily")
      .select("ad_id, ad_name")
      .eq("client_key", client)
      .eq("keyword_normalized", firstKeyword)
      .not("ad_id", "is", null)
      .limit(1);
    if (ins && ins[0]) {
      adId = (ins[0] as { ad_id: string }).ad_id || null;
      adName = (ins[0] as { ad_name: string }).ad_name || null;
    }
    if (adId) {
      const { data: cc } = await sb
        .from("ad_creative_copy")
        .select("on_image_text, primary_text")
        .eq("ad_id", adId)
        .limit(1);
      if (cc && cc[0]) {
        adOnImage = (cc[0] as { on_image_text: string }).on_image_text || null;
        adPrimary = (cc[0] as { primary_text: string }).primary_text || null;
      }
    }
  }

  // 4. DM thread — subscriber_id in dm_conversation_messages is the IG id, bridge via instagram_lead_links.
  let dmText: string | null = null;
  let dmCount = 0;
  if (buyer.subscriberId) {
    const { data: link } = await sb
      .from("instagram_lead_links")
      .select("instagram_user_id")
      .eq("manychat_subscriber_id", buyer.subscriberId)
      .limit(1);
    const igId = link && link[0] ? (link[0] as { instagram_user_id: string }).instagram_user_id : null;
    if (igId) {
      const { data: msgs } = await sb
        .from("dm_conversation_messages")
        .select("direction, body, sent_at")
        .eq("subscriber_id", igId)
        .order("sent_at", { ascending: true })
        .limit(400);
      const lines = (msgs || [])
        .map((m) => {
          const who = (m as { direction: string }).direction === "in" ? "THEM" : "US";
          const body = String((m as { body: string }).body || "").trim();
          return body ? `${who}: ${body}` : "";
        })
        .filter(Boolean);
      dmCount = lines.length;
      if (lines.length) dmText = lines.join("\n").slice(0, 24000);
    }
  }

  return {
    callTranscript,
    callTitle,
    dmText,
    dmCount,
    firstKeyword,
    adId,
    adName,
    adOnImage,
    adPrimary,
    completeness: {
      has_call: !!callTranscript,
      has_dms: dmCount > 0,
      dm_count: dmCount,
      has_ad: !!adId,
      link_confidence: buyer.subscriberId ? "id" : "name",
    },
  };
}
