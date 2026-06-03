import { getServiceSupabase } from "@/lib/supabase";

// The Variations Factory config. A single JSON blob stored in app_settings under
// the key `variations_factory`. The frontend edits this live (via the settings
// API route) and the generation engine reads it at job time, so changing the mix
// or count from the UI changes exactly what the engine produces tomorrow morning.

export const SETTINGS_KEY = "variations_factory";

export type VariationKind = "background" | "highlightWord" | "copyTweak";

export type VariationsMix = {
  background: number;
  highlightWord: number;
  copyTweak: number;
};

// How often the morning automation runs (when enabled). A daily cron tick honors
// this by skipping ads generated within the cadence window — see auto.ts.
export type VariationsCadence = "daily" | "every3" | "weekly";

// A reusable generate instruction (shared by the manual popup + automations).
export type VariationsPreset = {
  id: string;
  label: string;
  prompt: string;
};

export type VariationsSettings = {
  variationsPerJob: number;
  mix: VariationsMix;
  // Image-gen provider id. Pluggable — see generate.ts. Default "higgsfield".
  provider: string;
  // Master switch for the morning auto-pregeneration cron. When false, the daily
  // hook does nothing (manual "Regenerate" via the POST route still works). This
  // is the "Automation" toggle the owner flips from the gear panel.
  enabled: boolean;
  // How often the automation makes a fresh batch (when enabled).
  cadence: VariationsCadence;
  // The owner's plain-English creative SOP — how the engine should vary ads.
  // Woven into every generation prompt so the factory adapts to it live, without
  // a code change. Empty = use the built-in defaults only.
  sop: string;
  // The editable preset library (the instruction buttons in the Generate popup).
  presets: VariationsPreset[];
};

// Default presets — lifted from Studio 2's generate tab so the two feel the same.
export const DEFAULT_PRESETS: VariationsPreset[] = [
  { id: "same-style", label: "Same text style", prompt: "Use the exact same bold font style, line spacing, black rounded background highlights, text placement style, and overall Instagram Story ad format." },
  { id: "same-person", label: "Keep person identical", prompt: "Keep the person, body, face, pose, lighting, and background image as identical as possible. Only make the requested ad variation." },
  { id: "copy-only", label: "Copy only", prompt: "Only vary the ad copy slightly. Keep the image, layout, text styling, highlight backgrounds, and visual composition the same." },
  { id: "premium-readable", label: "More premium", prompt: "Make the final ad feel cleaner, more premium, and easier to read while preserving the same direct-response style." },
];

// Auto-generation defaults OFF: the morning cron is wired but dormant until the
// owner turns Automation on from the gear panel (so it never bills before they
// opt in). Manual Regenerate works regardless.
export const DEFAULT_SETTINGS: VariationsSettings = {
  variationsPerJob: 10,
  mix: { background: 6, highlightWord: 2, copyTweak: 2 },
  provider: "higgsfield",
  enabled: false,
  cadence: "daily",
  sop: "",
  presets: DEFAULT_PRESETS,
};

const KINDS: VariationKind[] = ["background", "highlightWord", "copyTweak"];
const CADENCES: VariationsCadence[] = ["daily", "every3", "weekly"];

// Cap so a bad UI value (or a typo) can never trigger a huge, expensive job.
const MAX_VARIATIONS_PER_JOB = 20;
// Cap the stored SOP so a paste can't bloat the prompt / settings row.
const MAX_SOP_CHARS = 1200;
// Caps for the preset library.
const MAX_PRESETS = 16;
const MAX_PRESET_LABEL = 60;
const MAX_PRESET_PROMPT = 800;

// Cadence → freshness window (hours). A daily cron tick generates for an ad only
// if its newest variation is older than this, so "every 3 days" / "weekly" work
// without a separate schedule. Slightly under the nominal period to avoid drift.
export function cadenceWindowHours(cadence: VariationsCadence): number {
  if (cadence === "weekly") return 7 * 24 - 4;
  if (cadence === "every3") return 3 * 24 - 4;
  return 20; // daily
}

function sanitizePresets(raw: unknown): VariationsPreset[] {
  if (!Array.isArray(raw)) return DEFAULT_PRESETS;
  const out: VariationsPreset[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const label = String(rec.label ?? "").trim().slice(0, MAX_PRESET_LABEL);
    const prompt = String(rec.prompt ?? "").trim().slice(0, MAX_PRESET_PROMPT);
    if (!label || !prompt) continue;
    let id = String(rec.id ?? "").trim().slice(0, 40) || label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!id || seen.has(id)) id = `${id || "preset"}-${out.length}`;
    seen.add(id);
    out.push({ id, label, prompt });
    if (out.length >= MAX_PRESETS) break;
  }
  return out;
}

