// Send a follow-up message via ManyChat's API + log to dm_conversation_messages.
//
// Why ManyChat instead of Meta Graph API directly?
// ManyChat already owns the Instagram connection for each creator's account,
// holds the right Page Access Token, and handles the IG messaging window
// rules internally. Using ManyChat's /fb/sending/sendContent endpoint means:
//   - No Meta Dev App setup needed for The Forge
//   - subscriber_id we get from the tag-added webhook (ManyChat Contact Id)
//     is the exact id this endpoint expects — no lookup needed
//   - Token rotation, message-tag policy, etc. all handled by ManyChat
// The endpoint works for both Messenger and Instagram subscribers on Pro plans.

import { getServiceSupabase } from '@/lib/supabase';
import type { EligibleVariant } from './variants';

const INSTAGRAM_CHANNEL = 'Instagram DM';
const MANYCHAT_API_BASE = 'https://api.manychat.com';

// Resolve which ManyChat API key to use for this client.
// Each creator has their own ManyChat account, each with its own API key.
function getManyChatKey(client: string): string {
  const keyMap: Record<string, string | undefined> = {
    tyson_sonnek: process.env.MANYCHAT_API_KEY_TYSON,
    keith_holland: process.env.MANYCHAT_API_KEY_KEITH,
    zoe_and_emily: process.env.MANYCHAT_API_KEY_ZOE_EMILY,
  };
  const key = keyMap[client]?.trim();
  if (!key) {
    throw new Error(`No ManyChat API key configured for client "${client}"`);
  }
  return key;
}

interface ManyChatSendContentResponse {
  status: 'success' | 'error';
  message?: string;
  data?: { message_id?: string };
}

export async function sendVariantAsDM(params: {
  client: string;
  subscriberId: string;
  variant: EligibleVariant;
  setterName: string;
}): Promise<{ messageId: string }> {
  const key = getManyChatKey(params.client);

  // Build the ManyChat message content block. ManyChat expects an array of
  // messages; each has a type (text | image | audio) and the payload.
  let message: Record<string, unknown>;
  if (params.variant.type === 'text' && params.variant.body) {
    message = { type: 'text', text: params.variant.body };
  } else if (params.variant.type === 'meme' && params.variant.media_url) {
    message = { type: 'image', url: params.variant.media_url };
  } else if (params.variant.type === 'voicenote' && params.variant.media_url) {
    message = { type: 'audio', url: params.variant.media_url };
  } else {
    throw new Error(`Variant ${params.variant.id} is misconfigured`);
  }

  const res = await fetch(`${MANYCHAT_API_BASE}/fb/sending/sendContent`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      subscriber_id: params.subscriberId,
      data: {
        version: 'v2',
        content: { messages: [message] },
      },
    }),
  });

  const payload = (await res.json().catch(() => ({}))) as ManyChatSendContentResponse;

  if (!res.ok || payload.status !== 'success') {
    throw new Error(
      `ManyChat send failed (${res.status}): ${payload.message || 'unknown error'}`,
    );
  }

  // ManyChat doesn't always return a message_id; synthesize one for attribution
  // if missing. Our followup_sends table doesn't depend on message_id uniqueness.
  const messageId = payload.data?.message_id || `manychat_${Date.now()}_${params.variant.id}`;

  await logOutboundMessage({
    client: params.client,
    subscriberId: params.subscriberId,
    setterName: params.setterName,
    messageId,
    variantBody: params.variant.body ?? `[${params.variant.type}]`,
    variantType: params.variant.type,
    mediaUrl: params.variant.media_url,
  });

  return { messageId };
}

async function logOutboundMessage(params: {
  client: string;
  subscriberId: string;
  setterName: string;
  messageId: string;
  variantBody: string;
  variantType: string;
  mediaUrl: string | null;
}) {
  const db = getServiceSupabase();
  const conversationId = `instagram:${params.subscriberId}`;
  await db.from('dm_conversation_messages').upsert(
    {
      client: params.client,
      subscriber_id: params.subscriberId,
      setter_name: params.setterName,
      contact_id: null,
      conversation_id: conversationId,
      message_id: params.messageId,
      direction: 'outbound',
      channel: INSTAGRAM_CHANNEL,
      message_type: params.variantType,
      body: params.variantBody,
      sent_at: new Date().toISOString(),
      raw_payload: {
        source: 'ai-followup-manychat',
        variant_type: params.variantType,
        media_url: params.mediaUrl,
      },
    },
    { onConflict: 'message_id' },
  );
}
