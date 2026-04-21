import { NextResponse } from "next/server";
import {
  VoiceNoteEnvironment,
  normalizeInstagramUsername,
  normalizeVoiceNoteText,
} from "@/lib/voice-notes";
import { generateVoiceNoteFromMessage } from "@/lib/voice-notes-server";

interface GeneratePublicVoiceNoteBody {
  creatorSlug?: string;
  environment?: VoiceNoteEnvironment;
  message?: string;
  instagramUsername?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as GeneratePublicVoiceNoteBody;
    const result = await generateVoiceNoteFromMessage({
      creatorSlug: normalizeVoiceNoteText(body.creatorSlug || ""),
      environment: body.environment || "car",
      message: normalizeVoiceNoteText(body.message || ""),
      instagramUsername: normalizeInstagramUsername(body.instagramUsername || ""),
    });

    return NextResponse.json({
      creatorName: result.creatorName,
      creatorSlug: result.creatorSlug,
      fileName: result.fileName,
      mimeType: result.mimeType,
      script: result.script,
      audioBase64: result.audioBase64,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Voice note generation failed",
      },
      { status: 400 },
    );
  }
}
