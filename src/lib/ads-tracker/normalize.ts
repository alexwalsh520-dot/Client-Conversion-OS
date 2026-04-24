export function normalizeKeyword(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized || null;
}

export function displayKeyword(value: unknown): string {
  const normalized = normalizeKeyword(value);
  return normalized ? normalized.toUpperCase() : "UNKNOWN";
}

export function keywordFromAdName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;

  const segments = trimmed
    .split(/[|:()[\]{}_-]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const candidate = segments.at(-1) || trimmed;
  const words = candidate.match(/[a-z0-9]+/gi);
  if (!words?.length) return normalizeKeyword(candidate);

  return normalizeKeyword(words.at(-1));
}

export function normalizePersonName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return normalized || null;
}

export function extractKeywordFromPayload(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;

  const seen = new Set<unknown>();
  const queue: unknown[] = [payload];
  const keywordKeys = new Set([
    "keyword",
    "utm_content",
    "utmContent",
    "UTM Content",
    "UTM_CONTENT",
    "ad_keyword",
    "adKeyword",
  ]);

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    for (const [key, value] of Object.entries(current)) {
      if (keywordKeys.has(key)) {
        const normalized = normalizeKeyword(value);
        if (normalized) return normalized;
      }

      if (
        value &&
        typeof value === "object" &&
        "name" in value &&
        "value" in value
      ) {
        const field = value as { name?: unknown; value?: unknown };
        if (
          typeof field.name === "string" &&
          keywordKeys.has(field.name)
        ) {
          const normalized = normalizeKeyword(field.value);
          if (normalized) return normalized;
        }
      }

      if (value && typeof value === "object") queue.push(value);
    }
  }

  return null;
}

export function extractRawKeywordFromPayload(payload: unknown): string | null {
  const normalized = extractKeywordFromPayload(payload);
  return normalized ? normalized.toUpperCase() : null;
}
