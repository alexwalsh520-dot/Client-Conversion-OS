import { NextRequest, NextResponse } from "next/server";
import { ensureTrackedOutboundLinkEvents } from "@/lib/dm-link-tracking";
import {
  fetchConversationMessages,
  searchRecentConversations,
} from "@/lib/ghl-conversations";
import { getServiceSupabase } from "@/lib/supabase";

interface ContactLink {
  subscriber_id: string;
  client: string;
  ghl_contact_id: string;
}

function isInstagramChannel(value: string | null): boolean {
  return Boolean(value && value.toLowerCase().includes("instagram"));
}

function getLocationId(): string {
  const locationId = process.env.GHL_LOCATION_ID;
  if (!locationId) {
    throw new Error("GHL_LOCATION_ID not configured");
  }
  return locationId;
}

function getLookbackMinutes(): number {
  const raw = Number(process.env.DM_LINK_SYNC_LOOKBACK_MINUTES || "10");
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
}

function getConversationLimit(): number {
  const raw = Number(process.env.DM_LINK_SYNC_CONVERSATION_LIMIT || "100");
  return Number.isFinite(raw) && raw > 0 ? raw : 100;
}

async function getContactLinkByGhlContactId(contactId: string): Promise<ContactLink | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("manychat_contact_links")
    .select("subscriber_id, client, ghl_contact_id")
    .eq("ghl_contact_id", contactId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load contact link: ${error.message}`);
  }

  return data;
}

async function getSetterName(client: string, subscriberId: string): Promise<string | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("manychat_tag_events")
    .select("setter_name")
    .eq("client", client)
    .eq("subscriber_id", subscriberId)
    .not("setter_name", "is", null)
    .order("event_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load setter name: ${error.message}`);
  }

  return data?.setter_name || null;
}

export async function GET(req: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.get("authorization");
      if (auth !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const cutoff = Date.now() - getLookbackMinutes() * 60 * 1000;
    const recentConversations = await searchRecentConversations(getLocationId(), {
      limit: getConversationLimit(),
      page: 1,
    });

    const candidates = recentConversations.filter((conversation) => {
      if (!isInstagramChannel(conversation.channel || null)) return false;
      if (!conversation.contactId) return false;
      if (!conversation.lastMessageDate) return false;
      return new Date(conversation.lastMessageDate).getTime() >= cutoff;
    });

    const results: Array<{
      conversationId: string;
      contactId: string;
      client: string;
      createdTags: string[];
    }> = [];
    const errors: Array<{ conversationId: string; error: string }> = [];

    for (const conversation of candidates) {
      try {
        if (!conversation.contactId) continue;

        const contactLink = await getContactLinkByGhlContactId(conversation.contactId);
        if (!contactLink) continue;

        const setterName = await getSetterName(contactLink.client, contactLink.subscriber_id);
        const messages = await fetchConversationMessages(conversation.id);
        const tracked = await ensureTrackedOutboundLinkEvents({
          client: contactLink.client,
          subscriberId: contactLink.subscriber_id,
          setterName,
          messages,
        });

        if (tracked.created.length > 0) {
          results.push({
            conversationId: conversation.id,
            contactId: conversation.contactId,
            client: contactLink.client,
            createdTags: tracked.created.map((event) => event.tagName),
          });
        }
      } catch (error) {
        errors.push({
          conversationId: conversation.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    return NextResponse.json({
      status: "ok",
      scanned: candidates.length,
      created: results.length,
      results,
      errors,
    });
  } catch (error) {
    console.error("[cron/dm-link-sync] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "dm-link-sync failed" },
      { status: 500 },
    );
  }
}
