// GET /api/followup/variants?client=tyson_sonnek  — list variants w/ stats
// POST /api/followup/variants                       — create a new variant

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
const ALLOWED_SLOTS = [2, 3, 4, 5, 6] as const;
const MAX_ACTIVE_VARIANTS_PER_SLOT = 3;

export async function GET(req: NextRequest) {
  const sb = getServiceSupabase();
  const client = req.nextUrl.searchParams.get('client') || 'tyson_sonnek';

  try {
    const { data: variants, error } = await sb
      .from('followup_variants')
      .select('id, slot, type, body, media_url, status, note, created_at, updated_at')
      .eq('client', client)
      .order('slot', { ascending: true })
      .order('id', { ascending: true });
    if (error) throw new Error(error.message);

    const { data: stats } = await sb
      .from('followup_variant_stats')
      .select('variant_id, sends, replies, reply_rate')
      .eq('client', client);
    const statMap = new Map((stats ?? []).map((s) => [s.variant_id, s]));

    const enriched = (variants ?? []).map((v) => ({
      ...v,
      sends: statMap.get(v.id)?.sends ?? 0,
      replies: statMap.get(v.id)?.replies ?? 0,
      reply_rate: statMap.get(v.id)?.reply_rate ?? 0,
    }));

    return NextResponse.json({ variants: enriched });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const sb = getServiceSupabase();
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const client = String(body.client ?? 'tyson_sonnek');
  const slot = Number(body.slot);
  const type = String(body.type ?? 'text');
  const textBody = body.body ? String(body.body) : null;
  const mediaUrl = body.media_url ? String(body.media_url) : null;
  const note = body.note ? String(body.note) : null;

  if (!ALLOWED_SLOTS.includes(slot as (typeof ALLOWED_SLOTS)[number])) {
    return NextResponse.json({ error: 'slot must be 2, 3, 4, 5, or 6' }, { status: 400 });
  }
  if (!['text', 'meme', 'voicenote'].includes(type)) {
    return NextResponse.json({ error: 'type must be text | meme | voicenote' }, { status: 400 });
  }
  if (type === 'text' && !textBody) {
    return NextResponse.json({ error: 'body required for text variants' }, { status: 400 });
  }
  if ((type === 'meme' || type === 'voicenote') && !mediaUrl) {
    return NextResponse.json({ error: 'media_url required for meme/voicenote' }, { status: 400 });
  }

  const { count, error: countError } = await sb
    .from('followup_variants')
    .select('id', { head: true, count: 'exact' })
    .eq('client', client)
    .eq('slot', slot)
    .eq('status', 'active');
  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= MAX_ACTIVE_VARIANTS_PER_SLOT) {
    return NextResponse.json(
      { error: `slot ${slot} already has ${MAX_ACTIVE_VARIANTS_PER_SLOT} active variants` },
      { status: 409 },
    );
  }

  const { data, error } = await sb
    .from('followup_variants')
    .insert({
      client,
      slot,
      type,
      body: textBody,
      media_url: mediaUrl,
      note,
      status: 'active',
    })
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ variant: data });
}
