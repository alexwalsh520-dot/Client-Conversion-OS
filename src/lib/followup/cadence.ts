// Cadence constants. We prefer the DB rows in `followup_cadence`, but these
// defaults keep scheduling alive if the table is missing or empty.

import { getServiceSupabase } from '@/lib/supabase';

export interface CadenceSlot {
  slot: string;          // '2' | '3' | '4' | '5' | '6' | 'close'
  offsetMinutes: number; // minutes from setter's first message
}

export const DEFAULT_CADENCE: Record<string, CadenceSlot[]> = {
  tyson_sonnek: [
    { slot: '2',     offsetMinutes: 15 },
    { slot: '3',     offsetMinutes: 15 + 24 * 60 },
    { slot: '4',     offsetMinutes: 48 * 60 },
    { slot: '5',     offsetMinutes: 96 * 60 },
    { slot: '6',     offsetMinutes: 144 * 60 },
    { slot: 'close', offsetMinutes: 168 * 60 },
  ],
  keith_holland: [
    { slot: '2',     offsetMinutes: 15 },
    { slot: '3',     offsetMinutes: 15 + 24 * 60 },
    { slot: '4',     offsetMinutes: 48 * 60 },
    { slot: '5',     offsetMinutes: 96 * 60 },
    { slot: '6',     offsetMinutes: 144 * 60 },
    { slot: 'close', offsetMinutes: 168 * 60 },
  ],
};

function sortCadence(slots: CadenceSlot[]) {
  return [...slots].sort((a, b) => a.offsetMinutes - b.offsetMinutes);
}

export async function resolveCadence(client: string): Promise<CadenceSlot[]> {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from('followup_cadence')
      .select('slot, offset_minutes')
      .eq('client', client)
      .order('offset_minutes', { ascending: true });

    if (!error && data && data.length > 0) {
      return sortCadence(
        data.map((row) => ({
          slot: String(row.slot),
          offsetMinutes: Number(row.offset_minutes),
        })),
      );
    }
  } catch (err) {
    console.error('[followup] resolveCadence fallback:', err);
  }

  return sortCadence(DEFAULT_CADENCE[client] ?? DEFAULT_CADENCE.tyson_sonnek);
}
