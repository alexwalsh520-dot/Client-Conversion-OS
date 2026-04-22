// POST /api/followup/media/upload
// Accepts multipart form-data { file }, uploads to Supabase Storage bucket
// `followup-memes` (public), returns the public URL the variant can use.

import { NextRequest, NextResponse } from 'next/server';
import { getServiceSupabase } from '@/lib/supabase';

export const runtime = 'nodejs';
export const maxDuration = 60;

const BUCKET = 'followup-memes';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'audio/mpeg',
  'audio/mp4',
  'audio/ogg',
]);

async function ensureBucket(sb: ReturnType<typeof getServiceSupabase>) {
  const { data: buckets } = await sb.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) return;
  const { error } = await sb.storage.createBucket(BUCKET, {
    public: true,
    allowedMimeTypes: [...ALLOWED_MIME],
    fileSizeLimit: MAX_BYTES,
  });
  if (error && !error.message.toLowerCase().includes('already')) {
    throw new Error(`create bucket: ${error.message}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const sb = getServiceSupabase();
    await ensureBucket(sb);

    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'file field required' }, { status: 400 });
    }
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'file exceeds 5MB' }, { status: 413 });
    }
    if (file.type && !ALLOWED_MIME.has(file.type)) {
      return NextResponse.json({ error: `unsupported type ${file.type}` }, { status: 415 });
    }

    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}.${ext}`;
    const buf = Buffer.from(await file.arrayBuffer());

    const { error } = await sb.storage.from(BUCKET).upload(path, buf, {
      contentType: file.type || 'application/octet-stream',
      cacheControl: '3600',
      upsert: false,
    });
    if (error) throw new Error(`upload: ${error.message}`);

    const { data } = sb.storage.from(BUCKET).getPublicUrl(path);
    return NextResponse.json({ url: data.publicUrl, path });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
