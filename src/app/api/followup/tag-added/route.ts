// Called by ManyChat's External Request when the AI follow-up tag is applied.
// Accepts both the old Cloudflare payload (`ig_user_id`) and the newer Vercel
// payload (`subscriber_id`).

import { NextRequest, NextResponse } from 'next/server';
import { scheduleFollowups } from '@/lib/followup/scheduler';

export const runtime = 'nodejs';

const SETTER_CLIENT_MAP: Record<string, string> = {
  amara: 'tyson_sonnek',
  tyson: 'tyson_sonnek',
  gideon: 'keith_holland',
  keith: 'keith_holland',
  kelechi: 'tyson_sonnek',
  debbie: 'tyson_sonnek',
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

function hasValidWebhookSecret(req: NextRequest) {
  const expected = [
    process.env.MANYCHAT_WEBHOOK_SECRET?.trim(),
    process.env.WEBHOOK_SHARED_SECRET?.trim(),
  ].filter(Boolean);
  const authorization = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const provided = [
    req.headers.get('x-manychat-secret')?.trim(),
    req.headers.get('x-forge-secret')?.trim(),
    authorization,
  ].filter(Boolean);

  if (expected.length === 0) return false;
  return provided.some((value) => expected.includes(value));
}

function resolveSetterName(body: Record<string, unknown>) {
  return (
    asString(body.setter_name) ||
    asString(body.setter) ||
    asString(body.setterName) ||
    'amara'
  ).toLowerCase();
}

function resolveClient(body: Record<string, unknown>, setterName: string) {
  const explicitClient =
    asString(body.client) ||
    asString(body.client_key) ||
    asString(body.closer) ||
    asString(body.account);
  if (explicitClient) return explicitClient;
  return SETTER_CLIENT_MAP[setterName] ?? 'tyson_sonnek';
}

function resolvePayload(body: Record<string, unknown>) {
  const contact = asRecord(body.contact);
  const setterName = resolveSetterName(body);
  const client = resolveClient(body, setterName);
  const manychatSubscriberId =
    asString(body.subscriber_id) ||
    asString(body.contact_id) ||
    asString(body.manychat_subscriber_id) ||
    asString(contact?.id);
  const instagramUserId =
    asString(body.ig_user_id) ||
    asString(body.instagram_user_id) ||
    asString(body.ig_id) ||
    asString(contact?.ig_id);
  const subscriberId = instagramUserId || manychatSubscriberId;

  return {
    client,
    subscriberId,
    manychatSubscriberId: manychatSubscriberId || undefined,
    setterName,
    leadName:
      asString(body.lead_name) ||
      asString(body.first_name) ||
      asString(body.name) ||
      asString(contact?.name) ||
      undefined,
    phone:
      asString(body.phone) ||
      asString(contact?.phone) ||
      undefined,
    firstMsgAt:
      asString(body.first_msg_at) ||
      asString(body.firstMsgAt) ||
      asString(body.created_at) ||
      asString(body.timestamp) ||
      new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  if (!hasValidWebhookSecret(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const payload = resolvePayload(body);

  if (!payload.subscriberId) {
    return NextResponse.json(
      { error: 'subscriber_id or ig_user_id required' },
      { status: 400 },
    );
  }

  try {
    const scheduled = await scheduleFollowups(payload);
    return NextResponse.json({
      ok: true,
      client: payload.client,
      subscriber_id: payload.subscriberId,
      manychat_subscriber_id: payload.manychatSubscriberId ?? null,
      jobs_scheduled: scheduled,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
