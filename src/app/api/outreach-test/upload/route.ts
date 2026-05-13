import { NextRequest } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

export async function PUT(req: NextRequest) {
  const url = new URL(req.url);
  const runId = url.searchParams.get('runId');
  const name = url.searchParams.get('name');

  if (!runId || !name) {
    return Response.json({ error: 'Missing runId or name query param' }, { status: 400 });
  }

  const tmpDir = join(tmpdir(), `outreach-test-${runId}`);
  await mkdir(tmpDir, { recursive: true });

  const buffer = Buffer.from(await req.arrayBuffer());
  const filePath = join(tmpDir, name);
  await writeFile(filePath, buffer);

  console.log(`[OutreachTest] Saved ${name} (${buffer.length} bytes) → ${filePath}`);

  return Response.json({ ok: true, name, size: buffer.length });
}
