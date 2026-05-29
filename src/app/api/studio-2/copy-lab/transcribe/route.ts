import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { getServiceSupabase } from "@/lib/supabase";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE_HEADERS = { "Cache-Control": "no-store, no-cache, must-revalidate" };
const CACHE_TABLE = "studio2_copy_transcriptions";

let anthropic: Anthropic | null = null;
function getAnthropic() {
  anthropic ||= new Anthropic();
  return anthropic;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const imageUrl = String(body.imageUrl || "").trim();
    const sourceAdId = String(body.adId || body.sourceAdId || imageUrl).trim();
    const clientKey = String(body.clientKey || "").trim() || null;
    const adName = String(body.adName || "").trim() || null;
    const campaignName = String(body.campaignName || "").trim() || null;

    if (!imageUrl) {
      return NextResponse.json({ error: "Image URL required" }, { status: 400, headers: NO_STORE_HEADERS });
    }

    const cached = await readCachedTranscription(sourceAdId);
    if (cached) {
      return NextResponse.json({ transcription: cached, cached: true }, { headers: NO_STORE_HEADERS });
    }

    const image = await fetchImageAsBase64(imageUrl);
    const response = await getAnthropic().messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 900,
      system: [
        "You transcribe visible ad copy from Meta ad creative images.",
        "Return only the words shown in the ad image.",
        "Preserve line breaks and group breaks when obvious.",
        "Do not describe the image. Do not add commentary.",
      ].join(" "),
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: image.mediaType,
                data: image.base64,
              },
            },
            {
              type: "text",
              text: "Transcribe the visible ad text exactly enough for a copywriter to make close variations.",
            },
          ],
        },
      ],
    });

    const text = response.content.find((part) => part.type === "text")?.text?.trim() || "";
    const transcription = {
      sourceAdId,
      clientKey,
      adName,
      campaignName,
      imageUrl,
      text,
      createdAt: new Date().toISOString(),
    };

    await writeCachedTranscription(transcription).catch(() => undefined);
    return NextResponse.json({ transcription, cached: false }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    console.error("[studio-copy-lab-transcribe] failed", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not transcribe winning ad" },
      { status: 500, headers: NO_STORE_HEADERS }
    );
  }
}

async function fetchImageAsBase64(url: string) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Could not fetch creative image: ${res.status}`);
  const contentType = normalizeImageContentType(res.headers.get("content-type"), url);
  const bytes = Buffer.from(await res.arrayBuffer());
  return {
    mediaType: contentType,
    base64: bytes.toString("base64"),
  };
}

function normalizeImageContentType(contentType: string | null, url: string): "image/jpeg" | "image/png" | "image/gif" | "image/webp" {
  const clean = contentType?.split(";")[0]?.trim().toLowerCase();
  if (clean === "image/png" || clean === "image/gif" || clean === "image/webp") return clean;
  if (/\.png($|\?)/i.test(url)) return "image/png";
  if (/\.gif($|\?)/i.test(url)) return "image/gif";
  if (/\.webp($|\?)/i.test(url)) return "image/webp";
  return "image/jpeg";
}

async function readCachedTranscription(sourceAdId: string) {
  try {
    const sb = getServiceSupabase();
    const { data, error } = await sb
      .from(CACHE_TABLE)
      .select("source_ad_id, client_key, ad_name, campaign_name, image_url, extracted_copy, created_at")
      .eq("source_ad_id", sourceAdId)
      .maybeSingle();
    if (error || !data) return null;
    return {
      sourceAdId: data.source_ad_id,
      clientKey: data.client_key,
      adName: data.ad_name,
      campaignName: data.campaign_name,
      imageUrl: data.image_url,
      text: data.extracted_copy,
      createdAt: data.created_at,
    };
  } catch {
    return null;
  }
}

async function writeCachedTranscription(input: {
  sourceAdId: string;
  clientKey: string | null;
  adName: string | null;
  campaignName: string | null;
  imageUrl: string;
  text: string;
}) {
  const sb = getServiceSupabase();
  await sb.from(CACHE_TABLE).upsert({
    source_ad_id: input.sourceAdId,
    client_key: input.clientKey,
    ad_name: input.adName,
    campaign_name: input.campaignName,
    image_url: input.imageUrl,
    extracted_copy: input.text,
    updated_at: new Date().toISOString(),
  }, { onConflict: "source_ad_id" });
}
