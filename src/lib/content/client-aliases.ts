// The names a creator's rows are stored under in the DM tables — one exhaustive table, default-deny.
//
// This replaces three separate copies of `ALIASES[slug] || [slug]` living in the content routes. The
// `|| [slug]` was the same shape that caused the ICP incident: a missing key silently produced a
// plausible-looking answer instead of an error. There it handed one creator another creator's
// identity; here it would quietly read zero DMs and every downstream artifact would be built from
// nothing, with no signal that anything was wrong.
//
// APPEND-ONLY, like the audience locks. Adding a creator is a deliberate edit.

const CLIENT_ALIASES: Record<string, readonly string[]> = {
  tyson: ["tyson", "tyson_sonnek"],
  antwan: ["antwan", "antwan_rarcus"],
  keith: ["keith", "keith_holland"],
  lucy: ["lucy", "lucy_hubbard"],
  jake: ["jake", "jake_divljak"],
};

/**
 * Every name this creator's DM rows may be stored under.
 *
 * Throws for an undeclared creator rather than guessing. The message names the missing key and the
 * file to edit, because the whole point is that the next person hits a wall instead of a wrong answer.
 */
export function clientAliases(client: string): readonly string[] {
  const key = (client || "").toLowerCase();
  const aliases = CLIENT_ALIASES[key];
  if (!aliases) {
    throw new Error(
      `No DM aliases declared for client "${key}". Add it to CLIENT_ALIASES in src/lib/content/client-aliases.ts — a creator's data is never resolved by guessing at their key.`,
    );
  }
  return aliases;
}

/** Non-throwing form for callers that legitimately want to test whether a creator is declared. */
export function hasClientAliases(client: string): boolean {
  return Boolean(CLIENT_ALIASES[(client || "").toLowerCase()]);
}
