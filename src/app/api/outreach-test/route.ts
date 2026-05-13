import { NextRequest } from 'next/server';
import { rm, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getTemplate, createLead, generateSlug } from '@/lib/super-doc-db';
import type { SuperDocTemplateContent } from '@/lib/super-doc-types';

const PARALLEL_BATCH_SIZE = 3;

const BUNNY_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID!;
const BUNNY_API_KEY = process.env.BUNNY_STREAM_API_KEY!;

console.log('[OutreachRun] Env check at startup:');
console.log(`  BUNNY_STREAM_LIBRARY_ID = ${BUNNY_LIBRARY_ID || '(MISSING)'}`);
console.log(`  BUNNY_STREAM_API_KEY    = ${redact(BUNNY_API_KEY)}`);
console.log(`  PARALLEL_BATCH_SIZE     = ${PARALLEL_BATCH_SIZE}`);

interface Lead {
  first_name: string;
  last_name: string;
  email: string;
  lead_type: string;
}

function redact(key: string): string {
  if (!key) return '(MISSING)';
  if (key.length < 8) return '***';
  return key.slice(0, 4) + '...' + key.slice(-4);
}

async function safeResponseParse(res: Response, label: string) {
  const text = await res.text();
  console.log(`[${label}] ${res.status} ${res.statusText} — body: ${text.slice(0, 2000)}`);
  try {
    return { text, json: JSON.parse(text) as Record<string, unknown> };
  } catch {
    return { text, json: null };
  }
}

function sendEvent(
  controller: ReadableStreamDefaultController,
  encoder: TextEncoder,
  data: object,
) {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
}

function parseCSV(text: string): Lead[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
  const required = ['first_name', 'last_name', 'email', 'lead_type'];
  for (const col of required) {
    if (!headers.includes(col)) throw new Error(`Missing required column: ${col}`);
  }

  const leads: Lead[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const values = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] || '';
    });
    leads.push({
      first_name: row.first_name,
      last_name: row.last_name,
      email: row.email,
      lead_type: row.lead_type,
    });
  }

  return leads;
}

async function uploadToBunny(
  videoPath: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const createUrl = `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`;
  console.log(`[Bunny] POST ${createUrl} — title: "${firstName} ${lastName}"`);

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      AccessKey: BUNNY_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title: `${firstName} ${lastName}` }),
  });

  const create = await safeResponseParse(createRes, 'Bunny Create');

  if (!createRes.ok) {
    throw new Error(`Bunny create failed (${createRes.status}): ${create.text.slice(0, 500)}`);
  }
  if (!create.json) {
    throw new Error(`Bunny create returned non-JSON: ${create.text.slice(0, 500)}`);
  }

  const guid = create.json.guid as string;
  if (!guid) {
    throw new Error(`Bunny create missing guid: ${create.text.slice(0, 500)}`);
  }

  const uploadUrl = `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${guid}`;
  const videoBuffer = await readFile(videoPath);
  console.log(`[Bunny] PUT ${uploadUrl} — ${videoBuffer.length} bytes`);

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { AccessKey: BUNNY_API_KEY },
    body: videoBuffer,
  });

  const upload = await safeResponseParse(uploadRes, 'Bunny Upload');

  if (!uploadRes.ok) {
    throw new Error(`Bunny upload failed (${uploadRes.status}): ${upload.text.slice(0, 500)}`);
  }

  const embedUrl = `https://iframe.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${guid}`;
  console.log(`[Bunny] Done → ${embedUrl}`);
  return embedUrl;
}

async function createSuperDocLead(
  firstName: string,
  lastName: string,
  email: string,
  leadType: string,
  videoUrl: string,
  templateContent: SuperDocTemplateContent,
): Promise<string> {
  const slug = generateSlug(firstName, lastName);
  const baseUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000';

  await createLead({
    slug,
    first_name: firstName,
    last_name: lastName,
    email,
    lead_type: leadType,
    video_url: videoUrl,
    content_snapshot: templateContent,
  });

  const pageUrl = `${baseUrl}/super-doc/${slug}`;
  console.log(`[SuperDoc] Created lead page: ${pageUrl}`);
  return pageUrl;
}

export async function POST(req: NextRequest) {
  let body: { runId: string; csvText: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId, csvText } = body;
  if (!runId || !csvText) {
    return Response.json({ error: 'Missing runId or csvText' }, { status: 400 });
  }

  let leads: Lead[];
  try {
    leads = parseCSV(csvText);
  } catch (e: unknown) {
    return Response.json({ error: e instanceof Error ? e.message : 'CSV parse error' }, { status: 400 });
  }

  const template = await getTemplate();
  if (!template) {
    return Response.json({ error: 'Super Doc template not initialized. POST /api/super-doc/setup first.' }, { status: 400 });
  }

  const tmpDir = join(tmpdir(), `outreach-test-${runId}`);

  let files: string[];
  try {
    files = await readdir(tmpDir);
  } catch {
    return Response.json({ error: `No uploads found for run ${runId}. Upload videos first.` }, { status: 400 });
  }

  const videoMap = new Map<string, string>();
  for (const f of files) {
    const key = f.replace(/\.mp4$/i, '').toLowerCase();
    videoMap.set(key, join(tmpDir, f));
    console.log(`[OutreachRun] Found uploaded video: ${key} → ${join(tmpDir, f)}`);
  }

  console.log(`[OutreachRun] Run ${runId} — ${leads.length} leads, ${videoMap.size} videos, parallel: ${PARALLEL_BATCH_SIZE}`);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const work: { index: number; lead: Lead; videoPath: string }[] = [];

        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i];
          const videoKey = `${lead.first_name}-${lead.last_name}`.toLowerCase();
          const videoPath = videoMap.get(videoKey);

          if (!videoPath) {
            sendEvent(controller, encoder, {
              leadIndex: i,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'failed',
              error: `No matching video for "${lead.first_name} ${lead.last_name}" (expected ${videoKey}.mp4)`,
            });
            continue;
          }

          work.push({ index: i, lead, videoPath });
        }

        async function processLead(item: { index: number; lead: Lead; videoPath: string }) {
          const { index, lead, videoPath } = item;
          try {
            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'uploading',
            });

            const embedUrl = await uploadToBunny(videoPath, lead.first_name, lead.last_name);

            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'generating',
            });

            const pageUrl = await createSuperDocLead(
              lead.first_name,
              lead.last_name,
              lead.email,
              lead.lead_type,
              embedUrl,
              template!.content,
            );

            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'completed',
              gammaUrl: pageUrl,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            console.error(`[OutreachRun] Lead "${lead.first_name} ${lead.last_name}" failed:`, msg);
            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'failed',
              error: msg,
            });
          }
        }

        const executing = new Set<Promise<void>>();

        for (let i = 0; i < work.length; i++) {
          const promise = processLead(work[i]).finally(() => executing.delete(promise));
          executing.add(promise);

          if (executing.size >= PARALLEL_BATCH_SIZE) {
            await Promise.race(executing);
          }
        }

        await Promise.all(executing);

        sendEvent(controller, encoder, { status: 'done' });
      } catch (e) {
        console.error('[OutreachRun] Fatal error:', e);
        sendEvent(controller, encoder, { status: 'error', error: 'Processing failed' });
      } finally {
        try {
          await rm(tmpDir, { recursive: true, force: true });
          console.log(`[OutreachRun] Cleaned up ${tmpDir}`);
        } catch (e) {
          console.error('[OutreachRun] Cleanup failed:', e);
        }
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
