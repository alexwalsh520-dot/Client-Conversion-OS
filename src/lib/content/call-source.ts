// WHICH CALLS ARE BUYER MATERIAL.
//
// A recording attached to a creator is not automatically that creator's buyer talking. Our own
// onboarding, strategy and coaching calls WITH the creator are attached to them too — same client
// key, same pipeline — and when they get mined, the creator's own voice ends up quoted back as if a
// buyer said it. That is exactly what happened to Jake: all 68 of his mined quotes came from six
// internal calls, and his "buyer language" ended up containing him talking about his own funnel.
//
// Raw transcripts are never touched. This only decides what may be MINED as buyer voice.

import { CREATORS } from "@/lib/creators";

/** Our own people. A call with one of us in the title is a working session, not a sales call. */
const TEAM_NAMES = ["matthew", "matt ", "alex", "ahmad", "will ", "jacob", "austin", "coreshift", "cc team"];

/** Titles that describe an internal working session rather than a prospect conversation. */
const INTERNAL_MARKERS = [
  " x ",
  "onboarding",
  "kickoff",
  "kick off",
  "strategy",
  "internal",
  "standup",
  "stand-up",
  "check-in",
  "check in",
  "weekly",
  "sync",
  "plan)",
  "'s plan",
  "handover",
  "retro",
];

function norm(s: string | null | undefined): string {
  return (s || "").toLowerCase().trim();
}

/**
 * True when this recording is a genuine buyer/prospect conversation for `creator`.
 *
 * Conservative by design in one direction only: when a call looks internal we exclude it, because a
 * false exclusion costs us one call's quotes while a false inclusion poisons every downstream
 * artifact — the ICP, the buyer language, and every carousel that reads them.
 */
export function isBuyerCall(
  call: { title?: string | null; prospect_name?: string | null },
  creator: string,
): boolean {
  const title = norm(call.title);
  if (!title) return true; // nothing to judge on; the miner's own quality bar still applies

  // A call titled with our own team is us talking to each other or to the creator.
  if (TEAM_NAMES.some((n) => title.includes(n))) return false;
  if (INTERNAL_MARKERS.some((m) => title.includes(m))) return false;

  // A call titled with the creator's own name or brand is a call WITH the creator, not with a buyer.
  const c = CREATORS.find((x) => x.key === norm(creator));
  const own = [norm(c?.name), ...(c?.matchTokens || []).map(norm)].filter(Boolean);
  const prospect = norm(call.prospect_name);
  if (own.some((token) => token && title.includes(token))) {
    // Unless the title also names a distinct prospect — "Jake - Marcus" is Jake selling to Marcus.
    if (!prospect || own.some((token) => token && prospect.includes(token))) return false;
  }
  return true;
}

/** Split a batch, so a caller can report exactly what it skipped and why. */
export function partitionBuyerCalls<T extends { title?: string | null; prospect_name?: string | null }>(
  calls: T[],
  creator: string,
): { buyer: T[]; internal: T[] } {
  const buyer: T[] = [];
  const internal: T[] = [];
  for (const c of calls) (isBuyerCall(c, creator) ? buyer : internal).push(c);
  return { buyer, internal };
}
