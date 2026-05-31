// Structured, numeric-friendly parse of a Meta ad set `targeting` object.
// Turns the raw audience JSON into the handful of numbers + labels the Deep
// Dive can honestly correlate against ROAS — age range, how many interests,
// how many placements, broad vs lookalike, etc. The labels mirror what the
// live-ads view already shows the founder, so the two never disagree.
//
// Everything that can't be read is returned as null (not 0) so a missing value
// never masquerades as a real "zero interests" reading downstream.

export type AudienceType = "broad" | "interest" | "custom" | "lookalike";

export interface ParsedTargeting {
  ageMin: number | null;
  ageMax: number | null;
  ageWidth: number | null;
  genders: "all" | "men" | "women";
  geoCount: number;
  interestCount: number;
  customAudienceCount: number;
  hasLookalike: boolean;
  placementCount: number;
  audienceType: AudienceType;
  isAdvantage: boolean;
}

type Rec = Record<string, unknown>;

function names(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return item;
      if (!item || typeof item !== "object") return "";
      const record = item as Rec;
      return String(record.name || record.key || record.id || "").trim();
    })
    .filter(Boolean);
}

// Interests/behaviors can sit directly on targeting OR inside flexible_spec[]
// (Meta's AND/OR audience blocks). Pull from both so a narrow audience isn't
// mistaken for broad just because it used the flexible structure.
function nested(targeting: Rec, key: string): string[] {
  const direct = names(targeting[key]);
  const flexible = Array.isArray(targeting.flexible_spec)
    ? targeting.flexible_spec.flatMap((spec) =>
        spec && typeof spec === "object" ? names((spec as Rec)[key]) : []
      )
    : [];
  return [...direct, ...flexible];
}

export function parseTargeting(raw: unknown): ParsedTargeting | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Rec;

  const ageMin = Number(t.age_min) || null;
  const ageMax = Number(t.age_max) || null;
  const ageWidth =
    ageMin != null && ageMax != null ? Math.max(0, ageMax - ageMin) : null;

  const g = Array.isArray(t.genders) ? t.genders : [];
  const genders: "all" | "men" | "women" =
    g.length === 0
      ? "all"
      : g.includes(1) && g.includes(2)
        ? "all"
        : g.includes(1)
          ? "men"
          : g.includes(2)
            ? "women"
            : "all";

  const geo =
    t.geo_locations && typeof t.geo_locations === "object"
      ? (t.geo_locations as Rec)
      : {};
  const geoCount = [
    ...names(geo.countries),
    ...names(geo.regions),
    ...names(geo.cities),
    ...names(geo.zips),
  ].length;

  const interests = new Set(
    [
      ...nested(t, "interests"),
      ...nested(t, "behaviors"),
      ...nested(t, "life_events"),
      ...nested(t, "industries"),
      ...nested(t, "income"),
      ...nested(t, "family_statuses"),
      ...nested(t, "education_statuses"),
      ...nested(t, "relationship_statuses"),
    ].map((s) => s.toLowerCase())
  );
  const interestCount = interests.size;

  const custom = names(t.custom_audiences);
  const customAudienceCount = custom.length;
  const hasLookalike = custom.some((n) => /look[\s-]?alike|\blal\b/i.test(n));

  const placements = new Set(
    [
      ...names(t.publisher_platforms),
      ...names(t.facebook_positions),
      ...names(t.instagram_positions),
      ...names(t.device_platforms),
      ...names(t.messenger_positions),
      ...names(t.audience_network_positions),
    ].map((s) => s.toLowerCase())
  );
  const placementCount = placements.size;

  // Advantage+ / detailed-targeting expansion: Meta sets these when it's free
  // to deliver beyond the chosen interests. Worth isolating, since a "broad"
  // reading means something different when Meta is optimizing the audience.
  const automation = t.targeting_automation as Rec | undefined;
  const isAdvantage = Boolean(
    (automation && Number(automation.advantage_audience) === 1) ||
      Number(t.targeting_optimization) === 1 ||
      t.targeting_optimization === "expansion_all"
  );

  const audienceType: AudienceType = hasLookalike
    ? "lookalike"
    : customAudienceCount > 0
      ? "custom"
      : interestCount > 0
        ? "interest"
        : "broad";

  return {
    ageMin,
    ageMax,
    ageWidth,
    genders,
    geoCount,
    interestCount,
    customAudienceCount,
    hasLookalike,
    placementCount,
    audienceType,
    isAdvantage,
  };
}
