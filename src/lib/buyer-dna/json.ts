// Robust JSON extraction for model output. LLMs occasionally emit a broken tail or an unescaped
// double-quote inside a string value that defeats a single JSON.parse of the whole payload. When the
// clean parse fails, salvageObjects recovers whatever individual objects DO parse — partial recovery
// is the point, since the callers can act on a subset and retry the rest next run.

// Strip ```json fences, slice the first "{" to the last "}", JSON.parse. Null on any failure.
export function extractJson<T = unknown>(text: string): T | null {
  const raw = text.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  const a = raw.indexOf("{");
  const b = raw.lastIndexOf("}");
  if (a < 0 || b < 0) return null;
  try {
    return JSON.parse(raw.slice(a, b + 1)) as T;
  } catch {
    return null;
  }
}

// Balanced-brace scan for every {...} object literal at any nesting depth; JSON.parse each one
// independently; keep those that are plain objects containing every required key. String-aware so
// braces inside quoted values are ignored. A broken object (e.g. an unescaped quote) simply fails
// its own parse and is skipped while its well-formed siblings are still recovered.
export function salvageObjects<T = Record<string, unknown>>(text: string, requiredKeys: string[]): T[] {
  const out: T[] = [];
  const seen = new Set<string>();
  const stack: number[] = [];
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") stack.push(i);
    else if (c === "}") {
      const start = stack.pop();
      if (start === undefined) continue;
      const chunk = text.slice(start, i + 1);
      if (seen.has(chunk)) continue;
      seen.add(chunk);
      try {
        const o = JSON.parse(chunk) as unknown;
        if (o && typeof o === "object" && !Array.isArray(o) && requiredKeys.every((k) => k in (o as object))) {
          out.push(o as T);
        }
      } catch {
        // Not a standalone-parseable object; skip it and keep scanning for siblings.
      }
    }
  }
  return out;
}
