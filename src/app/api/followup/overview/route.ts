// GET /api/followup/overview?client=tyson_sonnek
// Returns dashboard summary: active leads, recent sends, recent replies, headline KPIs.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

interface ActiveLead {
  subscriber_id: string;
  lead_name: string | null;
  next_slot: number | null;
  next_scheduled_at: string;
  total_pending: number;
  sends_so_far: number;
}

export async function GET(req: NextRequest) {
  const sb = getServiceSupabase();
  const client = req.nextUrl.searchParams.get('client') || 'tyson_sonnek';

  try {
    const since30d = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

    // 1) Headline KPIs — last 30 days
    const { data: sends30d } = await sb
      .from('followup_sends')
      .select('id, replied_at')
      .eq('client', client)
      .gte('sent_at', since30d);

    const totalSends = sends30d?.length ?? 0;
    const totalReplies = sends30d?.filter((s) => s.replied_at).length ?? 0;
    const replyRate = totalSends > 0 ? totalReplies / totalSends : 0;

    // 2) Active leads — distinct subscribers with pending jobs
    const { data: pending } = await sb
      .from('followup_jobs')
      .select('subscriber_id, slot, scheduled_at, metadata, type')
      .eq('client', client)
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true });

    const byLead = new Map<string, ActiveLead>();
    for (const job of pending ?? []) {
      const existing = byLead.get(job.subscriber_id);
      if (!existing) {
        byLead.set(job.subscriber_id, {
          subscriber_id: job.subscriber_id,
          lead_name: (job.metadata as { lead_name?: string })?.lead_name ?? null,
          next_slot: job.type === 'close' ? null : job.slot,
          next_scheduled_at: job.scheduled_at,
          total_pending: 1,
          sends_so_far: 0,
        });
      } else {
        existing.total_pending += 1;
      }
    }

    // Enrich with sends_so_far
    if (byLead.size > 0) {
      const ids = [...byLead.keys()];
      const { data: sendsPerLead } = await sb
        .from('followup_sends')
        .select('subscriber_id')
        .eq('client', client)
        .in('subscriber_id', ids);
      const sendCounts = new Map<string, number>();
      for (const s of sendsPerLead ?? []) {
        sendCounts.set(s.subscriber_id, (sendCounts.get(s.subscriber_id) ?? 0) + 1);
      }
      for (const lead of byLead.values()) {
        lead.sends_so_far = sendCounts.get(lead.subscriber_id) ?? 0;
      }
    }

    const activeLeads = [...byLead.values()].slice(0, 50);

    // 3) Recent sends (last 30, with reply state)
    const { data: recentSends } = await sb
      .from('followup_sends')
      .select('id, subscriber_id, slot, sent_at, replied_at, reply_text, variant_id')
      .eq('client', client)
      .order('sent_at', { ascending: false })
      .limit(30);

    // 4) Recent replies (filter sends with replied_at)
    const recentReplies = (recentSends ?? [])
      .filter((s) => s.replied_at)
      .slice(0, 15);

    return NextResponse.json({
      kpis: {
        total_sends_30d: totalSends,
        total_replies_30d: totalReplies,
        reply_rate_30d: replyRate,
        active_leads: activeLeads.length,
      },
      active_leads: activeLeads,
      recent_sends: recentSends ?? [],
      recent_replies: recentReplies,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
