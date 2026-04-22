// Cadence constants. Read from DB at job-schedule time, but these are the
// defaults and the TypeScript-side fallback if the DB lookup fails.

export interface CadenceSlot {
  slot: string;          // '2' | '3' | '4' | '5' | 'close'
  offsetMinutes: number; // minutes from setter's first message
}

export const DEFAULT_CADENCE: Record<string, CadenceSlot[]> = {
  tyson_sonnek: [
    { slot: '2',     offsetMinutes: 15 },
    { slot: '3',     offsetMinutes: 15 + 24 * 60 },
    { slot: '4',     offsetMinutes: 15 + 72 * 60 },
    { slot: '5',     offsetMinutes: 15 + 120 * 60 },
    { slot: 'close', offsetMinutes: 15 + 144 * 60 },
  ],
};

export function resolveCadence(client: string): CadenceSlot[] {
  return DEFAULT_CADENCE[client] ?? DEFAULT_CADENCE.tyson_sonnek;
}
