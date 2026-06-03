// Pluggable image-generation provider abstraction for the Variations Factory.
//
// Every provider implements a single function:
//   generateImage(prompt, referenceImageUrl?) -> { bytes, contentType, costUsd }
//
// The default provider is OpenAI Images (gpt-image-1). To swap in Higgsfield or
// any other model later, add a new entry to PROVIDERS keyed by its id and set
// `provider` in the Variations Factory settings — no engine changes needed.

export type GeneratedImage = {
  bytes: Buffer;
  contentType: string; // e.g. "image/png"
  // Best-effort USD cost of this single generation (for the ai_usage meter).
  costUsd: number;
};

export type ImageProvider = {
  id: string;
  // Throws a clear, actionable Error if its credential is missing — never a
  // raw crash. Returns image bytes ready to upload to Storage.
  generateImage(prompt: string, referenceImageUrl?: string | null): Promise<GeneratedImage>;
};

// ---------------------------------------------------------------------------
// OpenAI Images (gpt-image-1)
// ---------------------------------------------------------------------------
// gpt-image-1 supports both text->image (/v1/images/generations) and
// image+text->image edits (/v1/images/edits). When we have a reference image of
// the winning ad we use the edits endpoint so the model keeps the subject and
// layout and only changes what the prompt asks for. With no reference we fall
// back to generations.
//
// Pricing note: gpt-image-1 is billed per output image by quality/size. A
// 1024x1024 "medium" image is roughly $0.04. We record a flat per-image
// estimate against the AI budget; this is an ESTIMATE, not an exact invoice.
const OPENAI_IMAGE_MODEL = "gpt-image-1";
const OPENAI_IMAGE_SIZE = "1024x1024";
const OPENAI_IMAGE_QUALITY = "medium";
const OPENAI_EST_COST_PER_IMAGE = 0.04;

const openaiProvider: ImageProvider = {
  id: "openai",
  async generateImage(prompt, referenceImageUrl) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error(
        "OPENAI_API_KEY not set — add it to the Vercel project env to enable image generation."
      );
    }

    let res: Response;
    if (referenceImageUrl) {
      // image edit: download the reference, send as multipart form.
      const refRes = await fetch(referenceImageUrl);
      if (!refRes.ok) {
        throw new Error(`Could not load reference image (${refRes.status})`);
      }
      const refType = (refRes.headers.get("content-type") || "image/png")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const refBuf = Buffer.from(await refRes.arrayBuffer());

      const form = new FormData();
      form.append("model", OPENAI_IMAGE_MODEL);
      form.append("prompt", prompt);
      form.append("size", OPENAI_IMAGE_SIZE);
      form.append("quality", OPENAI_IMAGE_QUALITY);
      form.append(
        "image",
        new Blob([new Uint8Array(refBuf)], { type: refType }),
        `reference.${extFor(refType)}`
      );

      res = await fetch("https://api.openai.com/v1/images/edits", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      res = await fetch("https://api.openai.com/v1/images/generations", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: OPENAI_IMAGE_MODEL,
          prompt,
          size: OPENAI_IMAGE_SIZE,
          quality: OPENAI_IMAGE_QUALITY,
          n: 1,
        }),
      });
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`OpenAI image generation failed (${res.status}): ${detail.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
    };
    const first = json.data?.[0];
    if (!first) throw new Error("OpenAI returned no image data");

    let bytes: Buffer;
    if (first.b64_json) {
      bytes = Buffer.from(first.b64_json, "base64");
    } else if (first.url) {
      const imgRes = await fetch(first.url);
      if (!imgRes.ok) throw new Error(`Could not download generated image (${imgRes.status})`);
      bytes = Buffer.from(await imgRes.arrayBuffer());
    } else {
      throw new Error("OpenAI image response had neither b64_json nor url");
    }

    // gpt-image-1 returns PNG.
    return { bytes, contentType: "image/png", costUsd: OPENAI_EST_COST_PER_IMAGE };
  },
};

function extFor(contentType: string): string {
  if (contentType.includes("png")) return "png";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("gif")) return "gif";
  return "jpg";
}

// Registry of available providers. Add Higgsfield / others here.
const PROVIDERS: Record<string, ImageProvider> = {
  openai: openaiProvider,
};

// Returns the provider for the given id, falling back to OpenAI for an unknown
// id (so a stale settings value never hard-crashes the engine).
export function getProvider(id: string): ImageProvider {
  return PROVIDERS[id] ?? openaiProvider;
}
