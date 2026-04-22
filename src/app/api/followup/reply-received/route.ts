// POST /api/followup/reply-received
// Called by ManyChat's "user replies in conversation" rule (filtered by
// tag AI-FOLLOWUP). Cancels all pending follow-up jobs for this subscriber,
// attributes the reply to the most recent send, and removes the
// AI-FOLLOWUP tag so setters see a clean slate in ManyChat.

import { NextRequest, NextResponse } from 'next/server';
import { cancelPendingAndAttributeReply, removeManyChatFollowupTag } from '@/lib/followup/scheduler';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-manychat-secret');
  if (secret !== process.env.MANYCHAT_WEBHOOK_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const client = String(body.client ?? 'tyson_sonnek');
  const subscriberId = String(body.subscriber_id ?? '').trim();
  const replyText = body.reply_text ? String(body.reply_text) : null;

  if (!subscriberId) {
    return NextResponse.json({ error: 'subscriber_id required' }, { status: 400 });
  }

  try {
    const result = await cancelPendingAndAttributeReply({
      subscriberId,
      replyText,
      receivedAt: new Date().toISOString(),
    });

    // Belt-and-suspenders: remove AI-FOLLOWUP tag in ManyChat so the setter
    // UI shows the lead as no longer under AI management. If the ManyChat
    // rule already does this, the call is a no-op.
    let tagRemoved: boolean | string = false;
    try {
      await removeManyChatFollowupTag(client, subscriberId);
      tagRemoved = true;
    } catch (err) {
      tagRemoved = err instanceof Error ? err.message : String(err);
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
