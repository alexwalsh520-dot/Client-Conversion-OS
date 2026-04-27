export interface SmartleadSegmentRoute {
  segment: string;
  campaignId: string;
  campaignName?: string;
}

export interface SegmentCount {
  segment: string;
  segment_key: string;
  count: number;
}

export interface SmartleadCampaignSummary {
  campaign_id: string;
  campaign_name?: string;
  segment: string;
  segment_key: string;
  leads_added: number;
}

export function normalizeSegmentKey(value?: string | null) {
  return (value || "")
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function getSegmentLabel(value?: string | null) {
  return value?.trim() || "Unmapped";
}

export function buildSegmentTag(value?: string | null) {
  const key = normalizeSegmentKey(value) || "unmapped";
  return `segment-${key.replace(/_/g, "-")}`;
}

export function findSegmentRoute(
  segment: string | null | undefined,
  routes: SmartleadSegmentRoute[]
) {
  const segmentKey = normalizeSegmentKey(segment);
  if (!segmentKey) return null;

  return (
    routes.find(
      (route) =>
        normalizeSegmentKey(route.segment) === segmentKey &&
        route.campaignId.trim()
    ) || null
  );
}

export function summarizeSegments<T>(
  items: T[],
  getSegment: (item: T) => string | null | undefined
) {
  const map = new Map<string, SegmentCount>();

  for (const item of items) {
    const segment = getSegmentLabel(getSegment(item));
    const segmentKey = normalizeSegmentKey(segment) || "unmapped";
    const existing = map.get(segmentKey);

    if (existing) {
      existing.count += 1;
    } else {
      map.set(segmentKey, {
        segment,
        segment_key: segmentKey,
        count: 1,
      });
    }
  }

  return Array.from(map.values()).sort((a, b) =>
    a.segment.localeCompare(b.segment)
  );
}
