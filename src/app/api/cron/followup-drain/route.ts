// Cron: drains due follow-up jobs. Fires every minute.
// Authenticated by CRON_SECRET header (same pattern as other cron routes).

import { NextRequest, NextResponse } from 'next/server';
import { drainDueJobs } from '@/lib/followup/scheduler';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const header = req.headers.get('authorization') || req.headers.get('x-cron-secret');
  const expected = process.env.CRON_SECRET;
  if (expected && header !== `Bearer ${expected}` && header !== expected) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const result = await drainDueJobs(100);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export const POST = GET;
