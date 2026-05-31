export type StudioSuggestionStatus = "ready" | "opened" | "used" | "dismissed" | "failed";

export type StudioSuggestionSourceRef = {
  source: "ads_tracker" | "meta" | "manual" | "copy_lab" | "unknown";
  id: string;
  label?: string;
  url?: string;
  spend?: number;
  metadata?: Record<string, unknown>;
};

export type StudioSuggestionReasoning = {
  headline?: string;
  whyThisShouldWork?: string[];
  sourcePattern?: string;
  offerRead?: string;
  creativeDirection?: string;
  copyDirection?: string;
  risks?: string[];
  nextStep?: string;
  confidence?: number;
};

export type StudioSuggestionPayload = {
  id: string;
  sourceKey: string;
  clientKey: string | null;
  title: string;
  summary: string;
  offerType: string | null;
  status: StudioSuggestionStatus;
  score: number;
  sourceRefs: StudioSuggestionSourceRef[];
  inputSnapshot: Record<string, unknown>;
  reasoning: StudioSuggestionReasoning;
  copyText: string;
  draft: Record<string, unknown>;
  thumbnailUrl: string | null;
  projectId: string | null;
  generatedAt: string | null;
  createdAt: string | null;
  updatedAt: string | null;
};

export type StudioSuggestionRow = {
  id: string;
  source_key: string | null;
  client_key: string | null;
  title: string | null;
  summary: string | null;
  offer_type: string | null;
  status: string | null;
  score: number | null;
  source_refs: unknown;
  input_snapshot: unknown;
  reasoning: unknown;
  copy_text: string | null;
  draft: unknown;
  thumbnail_url: string | null;
  project_id: string | null;
  generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export const STUDIO_SUGGESTIONS_MISSING_TABLE_MESSAGE =
  "Studio suggestions need the studio2_suggested_ads Supabase table before they can save.";

export function normalizeSuggestionStatus(status: unknown): StudioSuggestionStatus {
  const value = String(status || "").toLowerCase();
  if (["opened", "used", "dismissed", "failed"].includes(value)) return value as StudioSuggestionStatus;
  return "ready";
}

export function isMissingSuggestionsTableError(message?: string | null) {
  const value = String(message || "").toLowerCase();
  return value.includes("studio2_suggested_ads") && (value.includes("schema cache") || value.includes("does not exist"));
}

export function mapSuggestionRow(row: StudioSuggestionRow): StudioSuggestionPayload {
  return {
    id: row.id,
    sourceKey: row.source_key || row.id,
    clientKey: row.client_key || null,
    title: row.title || "Suggested ad",
    summary: row.summary || "",
    offerType: row.offer_type || null,
    status: normalizeSuggestionStatus(row.status),
    score: Number(row.score || 0),
    sourceRefs: Array.isArray(row.source_refs) ? row.source_refs as StudioSuggestionSourceRef[] : [],
    inputSnapshot: isRecord(row.input_snapshot) ? row.input_snapshot : {},
    reasoning: isRecord(row.reasoning) ? row.reasoning as StudioSuggestionReasoning : {},
    copyText: row.copy_text || "",
    draft: isRecord(row.draft) ? row.draft : {},
    thumbnailUrl: row.thumbnail_url || null,
    projectId: row.project_id || null,
    generatedAt: row.generated_at || null,
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

export function buildSuggestionInsert(body: Record<string, unknown>) {
  const sourceKey = String(body.sourceKey || body.source_key || `manual:${crypto.randomUUID()}`).trim();
  const title = String(body.title || "Suggested ad").trim() || "Suggested ad";
  const summary = String(body.summary || "").trim();
  const copyText = String(body.copyText || body.copy_text || "").trim();
  const now = new Date().toISOString();

  return {
    source_key: sourceKey,
    client_key: cleanNullableString(body.clientKey || body.client_key),
    title,
    summary,
    offer_type: cleanNullableString(body.offerType || body.offer_type),
    status: normalizeSuggestionStatus(body.status),
    score: clampScore(body.score),
    source_refs: Array.isArray(body.sourceRefs) ? body.sourceRefs : Array.isArray(body.source_refs) ? body.source_refs : [],
    input_snapshot: isRecord(body.inputSnapshot) ? body.inputSnapshot : isRecord(body.input_snapshot) ? body.input_snapshot : {},
    reasoning: isRecord(body.reasoning) ? body.reasoning : {},
    copy_text: copyText,
    draft: isRecord(body.draft) ? body.draft : {},
    thumbnail_url: cleanNullableString(body.thumbnailUrl || body.thumbnail_url),
    project_id: cleanNullableString(body.projectId || body.project_id),
    generated_at: cleanNullableString(body.generatedAt || body.generated_at) || now,
    updated_at: now,
  };
}

export function buildProjectFromSuggestion(suggestion: StudioSuggestionPayload) {
  const draft = suggestion.draft && Object.keys(suggestion.draft).length > 0
    ? suggestion.draft
    : {
        version: 2,
        savedAt: Date.now(),
        photos: suggestion.thumbnailUrl ? [suggestion.thumbnailUrl] : [],
        creatives: [],
        currentIndex: 0,
        copyText: suggestion.copyText,
        projectName: suggestion.title,
        colorPreset: "dark",
        fontPreset: "inter",
        view: "setup",
      };

  return {
    name: suggestion.title || "Suggested ad",
    copy_text: suggestion.copyText,
    draft,
    thumbnail_url: suggestion.thumbnailUrl,
    status: "in_progress",
    updated_at: new Date().toISOString(),
  };
}

function cleanNullableString(value: unknown) {
  const cleaned = String(value || "").trim();
  return cleaned || null;
}

function clampScore(value: unknown) {
  const score = Number(value || 0);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
