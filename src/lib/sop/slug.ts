// SOP library: deterministic slug generation for share URLs.
//
// Slugs are URL-safe identifiers used in /sop/[slug] deep links. We
// derive them from the SOP title at upload time:
//   "Sales Cold Outreach Playbook v2" -> "sales-cold-outreach-playbook-v2"
//
// On collision, we append a short random suffix rather than -2/-3
// counters — counters require a DB lookup loop and aren't human-friendly
// once you hit higher numbers. A 4-char suffix gives 1.6M permutations,
// far more than we'd ever need at the company scale.

const RANDOM_SUFFIX_CHARS = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // strip accents
    .replace(/[^a-z0-9\s-]/g, "")     // remove punctuation
    .trim()
    .replace(/\s+/g, "-")             // spaces -> hyphens
    .replace(/-+/g, "-")              // collapse multiple hyphens
    .replace(/^-|-$/g, "")            // trim leading/trailing hyphens
    .slice(0, 80) || "sop"; // hard floor — empty input shouldn't crash
}

export function randomSuffix(length = 4): string {
  let out = "";
  for (let i = 0; i < length; i++) {
    out += RANDOM_SUFFIX_CHARS[Math.floor(Math.random() * RANDOM_SUFFIX_CHARS.length)];
  }
  return out;
}

/**
 * Returns a slug that's not already in the takenSlugs set.
 * Tries the bare slug first; on collision appends -{4 random chars}.
 * Caller is responsible for fetching takenSlugs (typically via a single
 * DB query at upload time).
 */
export function uniqueSlug(title: string, takenSlugs: Set<string>): string {
  const base = slugify(title);
  if (!takenSlugs.has(base)) return base;
  // Try a few times with random suffix; effectively never collides at scale.
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = `${base}-${randomSuffix(4)}`;
    if (!takenSlugs.has(candidate)) return candidate;
  }
  // Last-resort: longer suffix
  return `${base}-${randomSuffix(8)}`;
}
