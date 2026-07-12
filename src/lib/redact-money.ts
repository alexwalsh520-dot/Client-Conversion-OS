// Read-time redaction of concrete dollar figures from creator/token-facing payloads. The buyer-DNA
// pipeline grounds its text in real sales calls, so LLM-generated summaries and ideas often quote
// prices and buyers' personal finances (debt, salary, budget). We never want those on the public
// share page. This replaces money figures with "$X" while leaving non-money numbers — reps, ages,
// percentages, dates, follower/view counts — untouched.

// Any $-anchored figure: $1,234 · $30k · $1.2M · $200-300 · $4,000 (a trailing "/month" etc. is left
// in place, so "$4,000/month" becomes "$X/month" — readable, and no number leaks). The k/M/B suffix
// only attaches directly to the digits, and no trailing space is consumed, so "$1,200 after" becomes
// "$X after" (not "$Xafter") and "$20-25 monthly" becomes "$X monthly" (not "$Xonthly").
const DOLLAR_RE = /\$\s?\d[\d,]*(?:\.\d+)?[kKmMbB]?(?:\s*(?:[-–—]|to)\s*\$?\s?\d[\d,]*(?:\.\d+)?[kKmMbB]?)?/g;

// Bare thousands (1,200) or k/M-suffixed (30k, 1.2M) numbers are only treated as money when an
// unambiguous financial word sits within a few words after them — so "30,000 in debt" is redacted
// but "12,000 steps a day", "5k run", "10,000 followers" are not.
const BARE_MONEY_RE =
  /(?<![\w$.])(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d[\d.]*\s?[kKmM])\b(?=(?:\s+\S+){0,4}?\s+(?:debt|savings|saved|salary|income|budget|paycheck|net\s?worth|in\s+the\s+bank)\b)/gi;

function redactString(s: string): string {
  return s.replace(DOLLAR_RE, "$X").replace(BARE_MONEY_RE, "$X");
}

// Recursively redact every string in a JSON-ish value. Non-strings pass through unchanged.
export function redactMoneyDeep<T>(value: T): T {
  if (typeof value === "string") return redactString(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactMoneyDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactMoneyDeep(v);
    return out as T;
  }
  return value;
}
