import { getServiceSupabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────
// Setter capacity config — the MANUALLY-SET side of the Lab "Setter load" gate.
//
// A manager edits each setter's max leads/day via a gear icon. We store it in
// the generic `lab_config` key→json table under one key. The LOAD (leads
// actually handled) is computed separately in /api/lab/setter-load; this file
// owns only the capacity (denominator).
// ─────────────────────────────────────────────────────────────────────────

export const SETTER_CAPACITY_CONFIG_KEY = "setter_capacity";

/** The five setters this gate tracks, in display order. */
export const SETTER_NAMES = ["Erin", "Amara", "Debbie", "Kelechi", "Gideon"] as const;
export type SetterName = (typeof SETTER_NAMES)[number];

export type CapacityMode = "per_setter" | "team";

export interface SetterCapacityConfig {
  /**
   * "per_setter" → each setter has their own cap (the `setters` map).
   * "team"       → the whole team shares `teamLeadsPerDay`. We keep BOTH fields
   *                populated so the UI can present either view.
   */
  mode: CapacityMode;
  /** Team-wide leads/day used when mode === "team". */
  teamLeadsPerDay: number;
  /** Per-setter caps, keyed by display name. */
  setters: Record<SetterName, number>;
}

const DEFAULT_LEADS_PER_DAY = 100;

export function defaultSetterCapacityConfig(): SetterCapacityConfig {
  const setters = Object.fromEntries(
    SETTER_NAMES.map((name) => [name, DEFAULT_LEADS_PER_DAY]),
  ) as Record<SetterName, number>;

  return {
    mode: "per_setter",
    teamLeadsPerDay: DEFAULT_LEADS_PER_DAY,
    setters,
  };
}

function coerceNonNegativeNumber(value: unknown, fallback: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(num) || num < 0) return fallback;
  // Caps are whole leads/day.
  return Math.round(num);
}

/**
 * Validate + normalize an arbitrary input into a well-formed config.
 * - Unknown setter keys are dropped; missing ones fall back to the default.
 * - Numbers are coerced to non-negative integers.
 * - `mode` must be one of the two known values.
 * Throws only on fundamentally unusable input (non-object with content).
 */
export function normalizeSetterCapacityConfig(input: unknown): SetterCapacityConfig {
  const base = defaultSetterCapacityConfig();
  if (input == null) return base;
  if (typeof input !== "object") {
    throw new Error("Config must be an object");
  }

  const raw = input as Record<string, unknown>;

  const mode: CapacityMode = raw.mode === "team" ? "team" : "per_setter";
  const teamLeadsPerDay = coerceNonNegativeNumber(raw.teamLeadsPerDay, base.teamLeadsPerDay);

  const rawSetters =
    raw.setters && typeof raw.setters === "object"
      ? (raw.setters as Record<string, unknown>)
      : {};

  const setters = Object.fromEntries(
    SETTER_NAMES.map((name) => [
      name,
      coerceNonNegativeNumber(rawSetters[name], base.setters[name]),
    ]),
  ) as Record<SetterName, number>;

  return { mode, teamLeadsPerDay, setters };
}

/**
 * Read the saved capacity config from `lab_config`, or the default if absent.
 * Used by BOTH /api/lab/setter-capacity (GET) and /api/lab/setter-load so the
 * denominator is always identical.
 */
export async function getSetterCapacityConfig(): Promise<SetterCapacityConfig> {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("lab_config")
    .select("value")
    .eq("key", SETTER_CAPACITY_CONFIG_KEY)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data?.value) {
    return defaultSetterCapacityConfig();
  }

  return normalizeSetterCapacityConfig(data.value);
}

/**
 * The effective per-setter cap, honoring mode:
 * - per_setter → that setter's own cap.
 * - team       → every setter shares `teamLeadsPerDay` as their individual cap.
 */
export function capacityForSetter(config: SetterCapacityConfig, name: SetterName): number {
  return config.mode === "team" ? config.teamLeadsPerDay : config.setters[name];
}
