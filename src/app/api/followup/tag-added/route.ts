// Called by ManyChat's External Request when AI-FOLLOWUP tag is applied.
// Body: { client, subscriber_id, setter_name, lead_name?, phone?, first_msg_at }

import { NextRequest, NextResponse } from 'next/server';
import { scheduleFollowups } from '@/lib/followup/scheduler';

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
  const setterName = String(body.setter_name ?? 'amara');
  const leadName = body.lead_name ? String(body.lead_name) : undefined;
  const phone = body.phone ? String(body.phone) : undefined;
  const firstMsgAt = body.first_msg_at
    ? String(body.first_msg_at)
    : new Date().toISOString();

  if (!subscriberId) {
    return NextResponse.json({ error: 'subscriber_id required' }, { status: 400 });
  }

  try {
    const scheduled = await scheduleFollowups({
      client,
      subscriberId,
      setterName,
      leadName,
      phone,
      firstMsgAt,
    });
    return NextResponse.json({ ok: true, jobs_scheduled: scheduled });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
