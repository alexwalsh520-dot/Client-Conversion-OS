// Send a follow-up message via Instagram Graph API + log to dm_conversation_messages.
// Mirrors patterns from src/lib/instagram-dm-send.ts.

import { getServiceSupabase } from '@/lib/supabase';
import type { EligibleVariant } from './variants';

const INSTAGRAM_CHANNEL = 'Instagram DM';
const DEFAULT_API_VERSION = 'v24.0';

interface SendConfig {
  accessToken: string;
  accountId: string;
  apiVersion: string;
}

function getConfig(): SendConfig {
  const accessToken = process.env.INSTAGRAM_DM_ACCESS_TOKEN?.trim();
  const accountId = process.env.INSTAGRAM_DM_ACCOUNT_ID?.trim();
  if (!accessToken || !accountId) {
    throw new Error('INSTAGRAM_DM_ACCESS_TOKEN or INSTAGRAM_DM_ACCOUNT_ID not set');
  }
  return {
    accessToken,
    accountId,
    apiVersion: process.env.INSTAGRAM_DM_API_VERSION?.trim() || DEFAULT_API_VERSION,
  };
}

export async function sendVariantAsDM(params: {
  client: string;
  subscriberId: string;
  variant: EligibleVariant;
  setterName: string;
}): Promise<{ messageId: string }> {
  const cfg = getConfig();
  const endpoint = `https://graph.instagram.com/${cfg.apiVersion}/${cfg.accountId}/messages`;

  let messageBody: Record<string, unknown>;
  if (params.variant.type === 'text' && params.variant.body) {
    messageBody = { text: params.variant.body };
  } else if (
    (params.variant.type === 'meme' || params.variant.type === 'voicenote') &&
    params.variant.media_url
  ) {
    const attachmentType = params.variant.type === 'voicenote' ? 'audio' : 'image';
    messageBody = { attachment: { type: attachmentType, payload: { url: params.variant.media_url } } };
  } else {
    throw new Error(`Variant ${params.variant.id} is misconfigured`);
  }

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: { id: params.subscriberId },
      message: messageBody,
    }),
  });

  const data = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { message?: string; error_subcode?: number };
  };

  if (!res.ok || !data.message_id) {
    throw new Error(
      data.error?.message || `Instagram send failed (${res.status}) — check access token + message window`,
    );
  }

  // Log to dm_conversation_messages so this message shows up in transcripts + analytics
  await logOutboundMessage({
    client: params.client,
    subscriberId: params.subscriberId,
    setterName: params.setterName,
    messageId: data.message_id,
    variantBody: params.variant.body ?? `[${params.variant.type}]`,
    variantType: params.variant.type,
    mediaUrl: params.variant.media_url,
  });

  return { messageId: data.message_id };
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
        source: 'ai-followup',
        variant_type: params.variantType,
        media_url: params.mediaUrl,
      },
    },
    { onConflict: 'message_id' },
  );
}
