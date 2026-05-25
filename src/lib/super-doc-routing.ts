import { capitalizeNamePart, formatFullName } from "./super-doc-name";

export type SuperDocSegment = "creator" | "agency_tm" | "unknown";

export interface SuperDocRouteLead {
  first_name: string;
  last_name?: string;
  email: string;
  lead_type: string;
  instagram_handle?: string;
  instagram_url?: string;
}

export interface SuperDocRoutePlan {
  dryRun: boolean;
  segment: SuperDocSegment;
  leadType: string;
  missingEnv: string[];
  ghl: {
    action: "create_or_update_contact_and_opportunity";
    locationEnv: string;
    pipelineName: string;
    stageName: string;
    tags: string[];
    contact: {
      firstName: string;
      lastName: string;
      email: string;
      source: string;
    };
    opportunity: {
      name: string;
      source: string;
      status: "open";
    };
    note: string;
  };
  smartlead: {
    action: "add_to_campaign";
    campaignEnv: string;
    campaignId: string | null;
    customFields: Record<string, string>;
  };
}

function clean(value?: string | null) {
  return (value || "").trim();
}

export function normalizeInstagramHandle(value?: string | null) {
  return clean(value)
    .replace(/^@/, "")
    .replace(/^https?:\/\/(www\.)?instagram\.com\//i, "")
    .split(/[/?#]/)[0]
    .trim();
}

export function getInstagramUrl(lead: SuperDocRouteLead) {
  const explicit = clean(lead.instagram_url);
  if (explicit) return explicit;

  const handle = normalizeInstagramHandle(lead.instagram_handle);
  return handle ? `https://instagram.com/${handle}` : "";
}

export function getSuperDocSegment(leadType: string): SuperDocSegment {
  const normalized = clean(leadType).toLowerCase().replace(/[^a-z0-9]+/g, "_");

  if (
    [
      "creator",
      "solo_creator",
      "solo",
      "influencer",
      "talent",
    ].includes(normalized)
  ) {
    return "creator";
  }

  if (
    [
      "agency",
      "agency_tm",
      "agency_talent_manager",
      "talent_manager",
      "tm",
      "manager",
    ].includes(normalized)
  ) {
    return "agency_tm";
  }

  return "unknown";
}

function readEnv(names: string[]) {
  for (const name of names) {
    const value = clean(process.env[name]);
    if (value) return { name, value };
  }
  return { name: names[0], value: "" };
}

export function getSmartleadCampaignForSegment(segment: SuperDocSegment) {
  if (segment === "agency_tm") {
    return readEnv([
      "SMARTLEAD_AGENCY_TM_CAMPAIGN_ID",
      "SMARTLEAD_AGENCY_CAMPAIGN_ID",
    ]);
  }

  if (segment === "creator") {
    return readEnv([
      "SMARTLEAD_CREATOR_CAMPAIGN_ID",
      "SMARTLEAD_SOLO_CREATOR_CAMPAIGN_ID",
      "SMARTLEAD_CAMPAIGN_ID",
    ]);
  }

  return readEnv(["SMARTLEAD_CAMPAIGN_ID"]);
}

export function buildSuperDocRoutePlan(input: {
  lead: SuperDocRouteLead;
  pageUrl: string;
  videoUrl: string;
  dryRun?: boolean;
}): SuperDocRoutePlan {
  const { lead, pageUrl, videoUrl } = input;
  const segment = getSuperDocSegment(lead.lead_type);
  const smartleadCampaign = getSmartleadCampaignForSegment(segment);
  const ghlKey = readEnv(["OUTREACH_GHL_API_KEY", "GHL_API_KEY"]);
  const ghlLocation = readEnv(["OUTREACH_GHL_LOCATION_ID", "GHL_LOCATION_ID"]);
  const smartleadKey = readEnv(["SMARTLEAD_API_KEY"]);
  const missingEnv: string[] = [];

  if (!ghlKey.value) missingEnv.push(ghlKey.name);
  if (!ghlLocation.value) missingEnv.push(ghlLocation.name);
  if (!smartleadKey.value) missingEnv.push(smartleadKey.name);
  if (!smartleadCampaign.value) missingEnv.push(smartleadCampaign.name);

  const firstName = capitalizeNamePart(lead.first_name);
  const lastName = capitalizeNamePart(lead.last_name);
  const email = clean(lead.email);
  const instagramHandle = normalizeInstagramHandle(lead.instagram_handle);
  const instagramUrl = getInstagramUrl(lead);
  const fullName = formatFullName(firstName, lastName) || email || "Super Doc Lead";

  return {
    dryRun: input.dryRun ?? false,
    segment,
    leadType: clean(lead.lead_type),
    missingEnv,
    ghl: {
      action: "create_or_update_contact_and_opportunity",
      locationEnv: ghlLocation.name,
      pipelineName: clean(process.env.OUTREACH_GHL_PIPELINE_NAME) || "AI Outreach",
      stageName: clean(process.env.SUPER_DOC_GHL_STAGE_NAME) || "Contacted",
      tags: [
        "super-doc",
        `super-doc-${segment.replace("_", "-")}`,
      ],
      contact: {
        firstName,
        lastName,
        email,
        source: "Super Doc Outreach",
      },
      opportunity: {
        name: fullName,
        source: "Super Doc Outreach",
        status: "open",
      },
      note: [
        `Super Doc URL - ${pageUrl}`,
        `Video URL - ${videoUrl}`,
        instagramHandle ? `IG - @${instagramHandle}` : "",
        instagramUrl ? `IG Link - ${instagramUrl}` : "",
        `Lead Type - ${clean(lead.lead_type)}`,
      ].filter(Boolean).join("\n"),
    },
    smartlead: {
      action: "add_to_campaign",
      campaignEnv: smartleadCampaign.name,
      campaignId: smartleadCampaign.value || null,
      customFields: {
        super_doc_url: pageUrl,
        video_url: videoUrl,
        lead_type: clean(lead.lead_type),
        instagram_handle: instagramHandle,
        instagram_url: instagramUrl,
      },
    },
  };
}
