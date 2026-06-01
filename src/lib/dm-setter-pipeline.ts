import { syncManychatEventToGhl } from "@/lib/ghl-dm-sync";
import { isFollowupQueueTag } from "@/lib/meta-business-suite";

const GHL_BASE = "https://services.leadconnectorhq.com";
const GHL_VERSION = "2021-07-28";

export interface DmSetterWebhookPayload {
  client: string;
  subscriberId: string;
  firstName?: string | null;
  lastName?: string | null;
  fullName?: string | null;
  email?: string | null;
  instagramHandle?: string | null;
  tagName?: string | null;
  setterName?: string | null;
  manychatInboxUrl?: string | null;
  instagramProfileUrl?: string | null;
  metaBusinessSuiteUrl?: string | null;
  metaThreadId?: string | null;
  metaAssetId?: string | null;
  metaMailboxId?: string | null;
  metaBusinessId?: string | null;
  source?: string | null;
  clientName?: string | null;
  eventAt?: string | null;
}

interface GhlPipeline {
  id: string;
  name: string;
  stages?: Array<{ id: string; name: string }>;
}

interface GhlOpportunity {
  id: string;
  name?: string | null;
  pipelineId?: string | null;
  pipelineStageId?: string | null;
  status?: string | null;
}

function clean(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed || null;
}

function normalizeLabel(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => clean(value)).filter(Boolean) as string[])];
}

function getHeaders(): Record<string, string> {
  const apiKey =
    process.env.DM_SETTER_GHL_API_KEY?.trim() ||
    process.env.GHL_API_KEY?.trim();
  if (!apiKey) throw new Error("DM_SETTER_GHL_API_KEY or GHL_API_KEY not configured");

  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    Version: GHL_VERSION,
  };
}

function getLocationId() {
  const locationId =
    process.env.DM_SETTER_GHL_LOCATION_ID?.trim() ||
    process.env.GHL_LOCATION_ID?.trim();
  if (!locationId) throw new Error("DM_SETTER_GHL_LOCATION_ID or GHL_LOCATION_ID not configured");
  return locationId;
}

function getPipelineName() {
  return (
    process.env.DM_SETTER_GHL_PIPELINE_NAME?.trim() ||
    process.env.GHL_DM_SETTER_PIPELINE_NAME?.trim() ||
    "DM Setter Pipeline"
  );
}

function getActiveStageNames() {
  return uniqueStrings([
    process.env.DM_SETTER_GHL_ACTIVE_STAGE_NAME,
    "Active",
    "Follow Up Queue",
    "Follow Up",
    "New Lead",
  ]);
}

async function ghlFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${GHL_BASE}${path}`, {
    ...init,
    headers: {
      ...getHeaders(),
      ...(init?.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GHL request failed (${res.status}) ${path}: ${text}`);
  }

  if (res.status === 204) return {} as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

async function getPipelines() {
  const locationId = getLocationId();
  return ghlFetch<{ pipelines?: GhlPipeline[] }>(
    `/opportunities/pipelines?locationId=${encodeURIComponent(locationId)}`,
  );
}

function findPipeline(pipelines: GhlPipeline[], wantedName: string) {
  const wanted = normalizeLabel(wantedName);
  const exact = pipelines.find((pipeline) => normalizeLabel(pipeline.name) === wanted);
  if (exact) return exact;

  const partial = pipelines.filter((pipeline) => {
    const name = normalizeLabel(pipeline.name);
    return name.includes(wanted) || wanted.includes(name);
  });

  return partial.length === 1 ? partial[0] : null;
}

function findStage(pipeline: GhlPipeline, preferredNames: string[]) {
  const stages = pipeline.stages || [];

  for (const preferredName of preferredNames) {
    const preferred = normalizeLabel(preferredName);
    const exact = stages.find((stage) => normalizeLabel(stage.name) === preferred);
    if (exact) return exact;
  }

  for (const preferredName of preferredNames) {
    const preferred = normalizeLabel(preferredName);
    const partial = stages.find((stage) => normalizeLabel(stage.name).includes(preferred));
    if (partial) return partial;
  }

  return null;
}

async function getDmSetterPipeline() {
  const response = await getPipelines();
  const pipelines = response.pipelines || [];
  const pipelineName = getPipelineName();
  const pipeline = findPipeline(pipelines, pipelineName);

  if (!pipeline) {
    throw new Error(
      `No "${pipelineName}" pipeline found. Available pipelines: ${pipelines
        .map((item) => item.name)
        .join(", ")}`,
    );
  }

  const activeStage = findStage(pipeline, getActiveStageNames());
  if (!activeStage) {
    throw new Error(
      `No active stage found in "${pipeline.name}". Available stages: ${(pipeline.stages || [])
        .map((item) => item.name)
        .join(", ")}`,
    );
  }

  return { pipeline, activeStage };
}

async function searchOpportunities(
  contactId: string,
  pipelineId: string,
  status: "open" | "all" = "open",
) {
  const params = new URLSearchParams({
    location_id: getLocationId(),
    contact_id: contactId,
    pipeline_id: pipelineId,
    status,
    limit: "100",
  });

  return ghlFetch<{ opportunities?: GhlOpportunity[] }>(
    `/opportunities/search?${params.toString()}`,
  );
}

function isOpenOpportunity(opportunity: GhlOpportunity) {
  const status = opportunity.status?.trim().toLowerCase();
  return !status || status === "open";
}

