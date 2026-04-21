import { getServiceSupabase } from "@/lib/supabase";
import {
  MAX_SCRIPT_CHARS,
  VoiceNoteEnvironment,
  buildVoiceNoteFileName,
  getVoiceEnvironmentSettings,
  normalizeInstagramUsername,
  normalizeVoiceNoteText,
} from "@/lib/voice-notes";

export interface PublicVoiceProfile {
  id: string;
  slug: string;
  creator_name: string;
}

export interface GeneratedVoiceNote {
  creatorName: string;
  creatorSlug: string;
  clientKey: string | null;
  script: string;
  fileName: string;
  mimeType: string;
  audioBase64: string;
  audioBuffer: Buffer;
}

export async function listReadyVoiceProfiles() {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("creator_voice_profiles")
    .select("id, slug, creator_name")
    .eq("status", "ready")
    .order("creator_name", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data || []) as PublicVoiceProfile[];
}

export async function loadReadyVoiceProfile(creatorSlug: string) {
  const db = getServiceSupabase();
  const { data, error } = await db
    .from("creator_voice_profiles")
    .select("slug, creator_name, client_key, elevenlabs_voice_id, status")
    .eq("slug", creatorSlug)
    .single();

  if (error || !data) {
    throw new Error("Creator voice not found");
  }

  if (data.status !== "ready") {
    throw new Error("This creator voice is not ready yet");
  }

  return data;
}

export function getPublicVoiceNotesStatus() {
  return {
    elevenLabsReady: Boolean(process.env.ELEVENLABS_API_KEY),
    instagramSendReady: Boolean(
      process.env.INSTAGRAM_DM_ACCESS_TOKEN && process.env.INSTAGRAM_DM_ACCOUNT_ID,
    ),
  };
}

export async function generateVoiceNoteFromMessage(params: {
  creatorSlug: string;
  message: string;
  environment: VoiceNoteEnvironment;
  instagramUsername?: string;
}) {
  const creatorSlug = normalizeVoiceNoteText(params.creatorSlug);
  if (!creatorSlug) {
    throw new Error("Choose a creator first");
  }

  const script = normalizeVoiceNoteText(params.message);
  if (!script) {
    throw new Error("Type the message first");
  }
  if (script.length > MAX_SCRIPT_CHARS) {
    throw new Error(`Keep the message under ${MAX_SCRIPT_CHARS} characters`);
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error("ELEVENLABS_API_KEY is not set");
  }

  const profile = await loadReadyVoiceProfile(creatorSlug);
  const modelId = process.env.ELEVENLABS_MODEL_ID || "eleven_flash_v2_5";
  const ttsRes = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${profile.elevenlabs_voice_id}?output_format=mp3_44100_128`,
    {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        text: script,
        model_id: modelId,
        voice_settings: getVoiceEnvironmentSettings(params.environment),
      }),
    },
  );

  if (!ttsRes.ok) {
    const errorText = await ttsRes.text();
    throw new Error(`ElevenLabs audio generation failed: ${errorText || ttsRes.statusText}`);
  }

  const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
  const audioBase64 = audioBuffer.toString("base64");

  return {
    creatorName: profile.creator_name,
    creatorSlug: profile.slug,
    clientKey: profile.client_key || null,
    script,
    fileName: buildVoiceNoteFileName({
      creatorSlug: profile.slug,
      environment: params.environment,
      username: normalizeInstagramUsername(params.instagramUsername || "lead"),
    }),
    mimeType: "audio/mpeg",
    audioBase64,
    audioBuffer,
  } satisfies GeneratedVoiceNote;
}
