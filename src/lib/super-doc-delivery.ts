import {
  addContactNote,
  addContactTags,
  createContact,
  createOpportunity,
  findStageId,
  getAIOutreachPipeline,
  searchContactOpportunities,
  searchDuplicateContact,
  updateOpportunity,
} from "./ghl";
import { addLeadsToCampaign } from "./smartlead";
import { capitalizeNamePart, formatFullName } from "./super-doc-name";
import {
  buildSuperDocRoutePlan,
  getInstagramUrl,
  getSmartleadCampaignForSegment,
  getSuperDocSegment,
  normalizeInstagramHandle,
  type SuperDocRouteLead,
  type SuperDocRoutePlan,
} from "./super-doc-routing";

type UnknownRecord = Record<string, unknown>;

export interface SuperDocDeliveryResult {
  testMode: boolean;
  emailUsed: string;
  originalEmail: string;
  segment: string;
  routePlan: SuperDocRoutePlan;
  ghl: {
    contactId: string;
    contactCreated: boolean;
    opportunityId: string;
    opportunityCreated: boolean;
    stageName: string;
    pipelineName: string;
  };
  smartlead: {
    campaignEnv: string;
    campaignId: string;
    added: boolean;
    customFields: Record<string, string>;
  };
}

function clean(value?: string | null) {
  return (value || "").trim();
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === "object" ? (value as UnknownRecord) : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nestedString(value: unknown, path: string[]) {
  let current: unknown = value;
  for (const part of path) {
    const record = asRecord(current);
    if (!record) return null;
    current = record[part];
  }
  return readString(current);
}

function firstArrayRecord(value: unknown, key: string) {
  const record = asRecord(value);
  const items = record?.[key];
  return Array.isArray(items) ? asRecord(items[0]) : null;
}

function extractContactId(value: unknown) {
  return (
    nestedString(value, ["contact", "id"]) ||
    nestedString(value, ["duplicateContact", "id"]) ||
    nestedString(value, ["id"]) ||
    nestedString(firstArrayRecord(value, "contacts"), ["id"]) ||
    nestedString(firstArrayRecord(value, "contact"), ["id"])
  );
}

function extractOpportunityId(value: unknown) {
  return (
    nestedString(value, ["opportunity", "id"]) ||
    nestedString(value, ["id"]) ||
    nestedString(firstArrayRecord(value, "opportunities"), ["id"])
  );
}

function extractOpportunities(value: unknown): UnknownRecord[] {
  const record = asRecord(value);
  const items = record?.opportunities;
  return Array.isArray(items)
    ? items.map(asRecord).filter((item): item is UnknownRecord => Boolean(item))
    : [];
}

function getOpportunityStageId(opp: UnknownRecord) {
  return (
    readString(opp.pipelineStageId) ||
    nestedString(opp.pipelineStage, ["id"]) ||
    readString(opp.stageId)
  );
}

function unique(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function readListEnv(name: string, fallback: string[]) {
  const values = (process.env[name] || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  return values.length > 0 ? unique(values) : fallback;
}

function slugPart(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function makeDummyEmail(lead: SuperDocRouteLead, runId?: string) {
  const domain = clean(process.env.SUPER_DOC_TEST_EMAIL_DOMAIN) || "example.com";
  const namePart = slugPart(formatFullName(lead.first_name, lead.last_name)) || "lead";
  const runPart = slugPart(runId || "").slice(0, 8) || String(Date.now()).slice(-8);
  return `ccos-test+${namePart}-${runPart}@${domain}`;
}

function resolveDeliveryEmail(input: {
  lead: SuperDocRouteLead;
  testMode: boolean;
  runId?: string;
}) {
  const originalEmail = clean(input.lead.email).toLowerCase();
  if (input.testMode) {
    return {
      emailUsed: makeDummyEmail(input.lead, input.runId),
      originalEmail,
    };
  }

  if (!originalEmail) {
    throw new Error("Lead is missing an email address");
  }

  return {
    emailUsed: originalEmail,
    originalEmail,
  };
}

function buildSmartleadCustomFields(input: {
  lead: SuperDocRouteLead;
  pageUrl: string;
  videoUrl: string;
  emailUsed: string;
  originalEmail: string;
  testMode: boolean;
}) {
  const firstName = capitalizeNamePart(input.lead.first_name);
  const instagramHandle = normalizeInstagramHandle(input.lead.instagram_handle);
  const instagramUrl = getInstagramUrl(input.lead);
  const firstNameFields = readListEnv("SMARTLEAD_FIRST_NAME_CUSTOM_FIELDS", [
    "first_name",
    "first_name_2",
  ]);

  const fields: Record<string, string> = {
    super_doc_url: input.pageUrl,
    custom_doc_url: input.pageUrl,
    personalized_doc_url: input.pageUrl,
    video_url: input.videoUrl,
    lead_type: clean(input.lead.lead_type),
    segment: getSuperDocSegment(input.lead.lead_type),
    instagram_handle: instagramHandle,
    instagram_url: instagramUrl,
  };

  for (const fieldName of firstNameFields) {
    fields[fieldName] = firstName;
  }

  if (!input.testMode && input.originalEmail && input.originalEmail !== input.emailUsed) {
    fields.original_email = input.originalEmail;
  }

  return fields;
}

function buildGhlNote(input: {
  routePlan: SuperDocRoutePlan;
  emailUsed: string;
  originalEmail: string;
  testMode: boolean;
}) {
  return [
    input.routePlan.ghl.note,
    input.testMode ? `Test Email Used - ${input.emailUsed}` : "",
    !input.testMode && input.originalEmail && input.originalEmail !== input.emailUsed
      ? `Original Email - ${input.originalEmail}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export async function deliverSuperDocLead(input: {
  lead: SuperDocRouteLead;
  pageUrl: string;
  videoUrl: string;
  runId?: string;
  testMode?: boolean;
}): Promise<SuperDocDeliveryResult> {
  const testMode = input.testMode !== false;
  const firstName = capitalizeNamePart(input.lead.first_name);
  const lastName = capitalizeNamePart(input.lead.last_name);
  const { emailUsed, originalEmail } = resolveDeliveryEmail({
    lead: input.lead,
    testMode,
    runId: input.runId,
  });

  const deliveryLead = {
    ...input.lead,
    first_name: firstName,
    last_name: lastName,
    email: emailUsed,
  };
  const routePlan = buildSuperDocRoutePlan({
    lead: deliveryLead,
    pageUrl: input.pageUrl,
    videoUrl: input.videoUrl,
  });

  if (routePlan.missingEnv.length > 0) {
    throw new Error(`Missing routing keys: ${routePlan.missingEnv.join(", ")}`);
  }

  const pipeline = await getAIOutreachPipeline();
  const contactedStageId = findStageId(pipeline.stages, [
    routePlan.ghl.stageName,
    "Contacted",
    "In Contact (Contacted)",
    "In Contact",
  ]);

  if (!contactedStageId) {
    throw new Error('No "Contacted" stage found in the AI Outreach pipeline');
  }

  const tags = unique([
    ...routePlan.ghl.tags,
    "auto-outreach-test",
    testMode ? "super-doc-test" : "super-doc-live",
  ]);

  const duplicate = await searchDuplicateContact(emailUsed);
  let contactId = extractContactId(duplicate);
  let contactCreated = false;

  if (!contactId) {
    const created = await createContact({
      firstName,
      lastName,
      email: emailUsed,
      tags,
    });
    contactId = extractContactId(created);
    contactCreated = true;
  } else {
    await addContactTags(contactId, tags);
  }

  if (!contactId) {
    throw new Error("GHL did not return a contact ID");
  }

  await addContactNote(
    contactId,
    buildGhlNote({ routePlan, emailUsed, originalEmail, testMode }),
  );

  const oppData = await searchContactOpportunities(contactId, pipeline.pipelineId);
  const opportunities = extractOpportunities(oppData);
  const existingOpp = opportunities[0] || null;
  let opportunityId = existingOpp ? extractOpportunityId(existingOpp) : null;
  let opportunityCreated = false;

  if (existingOpp && opportunityId) {
    if (getOpportunityStageId(existingOpp) !== contactedStageId) {
      await updateOpportunity(opportunityId, { pipelineStageId: contactedStageId });
    }
  } else {
    const createdOpp = await createOpportunity({
      pipelineId: pipeline.pipelineId,
      pipelineStageId: contactedStageId,
      contactId,
      name: formatFullName(firstName, lastName) || emailUsed,
    });
    opportunityId = extractOpportunityId(createdOpp);
    opportunityCreated = true;
  }

  if (!opportunityId) {
    throw new Error("GHL did not return an opportunity ID");
  }

  const campaign = getSmartleadCampaignForSegment(routePlan.segment);
  if (!campaign.value) {
    throw new Error(`Missing Smartlead campaign ID: ${campaign.name}`);
  }

  const customFields = buildSmartleadCustomFields({
    lead: input.lead,
    pageUrl: input.pageUrl,
    videoUrl: input.videoUrl,
    emailUsed,
    originalEmail,
    testMode,
  });

  await addLeadsToCampaign(
    [
      {
        email: emailUsed,
        first_name: firstName,
        custom_fields: customFields,
      },
    ],
    campaign.value,
  );

  return {
    testMode,
    emailUsed,
    originalEmail,
    segment: routePlan.segment,
    routePlan,
    ghl: {
      contactId,
      contactCreated,
      opportunityId,
      opportunityCreated,
      stageName: routePlan.ghl.stageName,
      pipelineName: routePlan.ghl.pipelineName,
    },
    smartlead: {
      campaignEnv: campaign.name,
      campaignId: campaign.value,
      added: true,
      customFields,
    },
  };
}
