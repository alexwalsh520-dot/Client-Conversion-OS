// Smartlead API helper functions

const SMARTLEAD_BASE = "https://server.smartlead.ai/api/v1";

function getApiKey() {
  const key = process.env.SMARTLEAD_API_KEY;
  if (!key) throw new Error("SMARTLEAD_API_KEY not configured");
  return key;
}

function getCampaignId() {
  const id = process.env.SMARTLEAD_CAMPAIGN_ID;
  if (!id) throw new Error("SMARTLEAD_CAMPAIGN_ID not configured");
  return id;
}

export async function addLeadsToCampaign(
  leads: {
    email: string;
    first_name: string;
    custom_fields?: Record<string, string>;
  }[]
) {
  const apiKey = getApiKey();
  const campaignId = getCampaignId();
  const gammaLink = process.env.GAMMA_LINK || "";

  const leadList = leads.map((l) => ({
    email: l.email,
    first_name: l.first_name,
    custom_fields: {
      gamma_link: gammaLink,
      ...l.custom_fields,
    },
  }));

  const res = await fetch(
    `${SMARTLEAD_BASE}/campaigns/${campaignId}/leads?api_key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_list: leadList }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Smartlead add leads failed (${res.status}): ${text}`);
  }
  return res.json();
}

export async function getCampaignStatistics() {
  const apiKey = getApiKey();
  const campaignId = getCampaignId();

  const res = await fetch(
    `${SMARTLEAD_BASE}/campaigns/${campaignId}/statistics?api_key=${apiKey}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Smartlead get stats failed (${res.status}): ${text}`);
  }
  return res.json();
}
