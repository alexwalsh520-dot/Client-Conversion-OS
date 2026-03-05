// GoHighLevel API helper functions
// All calls go through server-side API routes to keep secrets secure

const GHL_BASE = "https://services.leadconnectorhq.com";

function getHeaders() {
  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) throw new Error("GHL_API_KEY not configured");
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Version: "2021-07-28",
  };
}

function getLocationId() {
  const id = process.env.GHL_LOCATION_ID;
  if (!id) throw new Error("GHL_LOCATION_ID not configured");
  return id;
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
  email: string;
}) {
  const locationId = getLocationId();
  const res = await fetch(`${GHL_BASE}/contacts/`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({
      locationId,
      firstName: data.firstName,
      lastName: data.lastName || "",
      email: data.email,
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
  pipelineId: string,
  stageId: string
) {
  const locationId = getLocationId();
  const res = await fetch(
    `${GHL_BASE}/opportunities/search?location_id=${locationId}&pipeline_id=${pipelineId}&pipeline_stage_id=${stageId}&limit=100`,
    { headers: getHeaders() }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL search opportunities failed (${res.status}): ${text}`);
  }
  return res.json();
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
  const aiPipeline = pipelines.find(
    (p: { name: string }) =>
      p.name.toLowerCase().includes("ai outreach") ||
      p.name.toLowerCase().includes("outreach")
  );
  if (!aiPipeline) {
    throw new Error(
      `No "AI Outreach" pipeline found. Available: ${pipelines.map((p: { name: string }) => p.name).join(", ")}`
    );
  }
  const stages: Record<string, string> = {};
  for (const s of aiPipeline.stages || []) {
    stages[s.name] = s.id;
  }
  return { pipelineId: aiPipeline.id, stages };
}

// ── Pipeline stage counts ──────────────────────────────────────

export async function getPipelineStageCounts() {
  const pipeline = await getAIOutreachPipeline();
  const stageCounts: { name: string; count: number; id: string }[] = [];

  for (const [name, stageId] of Object.entries(pipeline.stages)) {
    try {
      const data = await searchOpportunities(pipeline.pipelineId, stageId);
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
