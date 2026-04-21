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

  const nowMs = Date.now();
  const tenDaysAgo = nowMs - 10 * 24 * 60 * 60 * 1000;

  const attempts = [
    `/conversations/search?locationId=${locationId}&lastMessageType=TYPE_INSTAGRAM&limit=2&sortBy=last_message_date&sort=desc`,
    `/conversations/search?locationId=${locationId}&lastMessageType=TYPE_INSTAGRAM&limit=2&startAfterDate=${tenDaysAgo}`,
  ];

  for (const path of attempts) {
    const r = await ghlGet(path);
    const body = r.body as SearchResponse | null;
    results[path] = {
      status: r.status,
      total: body && typeof body === "object" ? body.total : null,
      count: body && typeof body === "object" && Array.isArray(body.conversations)
        ? body.conversations.length : null,
      firstConversation: body && typeof body === "object" && Array.isArray(body.conversations)
        ? body.conversations[0] : null,
    };
  }

  const firstSearch = await ghlGet(
    `/conversations/search?locationId=${locationId}&lastMessageType=TYPE_INSTAGRAM&limit=10`,
  );
  const firstBodyPeek = firstSearch.body as SearchResponse | null;
  const convList = firstBodyPeek && Array.isArray(firstBodyPeek.conversations)
    ? firstBodyPeek.conversations
    : [];

  const samples: Array<Record<string, unknown>> = [];
  for (const conv of convList.slice(0, 6)) {
    const convId = (conv as { id?: string }).id;
    if (!convId) continue;
    const msgR = await ghlGet(`/conversations/${convId}/messages`);
    const b = msgR.body;
    const messagesObj = (b as Record<string, unknown>)?.messages;
    const list = Array.isArray(messagesObj)
      ? messagesObj
      : Array.isArray((messagesObj as Record<string, unknown>)?.messages)
        ? (messagesObj as Record<string, unknown>).messages
        : [];
    const arr = Array.isArray(list) ? (list as Array<Record<string, unknown>>) : [];
    const firstOutbound = arr.find((m) => m.direction === "outbound");
    const firstInbound = arr.find((m) => m.direction === "inbound");
    samples.push({
      conversationId: convId,
      contactName: (conv as { contactName?: string }).contactName,
      contactId: (conv as { contactId?: string }).contactId,
      msgCount: arr.length,
      outbound: firstOutbound ? {
        from: firstOutbound.from,
        to: firstOutbound.to,
        meta: firstOutbound.meta,
        userId: firstOutbound.userId,
        body: typeof firstOutbound.body === "string" ? firstOutbound.body.slice(0, 80) : firstOutbound.body,
      } : null,
      inbound: firstInbound ? {
        from: firstInbound.from,
        to: firstInbound.to,
        meta: firstInbound.meta,
        body: typeof firstInbound.body === "string" ? firstInbound.body.slice(0, 80) : firstInbound.body,
      } : null,
    });
  }
  results.handleSamples = samples;

  const firstConvId = firstBodyPeek && Array.isArray(firstBodyPeek.conversations) && firstBodyPeek.conversations[0]
    ? (firstBodyPeek.conversations[0] as { id?: string }).id
    : null;
  const firstBody = firstSearch.body as SearchResponse | null;
  const firstConvId = firstBody && Array.isArray(firstBody.conversations) && firstBody.conversations[0]
    ? (firstBody.conversations[0] as { id?: string }).id
    : null;

  if (firstConvId) {
    const msgR = await ghlGet(`/conversations/${firstConvId}/messages`);
    results[`/conversations/${firstConvId}/messages`] = {
      status: msgR.status,
      sample: (() => {
        const b = msgR.body;
        if (!b || typeof b !== "object") return b;
        const messagesObj = (b as Record<string, unknown>).messages;
        const list = Array.isArray(messagesObj)
          ? messagesObj
          : Array.isArray((messagesObj as Record<string, unknown>)?.messages)
            ? (messagesObj as Record<string, unknown>).messages
            : null;
        const arr = Array.isArray(list) ? list : null;
        return {
          topKeys: Object.keys(b as Record<string, unknown>),
          messageCount: arr ? arr.length : null,
          firstMessageKeys: arr && arr[0] ? Object.keys(arr[0] as Record<string, unknown>) : null,
          firstMessage: arr ? arr[0] : null,
        };
      })(),
    };
  }

  return NextResponse.json(results, { status: 200 });
}
