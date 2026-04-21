import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import {
  DEFAULT_CLIENT_KEY,
  DEFAULT_CREATOR_NAME,
  DEFAULT_CREATOR_SLUG,
  MAX_SAMPLE_BYTES,
  MAX_VOICE_FILES,
  slugifyVoiceProfile,
} from "@/lib/voice-notes";

function parseProfileNotes(value: FormDataEntryValue | null) {
  const notes = typeof value === "string" ? value.trim() : "";
  return notes || null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getServiceSupabase();
  const { data, error } = await db
    .from("creator_voice_profiles")
    .select("*")
    .order("creator_name", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    elevenLabsReady: Boolean(process.env.ELEVENLABS_API_KEY),
    defaults: {
      creatorName: DEFAULT_CREATOR_NAME,
      slug: DEFAULT_CREATOR_SLUG,
      clientKey: DEFAULT_CLIENT_KEY,
    },
    profiles: data || [],
  });
}

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Only admins can add voices" }, { status: 403 });
  }

  const formData = await req.formData();
  const creatorName = String(formData.get("creatorName") || "").trim();
  const requestedSlug = String(formData.get("slug") || "").trim();
  const clientKey = String(formData.get("clientKey") || "").trim() || null;
  const existingVoiceId = String(formData.get("existingVoiceId") || "").trim();
  const confirmConsent = String(formData.get("confirmConsent") || "").trim() === "true";
  const notes = parseProfileNotes(formData.get("notes"));
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);

  if (!creatorName) {
    return NextResponse.json({ error: "Creator name is required" }, { status: 400 });
  }
  if (!confirmConsent) {
    return NextResponse.json({ error: "You must confirm creator permission first" }, { status: 400 });
  }

  const slug = slugifyVoiceProfile(requestedSlug || creatorName);
  if (!slug) {
    return NextResponse.json({ error: "A valid slug is required" }, { status: 400 });
  }

  if (!existingVoiceId && files.length === 0) {
    return NextResponse.json(
      { error: "Upload voice files or paste an existing ElevenLabs voice ID" },
      { status: 400 },
    );
  }

  if (files.length > MAX_VOICE_FILES) {
    return NextResponse.json(
      { error: `Use ${MAX_VOICE_FILES} files or fewer per creator` },
      { status: 400 },
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_SAMPLE_BYTES) {
    return NextResponse.json(
      { error: "Voice files are too large. Keep the total under 25MB." },
      { status: 400 },
    );
  }

  const db = getServiceSupabase();
  const { data: existingProfile } = await db
    .from("creator_voice_profiles")
    .select("sample_count, sample_filenames")
    .eq("slug", slug)
    .maybeSingle();

  let voiceId = existingVoiceId;
  let status: "ready" | "pending_verification" = "ready";

  if (!voiceId) {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: "ELEVENLABS_API_KEY is not set" }, { status: 500 });
    }

    const elevenForm = new FormData();
    elevenForm.append("name", creatorName);
    elevenForm.append("remove_background_noise", "true");
    if (notes) {
      elevenForm.append("description", notes);
    }
    for (const file of files) {
      elevenForm.append("files[]", file, file.name);
    }

    const elevenRes = await fetch("https://api.elevenlabs.io/v1/voices/add", {
      method: "POST",
      headers: {
        "xi-api-key": apiKey,
      },
      body: elevenForm,
    });

    if (!elevenRes.ok) {
      const errorText = await elevenRes.text();
      return NextResponse.json(
        { error: `ElevenLabs voice setup failed: ${errorText || elevenRes.statusText}` },
        { status: 502 },
      );
    }

    const elevenData = (await elevenRes.json()) as {
      voice_id?: string;
      requires_verification?: boolean;
    };

    if (!elevenData.voice_id) {
      return NextResponse.json({ error: "ElevenLabs did not return a voice ID" }, { status: 502 });
    }

    voiceId = elevenData.voice_id;
    status = elevenData.requires_verification ? "pending_verification" : "ready";
  }

  const sampleNames = files.length
    ? files.map((file) => file.name)
    : (existingProfile?.sample_filenames as string[] | null) || [];

  const sampleCount = files.length || existingProfile?.sample_count || 0;

  const payload = {
    slug,
    creator_name: creatorName,
    client_key: clientKey,
    elevenlabs_voice_id: voiceId,
    status,
    sample_count: sampleCount,
    sample_filenames: sampleNames,
    notes,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from("creator_voice_profiles")
    .upsert(payload, { onConflict: "slug" })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ profile: data });
}
