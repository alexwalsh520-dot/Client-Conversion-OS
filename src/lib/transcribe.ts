// Pluggable speech-to-text for reel audio. Default provider = Groq (serves OpenAI
// Whisper large-v3: top accuracy, fastest, cheapest). Swap PROVIDER/MODEL to move to
// gpt-4o-transcribe / AssemblyAI etc. later — callers don't change.
// No-ops cleanly (returns {ok:false, reason:'no_key'}) until GROQ_API_KEY is set.

const GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODEL = process.env.GROQ_TRANSCRIBE_MODEL?.trim() || "whisper-large-v3";

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  reason?: string;
}

export function transcriberConfigured(): boolean {
  return !!process.env.GROQ_API_KEY?.trim();
}

/** Transcribe the audio of a remote video/audio URL. Fetches the file then sends to Groq. */
export async function transcribeFromUrl(url: string): Promise<TranscribeResult> {
  const key = process.env.GROQ_API_KEY?.trim();
  if (!key) return { ok: false, reason: "no_key" };
  if (!url) return { ok: false, reason: "no_url" };
  try {
    const media = await fetch(url, { cache: "no-store" });
    if (!media.ok) return { ok: false, reason: `media ${media.status}` };
    const bytes = await media.arrayBuffer();
    // Groq free tier caps at 25MB; skip oversized files rather than erroring the batch.
    if (bytes.byteLength > 24 * 1024 * 1024) return { ok: false, reason: "too_large" };

    const form = new FormData();
    form.append("file", new Blob([bytes], { type: "video/mp4" }), "reel.mp4");
    form.append("model", MODEL);
    form.append("response_format", "text");
    form.append("temperature", "0");
    // Reduce Whisper's silence/music hallucinations.
    form.append("prompt", "Instagram fitness reel. Spoken words only.");

    const res = await fetch(GROQ_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return { ok: false, reason: `groq ${res.status}: ${t.slice(0, 160)}` };
    }
    const text = (await res.text()).trim();
    return { ok: true, text };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "error" };
  }
}
