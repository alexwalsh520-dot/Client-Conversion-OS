import { NextResponse } from "next/server";
import { sendInstagramAudioVoiceNote } from "@/lib/instagram-dm-send";
import { normalizeInstagramUsername, normalizeVoiceNoteText } from "@/lib/voice-notes";
import {
  generateVoiceNoteFromMessage,
  loadReadyVoiceProfile,
} from "@/lib/voice-notes-server";

interface SendVoiceNoteBody {
  creatorSlug?: string;
  instagramUsername?: string;
  message?: string;
  environment?: "car" | "walk" | "gym";
  audioBase64?: string;
  mimeType?: string;
  script?: string;
}

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SendVoiceNoteBody;
    const creatorSlug = normalizeVoiceNoteText(body.creatorSlug || "");
    const instagramUsername = normalizeInstagramUsername(body.instagramUsername || "");

    if (!creatorSlug) {
      return NextResponse.json({ error: "Choose a creator first" }, { status: 400 });
    }

    if (!instagramUsername) {
      return NextResponse.json({ error: "Paste the Instagram username first" }, { status: 400 });
    }

    let clientKey: string | null = null;
    let script = normalizeVoiceNoteText(body.script || "");
    let mimeType = normalizeVoiceNoteText(body.mimeType || "audio/mpeg");
    let audioBuffer: Buffer;

    if (body.audioBase64) {
      audioBuffer = Buffer.from(body.audioBase64, "base64");
      const profile = await loadReadyVoiceProfile(creatorSlug);
      clientKey = profile.client_key || null;
      script = normalizeVoiceNoteText(script || body.message || "");
      mimeType = mimeType || "audio/mpeg";
    } else {
      const generated = await generateVoiceNoteFromMessage({
        creatorSlug,
        environment: body.environment || "car",
        message: normalizeVoiceNoteText(body.message || ""),
        instagramUsername,
      });
      clientKey = generated.clientKey;
      audioBuffer = generated.audioBuffer;
      script = generated.script;
      mimeType = generated.mimeType;
    }

    if (!script) {
      return NextResponse.json({ error: "Missing script for the voice note" }, { status: 400 });
    }

    const sent = await sendInstagramAudioVoiceNote({
      clientKey,
      creatorSlug,
      instagramUsername,
      mimeType,
      audioBuffer,
      script,
    });

    return NextResponse.json({
      ok: true,
      messageId: sent.messageId,
      publicUrl: sent.publicUrl,
      recipient: sent.recipient,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Instagram send failed",
      },
      { status: 400 },
    );
  }
}
