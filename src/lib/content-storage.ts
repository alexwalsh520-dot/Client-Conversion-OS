// Store reel media permanently in R2 so it never breaks when Meta's CDN urls expire.
// Uses the same presigned-PUT mechanism as the rest of the app (src/lib/r2.ts).
import { createPresignedPutUrl, getR2Config } from "@/lib/r2";

export function r2Configured(): boolean {
  try { getR2Config(); return true; } catch { return false; }
}

/** PUT a buffer to R2 at `key`; returns the permanent public URL (or null on failure). */
export async function putToR2(key: string, bytes: ArrayBuffer | Buffer, contentType: string): Promise<string | null> {
  try {
    const { uploadUrl, publicUrl, headers } = createPresignedPutUrl({ key, contentType });
    const res = await fetch(uploadUrl, { method: "PUT", headers, body: bytes as BodyInit });
    return res.ok ? publicUrl : null;
  } catch {
    return null;
  }
}

/** Download a remote thumbnail and store it durably. Returns the R2 url or null. */
export async function storeThumb(slug: string, mediaId: string, thumbUrl: string | null): Promise<string | null> {
  if (!thumbUrl || !r2Configured()) return null;
  try {
    const res = await fetch(thumbUrl, { cache: "no-store" });
    if (!res.ok) return null;
    const ct = (res.headers.get("content-type") || "image/jpeg").split(";")[0];
    const ext = ct.includes("png") ? "png" : "jpg";
    return putToR2(`content/${slug}/${mediaId}-thumb.${ext}`, await res.arrayBuffer(), ct);
  } catch { return null; }
}
