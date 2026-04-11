import { NextRequest, NextResponse } from "next/server";
import { analyzeDmStages, getDmAnalysisVersion } from "@/lib/dm-stage-ai";
import {
  fetchConversation,
  fetchConversationMessages,
  searchConversationsByContact,
} from "@/lib/ghl-conversations";
import { getServiceSupabase } from "@/lib/supabase";

interface ContactLink {
  subscriber_id: string;
  client: string;
  ghl_contact_id: string;
}

function getSecret(): string | null {
  return process.env.GHL_CONVERSATION_WEBHOOK_SECRET || null;
}

function coerceString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isInstagramChannel(value: string | null): boolean {
  return Boolean(value && value.toLowerCase().includes("instagram"));
}

function buildTranscript(
  messages: Array<{
    body: string;
    direction: "inbound" | "outbound" | "unknown";
    sentAt?: string | null;
  }>,
): string {
  return messages
    .filter((message) => message.body.trim())
    .slice(-40)
    .map((message) => {
      const speaker =
        message.direction === "inbound"
          ? "Prospect"
          : message.direction === "outbound"
            ? "Setter"
            : "Unknown";
      const timestamp = message.sentAt ? ` (${message.sentAt})` : "";
      return `${speaker}${timestamp}: ${message.body.trim()}`;
    })
    .join("\n");
}