async function updateOpportunityStage(
  opportunityId: string,
  pipelineStageId: string,
  source: string,
) {
  return ghlFetch(`/opportunities/${opportunityId}`, {
    method: "PUT",
    body: JSON.stringify({ pipelineStageId, source }),
  });
}

async function createOpportunity(params: {
  contactId: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  source: string;
}) {
  return ghlFetch<{ opportunity?: GhlOpportunity; id?: string }>(`/opportunities/`, {
    method: "POST",
    body: JSON.stringify({
      locationId: getLocationId(),
      contactId: params.contactId,
      name: params.name,
      pipelineId: params.pipelineId,
      pipelineStageId: params.pipelineStageId,
      status: "open",
      source: params.source,
    }),
  });
}

async function deleteOpportunity(opportunityId: string) {
  return ghlFetch(`/opportunities/${opportunityId}`, {
    method: "DELETE",
  });
}

function displayName(payload: DmSetterWebhookPayload) {
  const fullName = clean(payload.fullName);
  if (fullName) return fullName;

  const joined = [payload.firstName, payload.lastName].map(clean).filter(Boolean).join(" ");
  if (joined) return joined;

  const handle = clean(payload.instagramHandle)?.replace(/^@/, "");
  if (handle) return `@${handle}`;

  return `ManyChat ${payload.subscriberId.slice(-6)}`;
}

function clientDisplayName(payload: DmSetterWebhookPayload, fallback: string) {
  return clean(payload.clientName) || fallback;
}

function opportunitySource(payload: DmSetterWebhookPayload, fallbackClientLabel: string) {
  return clean(payload.source) || `Manychat - ${clientDisplayName(payload, fallbackClientLabel)}`;
}

async function syncContact(payload: DmSetterWebhookPayload, tagName: string) {
  return syncManychatEventToGhl({
    subscriberId: payload.subscriberId,
    firstName: payload.firstName || payload.fullName || null,
    lastName: payload.lastName || null,
    email: payload.email || null,
    instagramHandle: payload.instagramHandle || null,
    instagramProfileUrl: payload.instagramProfileUrl || null,
    manychatInboxUrl: payload.manychatInboxUrl || null,
    metaBusinessSuiteUrl: payload.metaBusinessSuiteUrl || null,
    metaThreadId: payload.metaThreadId || null,
    metaAssetId: payload.metaAssetId || null,
    metaMailboxId: payload.metaMailboxId || null,
    metaBusinessId: payload.metaBusinessId || null,
    tagName,
    client: payload.client,
    setterName: payload.setterName || null,
    eventAt: payload.eventAt || new Date().toISOString(),
  });
}

export async function addLeadToDmSetterPipeline(payload: DmSetterWebhookPayload) {
  const tagName = clean(payload.tagName) || "Follow Up Queue";
  if (!isFollowupQueueTag(tagName)) {
    throw new Error(`Tag "${tagName}" is not a follow-up queue tag`);
  }

  const sync = await syncContact(payload, tagName);
  const source = opportunitySource(payload, sync.clientLabel);

  const { pipeline, activeStage } = await getDmSetterPipeline();
  const existingResponse = await searchOpportunities(sync.contactId, pipeline.id, "open");
  const openOpportunities = (existingResponse.opportunities || []).filter(isOpenOpportunity);
  const primary = openOpportunities[0];

  if (primary) {
    if (primary.pipelineStageId !== activeStage.id) {
      await updateOpportunityStage(primary.id, activeStage.id, source);
    }

    return {
      action: "updated_existing",
      client: sync.clientKey,
      contactId: sync.contactId,
      opportunityId: primary.id,
      duplicateOpenOpportunities: Math.max(openOpportunities.length - 1, 0),
      pipelineName: pipeline.name,
      stageName: activeStage.name,
    };
  }

  const created = await createOpportunity({
    contactId: sync.contactId,
    name: `${displayName(payload)} - ${clientDisplayName(payload, sync.clientLabel)} Follow Up`,
    pipelineId: pipeline.id,
    pipelineStageId: activeStage.id,
    source,
  });

  return {
    action: "created",
    client: sync.clientKey,
    contactId: sync.contactId,
    opportunityId: created.opportunity?.id || created.id || null,
    duplicateOpenOpportunities: 0,
    pipelineName: pipeline.name,
    stageName: activeStage.name,
  };
}

export async function removeLeadFromDmSetterPipeline(payload: DmSetterWebhookPayload) {
  const sync = await syncContact(payload, clean(payload.tagName) || "lead_replied");

  const { pipeline } = await getDmSetterPipeline();
  const existingResponse = await searchOpportunities(sync.contactId, pipeline.id, "all");
  const opportunities = existingResponse.opportunities || [];

  const deleted: string[] = [];
  for (const opportunity of opportunities) {
    await deleteOpportunity(opportunity.id);
    deleted.push(opportunity.id);
  }

  return {
    action: "removed",
    client: sync.clientKey,
    contactId: sync.contactId,
    opportunitiesDeleted: deleted.length,
    opportunityIds: deleted,
    pipelineName: pipeline.name,
  };
}

export async function checkDmSetterPipelineConfig() {
  const { pipeline, activeStage } = await getDmSetterPipeline();

  return {
    pipelineName: pipeline.name,
    pipelineId: pipeline.id,
    stageName: activeStage.name,
    stageId: activeStage.id,
  };
}
