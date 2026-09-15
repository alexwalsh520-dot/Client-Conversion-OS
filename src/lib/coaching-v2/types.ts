/** Client-safe types and labels for Coaching Hub v2. No server imports here. */
export type Level = "r" | "a" | "g";
export const LEVEL_LABEL: Record<Level, string> = { r: "At risk", a: "Watch", g: "On track" };

export interface Msg {
  at: string; // ISO
  daysAgo: number;
  sender: "client" | "coach";
  text: string;
}

export interface SerializedClient {
  id: number; name: string; coach: string; program: string; stage: string; health: Level;
  goal: string | null;
  flags: { lvl: Level; text: string }[];
  checkin: { score: number; at: string; daysAgo: number; text: string; followUp: string | null } | null;
  messages: Msg[];
  owedDays: number | null;
}
