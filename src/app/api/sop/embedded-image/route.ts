/**
 * Inline image upload for the SOP editor.
 *
 *   POST /api/sop/embedded-image  (multipart/form-data)
 *     file: image binary (required)
 *     slug: optional SOP slug to group storage paths (defaults to "_orphan")
 *
 * Admins only. Uploads to the `sops` bucket under embedded/{slug}/...,
 * returns a long-lived signed URL the editor inserts as <img src>.
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { getServiceSupabase } from "@/lib/supabase";
import { SOPS_STORAGE_BUCKET } from "@/lib/sop/data";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // 5 MB
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days; Supabase signed-url max is ~1 year

const ALLOWED_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

export async function POST(req: NextRequest): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "admin role required" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  const slug = (form.get("slug") as string | null)?.trim() || "_orphan";
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file is required" }, { status: 400 });
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { error: `image too large (max ${MAX_IMAGE_BYTES / 1024 / 1024} MB)` },
      { status: 413 }
    );
  }
  const mime = file.type || "application/octet-stream";
  if (!ALLOWED_MIME.has(mime)) {
    return NextResponse.json({ error: `unsupported image type: ${mime}` }, { status: 400 });
  }

  const ext = mime === "image/jpeg" ? "jpg"
    : mime === "image/svg+xml" ? "svg"
    : mime.split("/")[1];

  const safeSlug = slug.replace(/[^a-z0-9-]/gi, "-").toLowerCase().slice(0, 80) || "_orphan";
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const path = `embedded/${safeSlug}/${filename}`;

  const db = getServiceSupabase();
  const buffer = await file.arrayBuffer();
  const { error: uploadErr } = await db.storage.from(SOPS_STORAGE_BUCKET).upload(path, buffer, {
    contentType: mime,
    upsert: false,
  });
  if (uploadErr) {
    console.error("[api/sop/embedded-image] upload failed:", uploadErr.message);
    return NextResponse.json({ error: uploadErr.message }, { status: 500 });
  }

  const { data, error: signErr } = await db.storage
    .from(SOPS_STORAGE_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (signErr || !data?.signedUrl) {
    console.error("[api/sop/embedded-image] sign failed:", signErr?.message);
    return NextResponse.json({ error: "failed to sign URL" }, { status: 500 });
  }

  return NextResponse.json({ url: data.signedUrl, path });
}
