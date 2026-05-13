// POST /api/followup/reply-received
// Backup reply hook from ManyChat. The Instagram webhook is still the main
// stop signal, but this keeps the queue from hanging if ManyChat catches it
// first.

import { NextRequest, NextResponse } from 'next/server';
import { cancelPendingAndAttributeReply, removeManyChatFollowupTag } from '@/lib/followup/scheduler';

export const runtime = 'nodejs';

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
    ;
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

  const contact = asRecord(body.contact);
  const client = asString(body.client) || 'tyson_sonnek';
  const manychatSubscriberId =
    asString(body.subscriber_id) ||
    asString(body.contact_id) ||
    asString(body.manychat_subscriber_id) ||
    asString(contact?.id);
  const internalLeadId =
    asString(body.ig_user_id) ||
    asString(body.instagram_user_id) ||
    asString(contact?.ig_id) ||
    manychatSubscriberId;
  const replyText =
    asString(body.reply_text) ||
    asString(body.text) ||
    asString(body.message) ||
    null;

  if (!internalLeadId) {
    return NextResponse.json(
      { error: 'subscriber_id or ig_user_id required' },
      { status: 400 },
    );
  }

  try {
    const result = await cancelPendingAndAttributeReply({
      subscriberId: internalLeadId,
      replyText,
      receivedAt: new Date().toISOString(),
    });

    let tagRemoved: boolean | string = false;
    if (manychatSubscriberId) {
      try {
        await removeManyChatFollowupTag(client, manychatSubscriberId);
        tagRemoved = true;
      } catch (err) {
        tagRemoved = err instanceof Error ? err.message : String(err);
      }
    }

    return NextResponse.json({
      ok: true,
      jobs_cancelled: result.cancelled,
      attributed_send_id: result.attributedSendId,
      tag_removed: tagRemoved,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
