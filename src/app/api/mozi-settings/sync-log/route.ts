import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

/**
 * Returns the latest sync_log entry per source.
 */
export async function GET() {
  const { data, error } = await supabase
    .from('mozi_sync_log')
    .select('source, status, records_synced, error_message, started_at, completed_at')
    .order('started_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Deduplicate: keep only the latest entry per source
  const seen = new Set<string>();
  const latest: typeof data = [];
  for (const row of data || []) {
    if (!seen.has(row.source)) {
      seen.add(row.source);
      latest.push(row);
    }
  }

  return NextResponse.json(latest);
}
