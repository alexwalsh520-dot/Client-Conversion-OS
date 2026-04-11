// GoHighLevel API helper functions
// All calls go through server-side API routes to keep secrets secure

const GHL_BASE = "https://services.leadconnectorhq.com";
const DEFAULT_OUTREACH_PIPELINE_NAME = "AI Outreach";

function normalizeLabel(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function getHeaders() {
  const apiKey = process.env.OUTREACH_GHL_API_KEY || process.env.GHL_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OUTREACH_GHL_API_KEY or GHL_API_KEY not configured"
    );
  }
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

function getLocationId() {
  const id =
    process.env.OUTREACH_GHL_LOCATION_ID || process.env.GHL_LOCATION_ID;
  if (!id) {
    throw new Error(
      "OUTREACH_GHL_LOCATION_ID or GHL_LOCATION_ID not configured"
    );
  }
  return id;
}

function getPipelineName() {
  return (
    process.env.OUTREACH_GHL_PIPELINE_NAME?.trim() ||
    DEFAULT_OUTREACH_PIPELINE_NAME
  );
}

// ── Contact operations ─────────────────────────────────────────

export async function searchDuplicateContact(email: string) {
  const locationId = getLocationId();
  const res = await fetch(
    `${GHL_BASE}/contacts/search/duplicate?email=${encodeURIComponent(email)}&locationId=${locationId}`,
    { headers: getHeaders() }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL search duplicate failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function createContact(data: {
  firstName: string;
  lastName?: string;
  email?: string;
}) {
  const locationId = getLocationId();
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      locationId,
      firstName: data.firstName,
      lastName: data.lastName || "",
      ...(data.email ? { email: data.email } : {}),
      source: "Dashboard Import",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL create contact failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function addContactNote(
  contactId: string,
  body: string
) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL add note failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getContact(contactId: string) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL get contact failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getContactNotes(contactId: string) {
  const res = await fetch(`${GHL_BASE}/contacts/${contactId}/notes`, {
    headers: getHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL get notes failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Pipeline operations ────────────────────────────────────────

export async function getPipelines() {
  const locationId = getLocationId();
  const res = await fetch(
    `${GHL_BASE}/opportunities/pipelines?locationId=${locationId}`,
    { headers: getHeaders() }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL get pipelines failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function createOpportunity(data: {
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
  name: string;
}) {
  const locationId = getLocationId();
  const res = await fetch(`${GHL_BASE}/opportunities/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      pipelineId: data.pipelineId,
      pipelineStageId: data.pipelineStageId,
      locationId,
      contactId: data.contactId,
      name: data.name,
      status: "open",
      source: "Dashboard Import",
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL create opportunity failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function searchOpportunities(
  filters: {
    pipelineId?: string;
    stageId?: string;
    contactId?: string;
    limit?: number;
  } = {}
) {
  const locationId = getLocationId();
  const query = new URLSearchParams({
    location_id: locationId,
    limit: String(filters.limit || 100),
  });
  if (filters.pipelineId) query.set("pipeline_id", filters.pipelineId);
  if (filters.stageId) query.set("pipeline_stage_id", filters.stageId);
  if (filters.contactId) query.set("contact_id", filters.contactId);
  const res = await fetch(
    `${GHL_BASE}/opportunities/search?${query.toString()}`,
    { headers: getHeaders() }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL search opportunities failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function searchContactOpportunities(
  contactId: string,
  pipelineId?: string
) {
  const data = await searchOpportunities({ contactId, pipelineId });
  const opportunities = (data.opportunities || []).filter(
    (opp: {
      pipelineId?: string;
      pipeline?: { id?: string };
    }) =>
      !pipelineId ||
      opp.pipelineId === pipelineId ||
      opp.pipeline?.id === pipelineId
  );
  return { ...data, opportunities };
}

export async function updateOpportunity(
  opportunityId: string,
  data: { pipelineStageId: string }
) {
  const res = await fetch(`${GHL_BASE}/opportunities/${opportunityId}`, {
    method: "PUT",
    headers: getHeaders(),
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL update opportunity failed (${res.status}): ${text}`);
  }
  return res.json();
}

// ── Pipeline helper: find AI Outreach pipeline + stages ────────

export interface PipelineInfo {
  pipelineId: string;
  stages: Record<string, string>; // stage name → stage ID
}

export async function getAIOutreachPipeline(): Promise<PipelineInfo> {
  const data = await getPipelines();
  const pipelines = data.pipelines || [];
  const pipelineName = getPipelineName();
  const normalizedTarget = normalizeLabel(pipelineName);
  const exactMatch = pipelines.find(
    (p: { name: string }) => normalizeLabel(p.name) === normalizedTarget
  );
  const partialMatches = pipelines.filter(
    (p: { name: string }) =>
      normalizeLabel(p.name).includes(normalizedTarget) ||
      normalizedTarget.includes(normalizeLabel(p.name))
  );
  const aiPipeline =
    exactMatch || (partialMatches.length === 1 ? partialMatches[0] : null);
  if (!aiPipeline) {
    throw new Error(
      `No "${pipelineName}" pipeline found for Outreach. Available: ${pipelines.map((p: { name: string }) => p.name).join(", ")}`
    );
  }
  const stages: Record<string, string> = {};
  for (const s of aiPipeline.stages || []) {
    stages[s.name] = s.id;
  }
  return { pipelineId: aiPipeline.id, stages };
}

export function findStageId(
  stages: Record<string, string>,
  preferredNames: string[]
) {
  const entries = Object.entries(stages);

  for (const preferredName of preferredNames) {
    const exact = entries.find(
      ([name]) => normalizeLabel(name) === normalizeLabel(preferredName)
    );
    if (exact) return exact[1];
  }

  for (const preferredName of preferredNames) {
    const partial = entries.find(([name]) =>
      normalizeLabel(name).includes(normalizeLabel(preferredName))
    );
    if (partial) return partial[1];
  }

  return null;
}

// ── Pipeline stage counts ──────────────────────────────────────

export async function getPipelineStageCounts() {
  const pipeline = await getAIOutreachPipeline();
  const stageCounts: { name: string; count: number; id: string }[] = [];

  for (const [name, stageId] of Object.entries(pipeline.stages)) {
    try {
      const data = await searchOpportunities({
        pipelineId: pipeline.pipelineId,
        stageId,
      });
      // Use meta.total for accurate count (searchOpportunities only returns up to 100)
      const count = data.meta?.total ?? (data.opportunities || []).length;
      stageCounts.push({ name, count, id: stageId });
    } catch {
      stageCounts.push({ name, count: 0, id: stageId });
    }
  }

  const total = stageCounts.reduce((sum, s) => sum + s.count, 0);
  return { stages: stageCounts, total, pipelineId: pipeline.pipelineId };
}
