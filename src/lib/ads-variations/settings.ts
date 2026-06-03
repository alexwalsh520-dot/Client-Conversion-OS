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

export type VariationsSettings = {
  variationsPerJob: number;
  mix: VariationsMix;
  // Image-gen provider id. Pluggable — see generate.ts. Default "openai".
  provider: string;
  // Master switch for the auto-pregeneration cron. When false, the daily hook
  // does nothing (manual "Regenerate" via the POST route still works).
  enabled: boolean;
};

export const DEFAULT_SETTINGS: VariationsSettings = {
  variationsPerJob: 10,
  mix: { background: 6, highlightWord: 2, copyTweak: 2 },
  provider: "openai",
  enabled: true,
};

const KINDS: VariationKind[] = ["background", "highlightWord", "copyTweak"];

// Cap so a bad UI value (or a typo) can never trigger a huge, expensive job.
const MAX_VARIATIONS_PER_JOB = 20;

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

  return { variationsPerJob, mix, provider, enabled };
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
