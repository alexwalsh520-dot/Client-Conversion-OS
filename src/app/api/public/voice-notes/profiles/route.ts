import { NextResponse } from "next/server";
import {
  getPublicVoiceNotesStatus,
  listReadyVoiceProfiles,
} from "@/lib/voice-notes-server";

export async function GET() {
  try {
    const profiles = await listReadyVoiceProfiles();
    return NextResponse.json({
      ...getPublicVoiceNotesStatus(),
      profiles,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Failed to load creator voices",
      },
      { status: 500 },
    );
  }
}
