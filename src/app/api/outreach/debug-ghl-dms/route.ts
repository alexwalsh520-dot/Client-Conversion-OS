import { NextResponse } from "next/server";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export const maxDuration = 60;

interface SearchResponse {
  conversations?: Array<Record<string, unknown>>;
  total?: number;
  error?: string;
}

async function ghlGet(path: string) {
  const apiKey = process.env.GHL_API_KEY;
  const res = await fetch(`${GHL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Version: GHL_VERSION,
      "Content-Type": "application/json",
    },
  });
  const text = await res.text();
  let body: unknown = null;
  try { body = JSON.parse(text); } catch { body = text.slice(0, 600); }
  return { status: res.status, body };
}

export async function GET() {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) {
    return NextResponse.json({ error: "GHL_LOCATION_ID missing" }, { status: 500 });
  }

  const results: Record<string, unknown> = { locationId };

  const attempts = [
    `/conversations/search?locationId=${locationId}&limit=5`,
    `/conversations/search?locationId=${locationId}&lastMessageType=TYPE_INSTAGRAM&limit=5`,
    `/conversations/search?locationId=${locationId}&lastMessageType=TYPE_INSTAGRAM_DM&limit=5`,
    `/conversations/search?locationId=${locationId}&type=TYPE_INSTAGRAM&limit=5`,
    `/conversations/search?locationId=${locationId}&channel=instagram&limit=5`,
  ];

  for (const path of attempts) {
    const r = await ghlGet(path);
    const body = r.body as SearchResponse | null;
    results[path] = {
      status: r.status,
      total: body && typeof body === "object" ? body.total : null,
      count: body && typeof body === "object" && Array.isArray(body.conversations)
        ? body.conversations.length : null,
      sample: body && typeof body === "object" && Array.isArray(body.conversations) && body.conversations.length > 0
        ? Object.keys(body.conversations[0])
        : body,
      firstConversation: body && typeof body === "object" && Array.isArray(body.conversations)
        ? body.conversations[0] : null,
    };
  }

  return NextResponse.json(results, { status: 200 });
}
