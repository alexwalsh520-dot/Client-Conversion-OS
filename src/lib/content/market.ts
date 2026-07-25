// Market localization. A creator's timezone says where they live; their `market` says who they
// SELL to, and only the second one should shape the words. Jake is in Sydney selling to Americans,
// and his source material is full of Australian testing vocabulary — left alone, that vocabulary
// flows straight through the ICP, the playbook and the carousels to an American audience.
//
// This produces one directive block that every generator injects into its SYSTEM prompt, where a
// rule actually changes the output. It layers WITH the writing framework rather than competing:
// the framework governs voice and structure, this governs market.

import { CREATORS_BY_KEY, type CreatorKey } from "@/lib/creators";

export const DEFAULT_MARKET = "US";

export function marketOf(creator: string): string {
  return CREATORS_BY_KEY[creator as CreatorKey]?.market || DEFAULT_MARKET;
}

const US_DIRECTIVE =
  "\n\nMARKET — THE AUDIENCE IS AMERICAN. This is not a stylistic preference; it decides whether the reader recognises themselves:\n" +
  "- Every term, test, institution, spelling and cultural reference must be US-native.\n" +
  "- The grounding documents below may contain Australian references. TRANSLATE them to the correct American equivalent for this niche. Australian fitness-test and institution vocabulary (a beep test or yo-yo test, the ADF or Defence Force, state police entrance testing, Australian academy terminology) must become the American equivalent an American candidate would actually name.\n" +
  "- PRECISION RULE, ABSOLUTE: when you are not certain of the exact American equivalent, use accurate GENERIC American framing instead — 'the entry PT test', 'the timed run', 'the physical fitness assessment', 'the academy'. NEVER invent a test name, a standard, a cut-off score or a number. A correct generic phrase is always better than a specific one that might be wrong.\n" +
  "- American spelling throughout. Never 'programme', 'centre', 'kilometre', 'realise', 'organisation'.\n" +
  "- American units where units appear: miles, yards, pounds. Never kilometres or kilos.";

const AU_DIRECTIVE =
  "\n\nMARKET — THE AUDIENCE IS AUSTRALIAN. Use Australian terminology, institutions, spelling and units throughout. Never Americanise the vocabulary.";

// The block to append to a generator's system prompt. Empty string for an unknown market, so a
// creator with no market set simply generates as before.
export function marketDirective(creator: string): string {
  const market = marketOf(creator);
  if (market === "US") return US_DIRECTIVE;
  if (market === "AU") return AU_DIRECTIVE;
  return "";
}
