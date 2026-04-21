import { getServiceSupabase } from "@/lib/supabase";
import { normalizeInstagramUsername, normalizeVoiceNoteText } from "@/lib/voice-notes";

const INSTAGRAM_CHANNEL = "Instagram DM";
const VOICE_NOTES_BUCKET = "voice-notes";
const DEFAULT_SETTER_NAME = "Voice Notes";
const DEFAULT_API_VERSION = "v24.0";

interface InstagramMessagingConfig {
  accessToken: string;
  accountId: string;
  apiVersion: string;
  setterName: string;
}

interface InstagramProfileLookup {
  id: string;
  username?: string;
  name?: string | null;
}

interface ResolvedInstagramRecipient {
  subscriberId: string;
  username: string;
  displayName: string | null;
}

function getInstagramMessagingConfig(): InstagramMessagingConfig {
  const accessToken = process.env.INSTAGRAM_DM_ACCESS_TOKEN?.trim();
  const accountId = process.env.INSTAGRAM_DM_ACCOUNT_ID?.trim();

  if (!accessToken || !accountId) {
    throw new Error(
      "Instagram sending is not connected yet. Add INSTAGRAM_DM_ACCESS_TOKEN and INSTAGRAM_DM_ACCOUNT_ID.",
    );
  }

  return {
    accessToken,
    accountId,
    apiVersion: process.env.INSTAGRAM_DM_API_VERSION?.trim() || DEFAULT_API_VERSION,
    setterName: process.env.INSTAGRAM_DM_SETTER_NAME?.trim() || DEFAULT_SETTER_NAME,
  };
}

async function fetchInstagramProfile(subscriberId: string, config: InstagramMessagingConfig) {
  const url = new URL(
    `https://graph.instagram.com/${config.apiVersion}/${subscriberId}`,
  );
  url.searchParams.set("fields", "id,username,name");

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
    },
  });

  if (!res.ok) {
    return null;
  }

  const data = (await res.json()) as InstagramProfileLookup;
  if (!data?.id) return null;
  return {
    subscriberId: data.id,
    username: normalizeInstagramUsername(data.username || ""),
    displayName: normalizeVoiceNoteText(data.name || "") || null,
  };
}

async function getRecentInstagramSubscriberIds(clientKey: string | null) {
  const db = getServiceSupabase();
  let query = db
    .from("dm_conversation_messages")
    .select("subscriber_id, sent_at")
    .eq("channel", INSTAGRAM_CHANNEL)
    .order("sent_at", { ascending: false })
    .limit(500);

  if (clientKey) {
    query = query.eq("client", clientKey);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(`Failed to load Instagram DM contacts: ${error.message}`);
  }

  const uniqueIds = new Set<string>();
  for (const row of data || []) {
    const subscriberId = normalizeVoiceNoteText(String(row.subscriber_id || ""));
    if (!subscriberId || uniqueIds.has(subscriberId)) continue;
    uniqueIds.add(subscriberId);
    if (uniqueIds.size >= 80) break;
  }

  return [...uniqueIds];
}

export async function resolveInstagramRecipientByUsername(params: {
  clientKey: string | null;
  instagramUsername: string;
}) {
  const username = normalizeInstagramUsername(params.instagramUsername);
  if (!username) {
    throw new Error("Paste the Instagram username first");
  }

  const config = getInstagramMessagingConfig();
  const subscriberIds = await getRecentInstagramSubscriberIds(params.clientKey);

  for (let index = 0; index < subscriberIds.length; index += 10) {
    const batch = subscriberIds.slice(index, index + 10);
    const profiles = await Promise.all(batch.map((subscriberId) => fetchInstagramProfile(subscriberId, config)));
    const match = profiles.find((profile): profile is ResolvedInstagramRecipient => Boolean(profile?.username === username));
    if (match) {
      return match;
    }
  }

  throw new Error(
    `I couldn't match @${username} to a DM contact yet. They need to message the connected Instagram account first.`,
  );
}

async function ensureVoiceNotesBucket() {
  const db = getServiceSupabase();
  const { data: buckets, error: listError } = await db.storage.listBuckets();
  if (listError) {
    throw new Error(`Failed to inspect storage buckets: ${listError.message}`);
  }

  const bucketExists = (buckets || []).some((bucket) => bucket.name === VOICE_NOTES_BUCKET);
  if (bucketExists) return;

  const { error: createError } = await db.storage.createBucket(VOICE_NOTES_BUCKET, {
    public: true,
    allowedMimeTypes: ["audio/mpeg"],
    fileSizeLimit: 10 * 1024 * 1024,
  });

  if (createError && !createError.message.toLowerCase().includes("already")) {
    throw new Error(`Failed to create voice note storage bucket: ${createError.message}`);
  }
}

