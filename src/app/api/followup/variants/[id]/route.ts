// PATCH /api/followup/variants/:id   — update body/status/type/media
// DELETE /api/followup/variants/:id   — hard-delete a variant (only if no sends logged)

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
const ALLOWED_SLOTS = [2, 3, 4, 5, 6] as const;
const ALLOWED_TYPES = ['text', 'meme', 'voicenote'] as const;
const ALLOWED_STATUS = ['active', 'paused'] as const;
const MAX_ACTIVE_VARIANTS_PER_SLOT = 3;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sb = getServiceSupabase();

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const { data: existing, error: existingError } = await sb
    .from('followup_variants')
    .select('id, client, slot, type, status, body, media_url')
    .eq('id', id)
    .single();
  if (existingError || !existing) {
    return NextResponse.json({ error: existingError?.message ?? 'variant not found' }, { status: 404 });
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

  const nextType = String(updates.type ?? existing.type);
  const nextStatus = String(updates.status ?? existing.status);
  const nextBody = updates.body !== undefined ? updates.body : existing.body;
  const nextMediaUrl = updates.media_url !== undefined ? updates.media_url : existing.media_url;
  const nextSlot = Number(existing.slot);

  if (!ALLOWED_SLOTS.includes(nextSlot as (typeof ALLOWED_SLOTS)[number])) {
    return NextResponse.json({ error: 'invalid slot' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.includes(nextType as (typeof ALLOWED_TYPES)[number])) {
    return NextResponse.json({ error: 'type must be text | meme | voicenote' }, { status: 400 });
  }
  if (!ALLOWED_STATUS.includes(nextStatus as (typeof ALLOWED_STATUS)[number])) {
    return NextResponse.json({ error: 'status must be active | paused' }, { status: 400 });
  }
  if (nextType === 'text' && !(typeof nextBody === 'string' && nextBody.trim())) {
    return NextResponse.json({ error: 'body required for text variants' }, { status: 400 });
  }
  if (
    (nextType === 'meme' || nextType === 'voicenote') &&
    !(typeof nextMediaUrl === 'string' && nextMediaUrl.trim())
  ) {
    return NextResponse.json({ error: 'media_url required for meme/voicenote' }, { status: 400 });
  }

  if (existing.status !== 'active' && nextStatus === 'active') {
    const { count, error: countError } = await sb
      .from('followup_variants')
      .select('id', { head: true, count: 'exact' })
      .eq('client', existing.client)
      .eq('slot', existing.slot)
      .eq('status', 'active');
    if (countError) {
      return NextResponse.json({ error: countError.message }, { status: 500 });
    }
    if ((count ?? 0) >= MAX_ACTIVE_VARIANTS_PER_SLOT) {
      return NextResponse.json(
        { error: `slot ${existing.slot} already has ${MAX_ACTIVE_VARIANTS_PER_SLOT} active variants` },
        { status: 409 },
      );
    }
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