function latestTimestamp(
  messages: Array<{
    sentAt?: string | null;
  }>,
): string | null {
  const times = messages
    .map((message) => message.sentAt)
    .filter((value): value is string => Boolean(value))
    .sort();

  return times.at(-1) || null;
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

async function getExistingStageState(conversationId: string): Promise<{
  latest_message_at: string | null;
  analysis_version: string | null;
} | null> {
  const sb = getServiceSupabase();
  const { data, error } = await sb
    .from("dm_conversation_stage_state")
    .select("latest_message_at, analysis_version")
    .eq("conversation_id", conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load existing stage state: ${error.message}`);
  }

  return data;
}

async function upsertConversationMessages(
  client: string,
  subscriberId: string,
  setterName: string | null,
  contactId: string,
  conversationId: string,
  channel: string | null,
  messages: Array<{
    messageId: string;
    body: string;
    direction: "inbound" | "outbound" | "unknown";
    messageType?: string | null;
    sentAt?: string | null;
    raw: Record<string, unknown>;
  }>,
) {
  const sb = getServiceSupabase();
  if (messages.length === 0) return;

  const payload = messages.map((message) => ({
    client,
    subscriber_id: subscriberId,
    setter_name: setterName,
    contact_id: contactId,
    conversation_id: conversationId,
    message_id: message.messageId,
    direction: message.direction,
    channel,
    message_type: message.messageType || null,
    body: message.body || null,
    sent_at: message.sentAt || null,
    raw_payload: message.raw,
  }));

  const { error } = await sb
    .from("dm_conversation_messages")
    .upsert(payload, { onConflict: "message_id" });

  if (error) {
    throw new Error(`Failed to upsert conversation messages: ${error.message}`);
  }
}

async function upsertStageState(params: {
  client: string;
  subscriberId: string;
  setterName: string | null;
  contactId: string;
  conversationId: string;
  classification: Awaited<ReturnType<typeof analyzeDmStages>>;
  latestMessageAt: string | null;
}) {
  const { client, subscriberId, setterName, contactId, conversationId, classification, latestMessageAt } = params;
  if (!classification) return;

  const sb = getServiceSupabase();
  const { error } = await sb.from("dm_conversation_stage_state").upsert(
    {
      client,
      subscriber_id: subscriberId,
      setter_name: setterName,
      contact_id: contactId,
      conversation_id: conversationId,
      goal_clear: classification.goal_clear,
      gap_clear: classification.gap_clear,
      stakes_clear: classification.stakes_clear,
      qualified: classification.qualified,
      booking_readiness_score: classification.booking_readiness_score,
      ai_confidence: classification.ai_confidence,
      stage_evidence: classification.stage_evidence,
      raw_classification: classification,
      analysis_version: getDmAnalysisVersion(),
      latest_message_at: latestMessageAt,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "conversation_id" },
  );

  if (error) {
    throw new Error(`Failed to upsert stage state: ${error.message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const expectedSecret = getSecret();
    if (expectedSecret) {
      const providedSecret = req.headers.get("x-webhook-secret");
      if (providedSecret !== expectedSecret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = (await req.json()) as Record<string, unknown>;

    let conversationId =
      coerceString(body.conversationId) ||
      coerceString(body.conversation_id) ||
      coerceString(body.id);

    let contactId =
      coerceString(body.contactId) ||
      coerceString(body.contact_id);
    const providedChannel = coerceString(body.channel);

    if (!conversationId) {
      if (!contactId) {
        return NextResponse.json(
          { error: "conversationId or contactId is required" },
          { status: 400 },
        );
      }

      const locationId = process.env.GHL_LOCATION_ID;
      if (!locationId) {
        return NextResponse.json({ error: "GHL_LOCATION_ID not configured" }, { status: 500 });
      }

      const conversations = await searchConversationsByContact(contactId, locationId);
      const fallbackConversation =
        conversations.find((conversation) =>
          providedChannel ? isInstagramChannel(conversation.channel || null) : true,
        ) || conversations[0];

      if (!fallbackConversation) {
        return NextResponse.json({
          status: "skipped",
          reason: "No conversation found for contact",
          contactId,
        });
      }

      conversationId = fallbackConversation.id;
    }

    const conversation = await fetchConversation(conversationId);
    contactId = contactId || conversation.contactId || null;
    const channel = providedChannel || conversation.channel || null;

    if (!isInstagramChannel(channel)) {
      return NextResponse.json({
        status: "skipped",
        reason: "Non-Instagram conversation",
        conversationId,
        channel,
      });
    }

    if (!contactId) {
      return NextResponse.json(
        { error: "Could not determine GHL contact ID for conversation" },
        { status: 400 },
      );
    }

    const contactLink = await getContactLinkByGhlContactId(contactId);
    if (!contactLink) {
      return NextResponse.json({
        status: "skipped",
        reason: "No ManyChat contact link found for this GHL contact",
      });
    }

    const setterName = await getSetterName(contactLink.client, contactLink.subscriber_id);
    const messages = await fetchConversationMessages(conversationId);

    await upsertConversationMessages(
      contactLink.client,
      contactLink.subscriber_id,
      setterName,
      contactId,
      conversationId,
      channel,
      messages,
    );

    const latestMessageAt = latestTimestamp(messages);
    const existingStageState = await getExistingStageState(conversationId);
    const shouldReanalyze =
      !existingStageState ||
      existingStageState.latest_message_at !== latestMessageAt ||
      existingStageState.analysis_version !== getDmAnalysisVersion();

    const transcript = buildTranscript(messages);
    const classification =
      shouldReanalyze && transcript ? await analyzeDmStages(transcript) : null;

    await upsertStageState({
      client: contactLink.client,
      subscriberId: contactLink.subscriber_id,
      setterName,
      contactId,
      conversationId,
      classification,
      latestMessageAt,
    });

    return NextResponse.json({
      status: "ok",
      storedMessages: messages.length,
      classified: Boolean(classification),
      reusedClassification: !classification && Boolean(existingStageState),
      client: contactLink.client,
      subscriberId: contactLink.subscriber_id,
      conversationId,
    });
  } catch (err) {
    console.error("[ghl-conversation-webhook] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Webhook failed" },
      { status: 500 },
    );
  }
}

export async function GET() {
  return NextResponse.json({
    status: "ok",
    description: "Receives GHL conversation webhooks, stores messages, and runs AI stage detection.",
    expected_body: {
      conversationId: "conversation id from GHL workflow webhook",
      contactId: "optional GHL contact id",
      channel: "optional Instagram DM | Facebook | etc",
    },
    auth_header: "X-Webhook-Secret: <GHL_CONVERSATION_WEBHOOK_SECRET> (optional but recommended)",
  });
}
