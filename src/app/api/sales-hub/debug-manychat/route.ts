import { NextResponse } from "next/server";

// Temporary debug endpoint for Manychat API
const MANYCHAT_BASE = "https://api.manychat.com/fb";

export async function GET() {
  const results: Record<string, unknown> = {};

  const tysonKey = process.env.MANYCHAT_API_KEY_TYSON;
  results.tyson_key_set = !!tysonKey;
  results.tyson_key_prefix = tysonKey ? tysonKey.substring(0, 10) + "..." : "NOT SET";

  if (!tysonKey) {
    return NextResponse.json({ error: "MANYCHAT_API_KEY_TYSON not set", results });
  }

  const headers = {
    Authorization: `Bearer ${tysonKey}`,
    Accept: "application/json",
  };

  // 1. Get tags
  try {
    const res = await fetch(`${MANYCHAT_BASE}/page/getTags`, { headers });
    const text = await res.text();
    results.tags_status = res.status;
    try {
      const parsed = JSON.parse(text);
      const tags = parsed.data || [];
      results.tags_count = tags.length;
      results.tags = tags.map((t: { id: number; name: string }) => ({ id: t.id, name: t.name }));
    } catch {
      results.tags_raw = text.substring(0, 500);
    }
  } catch (err) {
    results.tags_error = String(err);
  }

  // 2. Try getSubscribers with has_tag_id for the first metric tag found
  const metricTagNames = ["new_lead", "lead_engaged", "call_link_sent", "sub_link_sent"];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tags = (results.tags as any[]) || [];

  for (const tagName of metricTagNames) {
    const tag = tags.find((t: { name: string }) => t.name.toLowerCase() === tagName);
    if (!tag) {
      results[`${tagName}_tag`] = "NOT FOUND in tags list";
      continue;
    }

    results[`${tagName}_tag`] = { id: tag.id, name: tag.name };

    // Try the primary endpoint
    try {
      const url = `${MANYCHAT_BASE}/subscriber/getSubscribers?has_tag_id=${tag.id}&limit=5`;
      const res = await fetch(url, { headers });
      const text = await res.text();
      results[`${tagName}_primary_status`] = res.status;
      try {
        const parsed = JSON.parse(text);
        results[`${tagName}_primary`] = {
          status: parsed.status,
          total: parsed.data?.subscribers?.length || parsed.data?.length || 0,
          sample: (parsed.data?.subscribers || parsed.data || []).slice(0, 2).map((s: { id: string; name: string; first_name: string; subscribed: string }) => ({
            id: s.id, name: s.name || s.first_name, subscribed: s.subscribed,
          })),
        };
      } catch {
        results[`${tagName}_primary_raw`] = text.substring(0, 300);
      }
    } catch (err) {
      results[`${tagName}_primary_error`] = String(err);
    }

    // Try findByTag endpoint
    try {
      const url = `${MANYCHAT_BASE}/subscriber/findByTag?tag_id=${tag.id}&limit=5`;
      const res = await fetch(url, { headers });
      const text = await res.text();
      results[`${tagName}_findByTag_status`] = res.status;
      try { results[`${tagName}_findByTag`] = JSON.parse(text); } catch { results[`${tagName}_findByTag_raw`] = text.substring(0, 300); }
    } catch (err) {
      results[`${tagName}_findByTag_error`] = String(err);
    }

    // Only test first tag found to keep response manageable
    break;
  }

  // 3. Try page/getSubscribers to see total subscriber count
  try {
    const res = await fetch(`${MANYCHAT_BASE}/page/getSubscribers?limit=5`, { headers });
    const text = await res.text();
    results.page_subscribers_status = res.status;
    try {
      const parsed = JSON.parse(text);
      results.page_subscribers = {
        status: parsed.status,
        total: parsed.data?.subscribers?.length || parsed.data?.length || 0,
      };
    } catch {
      results.page_subscribers_raw = text.substring(0, 300);
    }
  } catch (err) {
    results.page_subscribers_error = String(err);
  }

  return NextResponse.json(results);
}