async function uploadVoiceNoteAudio(params: {
  creatorSlug: string;
  instagramUsername: string;
  audioBuffer: Buffer;
  mimeType: string;
}) {
  const db = getServiceSupabase();
  await ensureVoiceNotesBucket();

  const safeUsername = normalizeInstagramUsername(params.instagramUsername) || "lead";
  const storagePath = `${params.creatorSlug}/${Date.now()}-${safeUsername}-${Math.random().toString(36).slice(2)}.mp3`;

  const { error: uploadError } = await db.storage
    .from(VOICE_NOTES_BUCKET)
    .upload(storagePath, params.audioBuffer, {
      contentType: params.mimeType,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    throw new Error(`Failed to upload the voice note: ${uploadError.message}`);
  }

  const { data } = db.storage.from(VOICE_NOTES_BUCKET).getPublicUrl(storagePath);
  return {
    storagePath,
    publicUrl: data.publicUrl,
  };
}

async function findConversationId(params: {
  clientKey: string | null;
  subscriberId: string;
}) {
  const db = getServiceSupabase();
  let query = db
    .from("dm_conversation_messages")
    .select("conversation_id")
    .eq("channel", INSTAGRAM_CHANNEL)
    .eq("subscriber_id", params.subscriberId)
    .order("sent_at", { ascending: false })
    .limit(1);

  if (params.clientKey) {
    query = query.eq("client", params.clientKey);
  }

  const { data } = await query;
  return data?.[0]?.conversation_id || `instagram:${params.subscriberId}`;
}

async function logSentVoiceNote(params: {
  clientKey: string | null;
  subscriberId: string;
  conversationId: string;
  messageId: string;
  script: string;
  publicUrl: string;
  instagramUsername: string;
  creatorSlug: string;
}) {
  const db = getServiceSupabase();
  const payload = {
    client: params.clientKey || "voice_notes",
    subscriber_id: params.subscriberId,
    setter_name: getInstagramMessagingConfig().setterName,
    contact_id: null,
    conversation_id: params.conversationId,
    message_id: params.messageId,
    direction: "outbound",
    channel: INSTAGRAM_CHANNEL,
    message_type: "audio",
    body: params.script,
    sent_at: new Date().toISOString(),
    raw_payload: {
      source: "voice-notes-public-page",
      audio_url: params.publicUrl,
      instagram_username: normalizeInstagramUsername(params.instagramUsername),
      creator_slug: params.creatorSlug,
    },
  };

  const { error } = await db.from("dm_conversation_messages").upsert(payload, {
    onConflict: "message_id",
  });

  if (error) {
    throw new Error(`Voice note sent, but logging failed: ${error.message}`);
  }
}

export async function sendInstagramAudioVoiceNote(params: {
  clientKey: string | null;
  creatorSlug: string;
  instagramUsername: string;
  mimeType: string;
  audioBuffer: Buffer;
  script: string;
}) {
  const config = getInstagramMessagingConfig();
  const recipient = await resolveInstagramRecipientByUsername({
    clientKey: params.clientKey,
    instagramUsername: params.instagramUsername,
  });
  const uploaded = await uploadVoiceNoteAudio({
    creatorSlug: params.creatorSlug,
    instagramUsername: params.instagramUsername,
    audioBuffer: params.audioBuffer,
    mimeType: params.mimeType,
  });

  const res = await fetch(
    `https://graph.instagram.com/${config.apiVersion}/${config.accountId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipient: {
          id: recipient.subscriberId,
        },
        message: {
          attachment: {
            type: "audio",
            payload: {
              url: uploaded.publicUrl,
            },
          },
        },
      }),
    },
  );

  const data = (await res.json().catch(() => ({}))) as {
    message_id?: string;
    error?: { message?: string };
  };

  if (!res.ok || !data.message_id) {
    throw new Error(
      data.error?.message ||
        "Instagram send failed. Check the connected account, token, and message window.",
    );
  }

  const conversationId = await findConversationId({
    clientKey: params.clientKey,
    subscriberId: recipient.subscriberId,
  });

  await logSentVoiceNote({
    clientKey: params.clientKey,
    subscriberId: recipient.subscriberId,
    conversationId,
    messageId: data.message_id,
    script: normalizeVoiceNoteText(params.script),
    publicUrl: uploaded.publicUrl,
    instagramUsername: recipient.username,
    creatorSlug: params.creatorSlug,
  });

  return {
    messageId: data.message_id,
    publicUrl: uploaded.publicUrl,
    recipient,
  };
}
