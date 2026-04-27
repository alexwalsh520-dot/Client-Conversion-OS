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
  }[],
  campaignIdOverride?: string
) {
  const apiKey = getApiKey();
  const campaignId = campaignIdOverride || getCampaignId();
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

// Return type for campaign analytics
export interface SmartleadAnalytics {
  campaign_name: string;
  sent_count: number;
  unique_sent_count: number;
  open_count: number;
  unique_open_count: number;
  click_count: number;
  unique_click_count: number;
  reply_count: number;
  bounce_count: number;
  unsubscribed_count: number;
  block_count: number;
  total_leads: number;
  leads_in_progress: number;
  leads_completed: number;
  leads_not_started: number;
  // Computed rates
  open_rate: number;
  reply_rate: number;
  bounce_rate: number;
  click_rate: number;
}

export async function getCampaignStatistics(): Promise<SmartleadAnalytics> {
  const apiKey = getApiKey();
  const campaignId = getCampaignId();

  // Use /analytics endpoint which returns aggregate campaign data
  const res = await fetch(
    `${SMARTLEAD_BASE}/campaigns/${campaignId}/analytics?api_key=${apiKey}`
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Smartlead get analytics failed (${res.status}): ${text}`);
  }
  const data = await res.json();

  // Parse counts (API returns some as strings)
  const sentCount = parseInt(data.sent_count) || 0;
  const uniqueSentCount = parseInt(data.unique_sent_count) || 0;
  const openCount = parseInt(data.open_count) || 0;
  const uniqueOpenCount = parseInt(data.unique_open_count) || 0;
  const clickCount = parseInt(data.click_count) || 0;
  const uniqueClickCount = parseInt(data.unique_click_count) || 0;
  const replyCount = parseInt(data.reply_count) || 0;
  const bounceCount = parseInt(data.bounce_count) || 0;
  const unsubscribedCount = parseInt(data.unsubscribed_count) || 0;
  const blockCount = parseInt(data.block_count) || 0;
  const leadStats = data.campaign_lead_stats || {};

  // Compute rates based on unique sent count (per-lead basis)
  const base = uniqueSentCount || 1; // avoid division by zero
  const openRate = (uniqueOpenCount / base) * 100;
  const replyRate = (replyCount / base) * 100;
  const bounceRate = (bounceCount / sentCount || 1) * 100;
  const clickRate = (uniqueClickCount / base) * 100;

  return {
    campaign_name: data.name || "",
    sent_count: sentCount,
    unique_sent_count: uniqueSentCount,
    open_count: openCount,
    unique_open_count: uniqueOpenCount,
    click_count: clickCount,
    unique_click_count: uniqueClickCount,
    reply_count: replyCount,
    bounce_count: bounceCount,
    unsubscribed_count: unsubscribedCount,
    block_count: blockCount,
    total_leads: leadStats.total || 0,
    leads_in_progress: leadStats.inprogress || 0,
    leads_completed: leadStats.completed || 0,
    leads_not_started: leadStats.notStarted || 0,
    open_rate: Math.round(openRate * 10) / 10,
    reply_rate: Math.round(replyRate * 10) / 10,
    bounce_rate: Math.round(bounceRate * 10) / 10,
    click_rate: Math.round(clickRate * 10) / 10,
  };
}
