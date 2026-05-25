import { NextResponse } from 'next/server';
import { getAllLeads } from '@/lib/super-doc-db';

export async function GET() {
  const leads = await getAllLeads();
  return NextResponse.json({
    leads: leads.map((lead) => ({
      id: lead.id,
      slug: lead.slug,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      lead_type: lead.lead_type,
      video_url: lead.video_url,
      created_at: lead.created_at,
      opened_at: lead.opened_at,
      view_count: lead.view_count,
      max_scroll_percent: lead.max_scroll_percent || 0,
      last_read_at: lead.last_read_at || null,
      video_play_count: lead.video_play_count || 0,
      video_watch_seconds: lead.video_watch_seconds || 0,
      video_watch_percent: lead.video_watch_percent || 0,
      last_video_event_at: lead.last_video_event_at || null,
    })),
  });
}
