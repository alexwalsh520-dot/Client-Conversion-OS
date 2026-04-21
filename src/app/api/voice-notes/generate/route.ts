import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  MAX_SCRIPT_CHARS,
  VoiceNoteTemplate,
  buildVoiceNoteDraft,
  normalizeVoiceNoteText,
} from "@/lib/voice-notes";

interface GenerateVoiceNoteBody {
  creatorSlug?: string;
  template?: VoiceNoteTemplate;
  prospectName?: string;
  instagramHandle?: string;
  goal?: string;
  painPoint?: string;
  currentSituation?: string;
  callToAction?: string;
  customScript?: string;
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 500 });
  }

  const body = (await req.json()) as GenerateVoiceNoteBody;
  const creatorSlug = normalizeVoiceNoteText(body.creatorSlug || "");

  if (!creatorSlug) {
    return NextResponse.json({ error: "Choose a creator first" }, { status: 400 });
  }

  const db = getServiceSupabase();
  const { data: profile, error: profileError } = await db
    .from("creator_voice_profiles")
    .select("*")
    .eq("slug", creatorSlug)
    .single();

  if (profileError || !profile) {
    return NextResponse.json({ error: "Creator voice not found" }, { status: 404 });
  }

  if (profile.status !== "ready") {
    return NextResponse.json(
      { error: "This voice is still waiting on verification in ElevenLabs" },
      { status: 400 },
    );
  }

  const template = body.template || "goal_clear";
  const draft = buildVoiceNoteDraft({
    creatorName: profile.creator_name,
    template,
    prospectName: body.prospectName,
    instagramHandle: body.instagramHandle,
    goal: body.goal,
    painPoint: body.painPoint,
    currentSituation: body.currentSituation,
    callToAction: body.callToAction,
    customScript: body.customScript,
  });

  const script = normalizeVoiceNoteText(draft);
  if (!script) {
    return NextResponse.json({ error: "Add a message before generating audio" }, { status: 400 });
  }
  if (script.length > MAX_SCRIPT_CHARS) {
    return NextResponse.json(
      { error: `Keep the script under ${MAX_SCRIPT_CHARS} characters for a short voice note` },
      { status: 400 },
    );
  }

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
      }),
    },
  );

  if (!ttsRes.ok) {
    const errorText = await ttsRes.text();
    return NextResponse.json(
      { error: `ElevenLabs audio generation failed: ${errorText || ttsRes.statusText}` },
      { status: 502 },
    );
  }

  const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
  const audioBase64 = audioBuffer.toString("base64");
  const safeLeadName = normalizeVoiceNoteText(body.prospectName || "lead")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "lead";

  return NextResponse.json({
    creatorName: profile.creator_name,
    fileName: `${profile.slug}-${safeLeadName}-voice-note.mp3`,
    mimeType: "audio/mpeg",
    script,
    audioBase64,
  });
}
