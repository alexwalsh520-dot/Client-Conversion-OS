import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";

// Shared "read the words on an ad image" logic, used by the on-demand single-ad
// route and the batch backfill route. The result is cached in ad_creative_copy
// keyed by ad_id, so any given ad's image is only ever read once.

export const CREATIVE_COPY_SYSTEM = `You are an OCR transcriber. You read the words PRINTED on an advertising image and copy them out character-for-character. You are not a copywriter and you never compose, guess, paraphrase, or complete text.

Look at the image and transcribe ONLY the text that is visually overlaid on the
creative — the big hook line, any sub-text, and the call-to-action button text.
Ignore logos, watermarks, tiny legal text, and the person's appearance.

ABSOLUTE RULES — breaking these makes the data worthless:
- Transcribe ONLY words you can actually SEE rendered on the image, verbatim. Copy them exactly, including odd capitalisation or punctuation.
- If the image is a plain photo, a blank frame, a logo, or you cannot clearly read overlaid words, return has_text:false and empty strings. An empty answer is ALWAYS better than a guess.
- NEVER invent, assume, or fill in generic marketing copy. Phrases like "Unlock your potential", "Shop now", "Looking for high quality products?", "Transform your life", "Limited time offer" are FORBIDDEN unless those exact words are visibly printed on the image. If you find yourself producing a generic slogan that you are not certain you can see, stop and return has_text:false.
- Do not describe the image, the product, or what the ad is "about". Only transcribe literal visible text.

Return ONLY valid JSON, no markdown:
{
  "hook": "<the single biggest / most prominent line of text, verbatim. empty string if none>",
  "all_text": "<every overlaid line, in reading order, joined with ' / '. empty string if none>",
  "has_text": <true ONLY if you can clearly read actual overlaid text, false otherwise>,
  "confidence": <0-100: how sure you are that every transcribed word is genuinely printed on the image. Use a LOW number if you are guessing>
}`;

const MEDIA_TYPES: Record<string, "image/jpeg" | "image/png" | "image/gif" | "image/webp"> = {
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
  "image/png": "image/png",
  "image/gif": "image/gif",
  "image/webp": "image/webp",
};

const MODEL = "claude-sonnet-4-20250514";

let _anthropic: Anthropic | null = null;
function anthropic(): Anthropic {
  if (!_anthropic) _anthropic = new Anthropic();
  return _anthropic;
}

export type CreativeCopyResult = {
  adId: string;
  onImageText: string;
  captionText: string;
  model: string | null;
  extractedAt: string | null;
  cached: boolean;
};

type StoredRow = {
  ad_id: string;
  on_image_text: string | null;
  caption_text: string | null;
  model: string | null;
  extracted_at: string;
};

function shapeStored(row: StoredRow): CreativeCopyResult {
  return {
    adId: row.ad_id,
    onImageText: row.on_image_text || "",
    captionText: row.caption_text || "",
    model: row.model || null,
    extractedAt: row.extracted_at || null,
    cached: true,
  };
}

async function readWordsOnImage(imageUrl: string): Promise<string> {
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    throw new Error(`Could not load creative image (${imgRes.status})`);
  }
  const contentType = (imgRes.headers.get("content-type") || "image/jpeg")
    .split(";")[0]
    .trim()
    .toLowerCase();
  // ONLY read real still images. A video creative (video/mp4, etc.) has no single
  // frame to transcribe — if we forced it through as a jpeg the model would
  // invent plausible-sounding copy ("Unlock your potential", "Shop now") that
  // appears NOWHERE in the account. That fabrication is exactly what destroys
  // trust, so we bail out and store empty rather than guess.
  const mediaType = MEDIA_TYPES[contentType];
  if (!mediaType) return "";
  const base64Data = Buffer.from(await imgRes.arrayBuffer()).toString("base64");

  const response = await anthropic().messages.create({
    model: MODEL,
    max_tokens: 400,
    system: CREATIVE_COPY_SYSTEM,
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mediaType, data: base64Data } },
          { type: "text", text: "Transcribe the overlaid text on this ad. Return JSON only." },
        ],
      },
    ],
  });

  const textContent = response.content.find((c) => c.type === "text");
  if (!textContent || textContent.type !== "text") return "";

  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith("```")) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
  }
  try {
    const parsed = JSON.parse(jsonStr);
    if (parsed && parsed.has_text === false) return "";
    // Drop low-confidence reads to empty rather than risk storing invented copy.
    // The model self-reports how sure it is the words are genuinely printed; a
    // shaky read (anything under 70) is treated as "no readable text".
    const confidence = Number(parsed?.confidence);
    if (Number.isFinite(confidence) && confidence < 70) return "";
    return String(parsed.all_text || parsed.hook || "").trim();
  } catch {
    // A non-JSON reply means the model wandered off the format — never trust its
    // free text as real ad copy. Store empty instead of a fabricated string.
    return "";
  }
}

export type ExtractInput = {
  adId: string;
  imageUrl?: string | null;
  clientKey?: string | null;
  captionText?: string | null;
};

// Returns the cached copy if present; otherwise reads the image, stores it, and
// returns it. `force` re-reads even if cached.
export async function getOrExtractCreativeCopy(
  input: ExtractInput,
  opts: { force?: boolean } = {}
): Promise<CreativeCopyResult> {
  const db = getServiceSupabase();
  const adId = String(input.adId || "").trim();
  if (!adId) throw new Error("Missing adId");

  const imageUrl = String(input.imageUrl || "").trim();
  const clientKey = input.clientKey ? String(input.clientKey).trim() : null;
  const captionText = input.captionText ? String(input.captionText).trim() : "";

  if (!opts.force) {
    const { data: existing } = await db
      .from("ad_creative_copy")
      .select("ad_id,on_image_text,caption_text,model,extracted_at")
      .eq("ad_id", adId)
      .maybeSingle();
    if (existing) return shapeStored(existing as StoredRow);
  }

  // No image to read — record the caption (if any) so we stop retrying.
  if (!imageUrl) {
    await db
      .from("ad_creative_copy")
      .upsert(
        { ad_id: adId, client_key: clientKey, image_url: null, on_image_text: "", caption_text: captionText, model: null },
        { onConflict: "ad_id" }
      );
    return { adId, onImageText: "", captionText, model: null, extractedAt: null, cached: false };
  }

  const onImageText = await readWordsOnImage(imageUrl);
  await db
    .from("ad_creative_copy")
    .upsert(
      { ad_id: adId, client_key: clientKey, image_url: imageUrl, on_image_text: onImageText, caption_text: captionText, model: MODEL },
      { onConflict: "ad_id" }
    );

  return { adId, onImageText, captionText, model: MODEL, extractedAt: new Date().toISOString(), cached: false };
}

// Given a roster of ads, returns the ad_ids that have NOT been read yet.
export async function findUnreadAdIds(adIds: string[]): Promise<Set<string>> {
  const db = getServiceSupabase();
  const unique = Array.from(new Set(adIds.filter(Boolean)));
  const known = new Set<string>();
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    const { data } = await db.from("ad_creative_copy").select("ad_id").in("ad_id", chunk);
    (data || []).forEach((r: { ad_id: string }) => known.add(r.ad_id));
  }
  return new Set(unique.filter((id) => !known.has(id)));
}
