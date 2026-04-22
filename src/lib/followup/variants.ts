// Epsilon-greedy variant picker for the follow-up scheduler.
// Inputs:  all eligible variants for this (client, slot), with their reply-rate stats,
//          and the set of variant_ids this subscriber has already received.
// Output:  one variant, or null if the pool is exhausted.

import { getServiceSupabase } from '@/lib/supabase';

export interface EligibleVariant {
  id: number;
  slot: number;
  type: 'text' | 'meme' | 'voicenote';
  body: string | null;
  media_url: string | null;
  reply_rate: number;
  sends: number;
}

const EPSILON = 0.2;              // random-explore rate
const MIN_SAMPLES = 15;           // below this, we prioritize cold variants

export function pickVariantEpsilonGreedy(eligible: EligibleVariant[]): EligibleVariant | null {
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];

  // Cold variants first — explore under-sampled ones half the time
  const cold = eligible.filter((v) => v.sends < MIN_SAMPLES);
  if (cold.length > 0 && Math.random() < 0.5) {
    return cold[Math.floor(Math.random() * cold.length)];
  }

  // Explore
  if (Math.random() < EPSILON) {
    return eligible[Math.floor(Math.random() * eligible.length)];
  }

  // Exploit — highest reply_rate, break ties by fewer sends
  return [...eligible].sort((a, b) => {
    if (b.reply_rate !== a.reply_rate) return b.reply_rate - a.reply_rate;
    return a.sends - b.sends;
  })[0];
}

export async function loadEligibleVariants(params: {
  client: string;
  slot: number;
  subscriberId: string;
}): Promise<EligibleVariant[]> {
  const sb = getServiceSupabase();

  const { data: variants, error: vErr } = await sb
    .from('followup_variants')
    .select('id, slot, type, body, media_url')
    .eq('client', params.client)
    .eq('slot', params.slot)
    .eq('status', 'active');

  if (vErr) throw new Error(`variants load: ${vErr.message}`);
  if (!variants?.length) return [];

  const { data: seen, error: sErr } = await sb
    .from('followup_sends')
    .select('variant_id')
    .eq('subscriber_id', params.subscriberId);
  if (sErr) throw new Error(`sends load: ${sErr.message}`);

  const seenIds = new Set((seen ?? []).map((r) => r.variant_id));
  const eligibleIds = variants.filter((v) => !seenIds.has(v.id)).map((v) => v.id);
  if (eligibleIds.length === 0) return [];

  const { data: stats, error: stErr } = await sb
    .from('followup_variant_stats')
    .select('variant_id, reply_rate, sends')
    .in('variant_id', eligibleIds);
  if (stErr) throw new Error(`stats load: ${stErr.message}`);

  const statMap = new Map((stats ?? []).map((s) => [s.variant_id, s]));
  return variants
    .filter((v) => !seenIds.has(v.id))
    .map((v) => ({
      id: v.id,
      slot: v.slot,
      type: v.type as 'text' | 'meme' | 'voicenote',
      body: v.body,
      media_url: v.media_url,
      reply_rate: statMap.get(v.id)?.reply_rate ?? 0,
      sends: statMap.get(v.id)?.sends ?? 0,
    }));
}
