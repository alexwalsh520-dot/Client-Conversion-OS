import { NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = getServiceSupabase();
  const { data, error } = await supabase.from('mozi_settings').select('key, value');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const settings: Record<string, unknown> = {};
  for (const row of data || []) {
    settings[row.key] = row.value;
  }
  return NextResponse.json(settings);
}

export async function PUT(req: Request) {
  const supabase = getServiceSupabase();
  const { key, value } = await req.json();
  if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 });

  const { error } = await supabase
    .from('mozi_settings')
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: 'key' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
