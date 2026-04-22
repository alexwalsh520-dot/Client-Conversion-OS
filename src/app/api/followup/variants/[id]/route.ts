// PATCH /api/followup/variants/:id   — update body/status/type/media
// DELETE /api/followup/variants/:id   — hard-delete a variant (only if no sends logged)

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = getServiceSupabase();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.body !== undefined) updates.body = body.body ? String(body.body) : null;
  if (body.media_url !== undefined) updates.media_url = body.media_url ? String(body.media_url) : null;
  if (body.note !== undefined) updates.note = body.note ? String(body.note) : null;
  if (body.type !== undefined) updates.type = String(body.type);
  if (body.status !== undefined) updates.status = String(body.status); // active | paused

  if (Object.keys(updates).length === 1) {
    return NextResponse.json({ error: 'no updatable fields' }, { status: 400 });
  }

  const { data, error } = await sb
    .from('followup_variants')
    .update(updates)
    .eq('id', id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ variant: data });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = getServiceSupabase();

  // Don't allow hard-delete if this variant has sends — would break attribution stats.
  // Prefer pausing instead. Callers can force-delete by sending PATCH with status: paused.
  const { data: sends } = await sb
    .from('followup_sends')
    .select('id')
    .eq('variant_id', id)
    .limit(1);
  if (sends && sends.length > 0) {
    return NextResponse.json(
      { error: 'cannot delete — variant has historical sends. Pause it instead.' },
      { status: 409 },
    );
  }

  const { error } = await sb.from('followup_variants').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
