import { NextRequest, NextResponse } from 'next/server';
import { getLeadBySlug, updateLeadSnapshot } from '@/lib/super-doc-db';

interface Props {
  params: Promise<{ slug: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { slug } = await params;
  const lead = await getLeadBySlug(slug);
  if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 });

  return NextResponse.json({
    lead: {
      slug: lead.slug,
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      lead_type: lead.lead_type,
      video_url: lead.video_url,
      created_at: lead.created_at,
      view_count: lead.view_count,
    },
    content: lead.content_snapshot,
  });
}

export async function PUT(req: NextRequest, { params }: Props) {
  const { slug } = await params;
  const body = await req.json();
  if (!body.content) {
    return NextResponse.json({ error: 'Missing content' }, { status: 400 });
  }

  await updateLeadSnapshot(slug, body.content);
  return NextResponse.json({ ok: true });
}
