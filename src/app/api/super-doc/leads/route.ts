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
      created_at: lead.created_at,
      view_count: lead.view_count,
    })),
  });
}