// Coerce arbitrary stored / submitted JSON into a valid, safe settings object.
// Never throws: any malformed field falls back to the default. The returned
// object is guaranteed internally consistent (mix sums to variationsPerJob).
export function normalizeSettings(raw: unknown): VariationsSettings {
  const obj = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const provider =
    typeof obj.provider === "string" && obj.provider.trim()
      ? obj.provider.trim()
      : DEFAULT_SETTINGS.provider;

  const enabled = typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_SETTINGS.enabled;

  const cadence: VariationsCadence = CADENCES.includes(obj.cadence as VariationsCadence)
    ? (obj.cadence as VariationsCadence)
    : DEFAULT_SETTINGS.cadence;

  const sop = typeof obj.sop === "string" ? obj.sop.trim().slice(0, MAX_SOP_CHARS) : DEFAULT_SETTINGS.sop;

  const presets = "presets" in obj ? sanitizePresets(obj.presets) : DEFAULT_PRESETS;
  const safePresets = presets.length ? presets : DEFAULT_PRESETS;

  const rawMix = (obj.mix && typeof obj.mix === "object" ? obj.mix : {}) as Record<string, unknown>;
  const mix: VariationsMix = {
    background: clampInt(rawMix.background, DEFAULT_SETTINGS.mix.background),
    highlightWord: clampInt(rawMix.highlightWord, DEFAULT_SETTINGS.mix.highlightWord),
    copyTweak: clampInt(rawMix.copyTweak, DEFAULT_SETTINGS.mix.copyTweak),
  };

  // The mix is the source of truth for the count: variationsPerJob is derived
  // from the mix so the two can never disagree. If the submitted
  // variationsPerJob conflicts, the mix wins (it's what the engine iterates).
  let variationsPerJob = mix.background + mix.highlightWord + mix.copyTweak;

  if (variationsPerJob <= 0) {
    // Empty mix — restore the default mix rather than produce a zero-image job.
    mix.background = DEFAULT_SETTINGS.mix.background;
    mix.highlightWord = DEFAULT_SETTINGS.mix.highlightWord;
    mix.copyTweak = DEFAULT_SETTINGS.mix.copyTweak;
    variationsPerJob = DEFAULT_SETTINGS.variationsPerJob;
  }

  if (variationsPerJob > MAX_VARIATIONS_PER_JOB) {
    // Scale the mix down proportionally to fit the hard cap.
    const scale = MAX_VARIATIONS_PER_JOB / variationsPerJob;
    mix.background = Math.floor(mix.background * scale);
    mix.highlightWord = Math.floor(mix.highlightWord * scale);
    mix.copyTweak = Math.max(0, MAX_VARIATIONS_PER_JOB - mix.background - mix.highlightWord);
    variationsPerJob = mix.background + mix.highlightWord + mix.copyTweak;
  }

  return { variationsPerJob, mix, provider, enabled, cadence, sop, presets: safePresets };
}

function clampInt(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.min(Math.floor(n), MAX_VARIATIONS_PER_JOB);
}

// Reads the current settings from app_settings. Falls back to DEFAULT_SETTINGS
// if the row is missing or unparseable — the engine and UI never break on a
// missing config row.
export async function getSettings(): Promise<VariationsSettings> {
  try {
    const db = getServiceSupabase();
    const { data } = await db
      .from("app_settings")
      .select("value")
      .eq("key", SETTINGS_KEY)
      .maybeSingle();
    if (!data?.value) return { ...DEFAULT_SETTINGS };
    return normalizeSettings(JSON.parse(data.value as string));
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

// Persists a (normalized) settings object. Returns the stored object.
export async function saveSettings(
  raw: unknown,
  updatedBy?: string | null
): Promise<VariationsSettings> {
  const settings = normalizeSettings(raw);
  const db = getServiceSupabase();
  const { error } = await db.from("app_settings").upsert(
    {
      key: SETTINGS_KEY,
      value: JSON.stringify(settings),
      updated_at: new Date().toISOString(),
      updated_by: updatedBy ?? null,
    },
    { onConflict: "key" }
  );
  if (error) throw new Error(error.message);
  return settings;
}

// Expands a mix into an ordered list of the kinds to generate, one entry per
// image. e.g. {background:2, highlightWord:1, copyTweak:1} -> [background,
// background, highlightWord, copyTweak].
export function expandMix(mix: VariationsMix): VariationKind[] {
  const out: VariationKind[] = [];
  for (const kind of KINDS) {
    const count = Math.max(0, Math.floor(mix[kind] || 0));
    for (let i = 0; i < count; i++) out.push(kind);
  }
  return out;
}
