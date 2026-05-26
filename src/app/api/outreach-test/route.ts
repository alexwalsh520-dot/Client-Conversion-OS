import { NextRequest } from 'next/server';
import { rm, readFile, readdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { getTemplate, createLead, generateSlug, getLeadBySlug } from '@/lib/super-doc-db';
import { deliverSuperDocLead, type SuperDocDeliveryResult } from '@/lib/super-doc-delivery';
import { capitalizeNamePart, formatFullName } from '@/lib/super-doc-name';
import type { SuperDocTemplateContent } from '@/lib/super-doc-types';
import { getTemplateContentForLeadType, stripVariantTemplates } from '@/lib/super-doc-template-variants';
import { createVideoJob } from '@/lib/super-doc-video-automation';
import {
  buildSuperDocRoutePlan,
  getInstagramUrl,
  getSuperDocSegment,
  normalizeInstagramHandle,
} from '@/lib/super-doc-routing';

const PARALLEL_BATCH_SIZE = 3;
const FALLBACK_VIDEO_URL = 'about:blank';

const BUNNY_LIBRARY_ID = process.env.BUNNY_STREAM_LIBRARY_ID || '';
const BUNNY_API_KEY = process.env.BUNNY_STREAM_API_KEY || '';

console.log('[OutreachRun] Env check at startup:');
console.log(`  BUNNY_STREAM_LIBRARY_ID = ${BUNNY_LIBRARY_ID || '(MISSING)'}`);
console.log(`  BUNNY_STREAM_API_KEY    = ${redact(BUNNY_API_KEY)}`);
console.log(`  PARALLEL_BATCH_SIZE     = ${PARALLEL_BATCH_SIZE}`);

interface Lead {
  first_name: string;
  last_name: string;
  email: string;
  lead_type: string;
  instagram_handle?: string;
  instagram_url?: string;
  video_url?: string;
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

function normalizeKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/\.mp4$/i, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function leadVideoKey(lead: Lead): string {
  return normalizeKey(`${lead.first_name}-${lead.last_name || ''}`);
}

function normalizeHeader(value: string): string {
  return value.toLowerCase().replace(/[\s_-]+/g, '').trim();
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      cell += '"';
      i += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === ',' && !inQuotes) {
      row.push(cell.trim());
      cell = '';
      continue;
    }

    if ((char === '\n' || char === '\r') && !inQuotes) {
      if (char === '\r' && next === '\n') i += 1;
      row.push(cell.trim());
      if (row.some(Boolean)) rows.push(row);
      row = [];
      cell = '';
      continue;
    }

    cell += char;
  }

  row.push(cell.trim());
  if (row.some(Boolean)) rows.push(row);
  return rows;
}

function parseCSV(text: string): Lead[] {
  const rows = parseCsvRows(text);
  if (rows.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const normalizedHeaders = rows[0].map(normalizeHeader);
  const colMap: Record<string, number> = {};

  normalizedHeaders.forEach((h, i) => {
    if (h === 'firstname' || h === 'first' || h === 'name') colMap.first_name = i;
    if (h === 'lastname' || h === 'last') colMap.last_name = i;
    if (h === 'email' || h === 'emailaddress') colMap.email = i;
    if (h === 'leadtype' || h === 'type' || h === 'segment') colMap.lead_type = i;
    if (
      h === 'instagramhandle' ||
      h === 'instagramusername' ||
      h === 'ighandle' ||
      h === 'igusername' ||
      h === 'ig'
    ) colMap.instagram_handle = i;
    if (
      h === 'instagramurl' ||
      h === 'instagramlink' ||
      h === 'igurl' ||
      h === 'iglink'
    ) colMap.instagram_url = i;
    if (
      h === 'videourl' ||
      h === 'video' ||
      h === 'bunnyurl' ||
      h === 'loomurl'
    ) colMap.video_url = i;
  });

  const required = ['first_name', 'email', 'lead_type'];
  for (const col of required) {
    if (colMap[col] === undefined) throw new Error(`Missing required column: ${col}`);
  }

  const leads: Lead[] = [];
  for (let i = 1; i < rows.length; i++) {
    const values = rows[i];
    if (!values.some(Boolean)) continue;
    leads.push({
      first_name: capitalizeNamePart(values[colMap.first_name] || ''),
      last_name: colMap.last_name === undefined ? '' : capitalizeNamePart(values[colMap.last_name] || ''),
      email: values[colMap.email] || '',
      lead_type: values[colMap.lead_type] || '',
      instagram_handle: colMap.instagram_handle === undefined ? '' : values[colMap.instagram_handle] || '',
      instagram_url: colMap.instagram_url === undefined ? '' : values[colMap.instagram_url] || '',
      video_url: colMap.video_url === undefined ? '' : values[colMap.video_url] || '',
    });
  }

  return leads;
}

function firstNameOnlyContent<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/\s*\{\{last_name\}\}/g, '')
      .replace(/\{\{last_name\}\}\s*/g, '')
      .replace(/[ \t]{2,}/g, ' ') as T;
  }
  if (Array.isArray(value)) {
    return value.map(item => firstNameOnlyContent(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, firstNameOnlyContent(item)]),
    ) as T;
  }
  return value;
}

async function uploadToBunny(
  videoPath: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const createUrl = `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`;
  const title = formatFullName(firstName, lastName);
  console.log(`[Bunny] POST ${createUrl} — title: "${title}"`);

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      AccessKey: BUNNY_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
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

function isBunnyEmbedUrl(value: string) {
  return /^https:\/\/iframe\.mediadelivery\.net\/embed\//i.test(value.trim());
}

async function uploadRemoteVideoToBunny(
  videoUrl: string,
  firstName: string,
  lastName: string,
): Promise<string> {
  const createUrl = `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos`;
  const title = formatFullName(firstName, lastName);
  console.log(`[Bunny] POST ${createUrl} — remote title: "${title}"`);

  const createRes = await fetch(createUrl, {
    method: 'POST',
    headers: {
      AccessKey: BUNNY_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });

  const create = await safeResponseParse(createRes, 'Bunny Remote Create');
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

  const sourceRes = await fetch(videoUrl);
  if (!sourceRes.ok) {
    const text = await sourceRes.text().catch(() => '');
    throw new Error(`Video download failed (${sourceRes.status}): ${text.slice(0, 300)}`);
  }

  const videoBuffer = Buffer.from(await sourceRes.arrayBuffer());
  const uploadUrl = `https://video.bunnycdn.com/library/${BUNNY_LIBRARY_ID}/videos/${guid}`;
  console.log(`[Bunny] PUT ${uploadUrl} — remote ${videoBuffer.length} bytes`);

  const uploadRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { AccessKey: BUNNY_API_KEY },
    body: videoBuffer,
  });

  const upload = await safeResponseParse(uploadRes, 'Bunny Remote Upload');
  if (!uploadRes.ok) {
    throw new Error(`Bunny upload failed (${uploadRes.status}): ${upload.text.slice(0, 500)}`);
  }

  const embedUrl = `https://iframe.mediadelivery.net/embed/${BUNNY_LIBRARY_ID}/${guid}`;
  console.log(`[Bunny] Remote done → ${embedUrl}`);
  return embedUrl;
}

async function createSuperDocLead(
  lead: Lead,
  videoUrl: string,
  templateContent: SuperDocTemplateContent,
  baseUrl: string,
): Promise<{ pageUrl: string; slug: string }> {
  const firstName = capitalizeNamePart(lead.first_name);
  const lastName = capitalizeNamePart(lead.last_name);
  const baseSlug = generateSlug(firstName, lastName).replace(/^-+|-+$/g, '');
  let slug = baseSlug;
  let suffix = 2;

  while (await getLeadBySlug(slug)) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  await createLead({
    slug,
    first_name: firstName,
    last_name: lastName,
    email: lead.email,
    lead_type: lead.lead_type,
    instagram_handle: normalizeInstagramHandle(lead.instagram_handle),
    instagram_url: getInstagramUrl(lead),
    video_url: videoUrl,
    content_snapshot: firstNameOnlyContent(stripVariantTemplates(templateContent)),
  });

  const pageUrl = `${baseUrl}/super-doc/${slug}`;
  console.log(`[SuperDoc] Created lead page: ${pageUrl}`);
  return { pageUrl, slug };
}

function getRequestBaseUrl(req: NextRequest): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host');
  const proto = req.headers.get('x-forwarded-proto') || (host?.includes('localhost') ? 'http' : 'https');

  if (host) return `${proto}://${host}`;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}

function resolveVideoUrl(lead: Lead) {
  const segment = getSuperDocSegment(lead.lead_type);
  const segmentDefault =
    segment === 'agency_tm'
      ? process.env.SUPER_DOC_DEFAULT_AGENCY_TM_VIDEO_URL
      : process.env.SUPER_DOC_DEFAULT_CREATOR_VIDEO_URL;

  return (
    (lead.video_url || '').trim() ||
    (segmentDefault || '').trim() ||
    (process.env.SUPER_DOC_DEFAULT_VIDEO_URL || '').trim() ||
    FALLBACK_VIDEO_URL
  );
}

type OutreachVideoMode = 'existing' | 'queue';

export async function POST(req: NextRequest) {
  let body: {
    runId: string;
    csvText: string;
    testMode?: boolean;
    videoMode?: OutreachVideoMode;
    deferDeliveryUntilVideoReady?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { runId, csvText } = body;
  const testMode = body.testMode !== false;
  const videoMode: OutreachVideoMode = body.videoMode === 'queue' ? 'queue' : 'existing';
  const deferDeliveryUntilVideoReady = body.deferDeliveryUntilVideoReady ?? (videoMode === 'queue');
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
  const baseUrl = getRequestBaseUrl(req);

  let files: string[];
  try {
    files = await readdir(tmpDir);
  } catch {
    files = [];
  }

  const hasUploadedVideos = files.length > 0;
  const hasRemoteVideosToUpload = videoMode === 'existing' && leads.some((lead) => {
    const videoUrl = (lead.video_url || '').trim();
    return videoUrl && !isBunnyEmbedUrl(videoUrl);
  });
  const missingBunnyEnv = [
    !BUNNY_LIBRARY_ID && 'BUNNY_STREAM_LIBRARY_ID',
    !BUNNY_API_KEY && 'BUNNY_STREAM_API_KEY',
  ].filter(Boolean);
  if ((hasUploadedVideos || hasRemoteVideosToUpload) && missingBunnyEnv.length > 0) {
    return Response.json(
      { error: `Missing Bunny keys: ${missingBunnyEnv.join(', ')}` },
      { status: 500 },
    );
  }

  const videoMap = new Map<string, string>();
  for (const f of files) {
    const key = normalizeKey(f);
    videoMap.set(key, join(tmpDir, f));
    console.log(`[OutreachRun] Found uploaded video: ${key} → ${join(tmpDir, f)}`);
  }

  console.log(`[OutreachRun] Run ${runId} — ${leads.length} leads, ${videoMap.size} uploaded videos, test mode: ${testMode}, video mode: ${videoMode}, defer delivery: ${deferDeliveryUntilVideoReady}, parallel: ${PARALLEL_BATCH_SIZE}`);

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      try {
        const work: { index: number; lead: Lead; videoPath?: string }[] = [];

        for (let i = 0; i < leads.length; i++) {
          const lead = leads[i];
          const videoKey = leadVideoKey(lead);
          const videoPath = videoMap.get(videoKey);

          if (hasUploadedVideos && !videoPath) {
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

        async function processLead(item: { index: number; lead: Lead; videoPath?: string }) {
          const { index, lead, videoPath } = item;
          let pageUrl = '';
          let slug = '';
          let videoJobId = '';
          try {
            const shouldQueueVideo = videoMode === 'queue' && !videoPath && !(lead.video_url || '').trim();
            let embedUrl = shouldQueueVideo ? FALLBACK_VIDEO_URL : resolveVideoUrl(lead);

            if (videoPath) {
              sendEvent(controller, encoder, {
                leadIndex: index,
                firstName: lead.first_name,
                lastName: lead.last_name,
                status: 'uploading',
              });

              embedUrl = await uploadToBunny(videoPath, lead.first_name, lead.last_name);
            } else if (videoMode === 'existing' && (lead.video_url || '').trim() && !isBunnyEmbedUrl(lead.video_url || '')) {
              const remoteVideoUrl = (lead.video_url || '').trim();
              sendEvent(controller, encoder, {
                leadIndex: index,
                firstName: lead.first_name,
                lastName: lead.last_name,
                status: 'uploading',
              });

              embedUrl = await uploadRemoteVideoToBunny(
                remoteVideoUrl,
                lead.first_name,
                lead.last_name,
              );
            }

            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'generating',
            });

            const selectedTemplate = getTemplateContentForLeadType(template!.content, lead.lead_type);
            const createdDoc = await createSuperDocLead(lead, embedUrl, selectedTemplate, baseUrl);
            pageUrl = createdDoc.pageUrl;
            slug = createdDoc.slug;
            const routePlanPreview = buildSuperDocRoutePlan({
              lead,
              pageUrl,
              videoUrl: embedUrl,
              dryRun: testMode,
            });

            if (shouldQueueVideo) {
              const videoJob = await createVideoJob({
                runId,
                leadSlug: slug,
                firstName: lead.first_name,
                lastName: lead.last_name,
                email: lead.email,
                leadType: lead.lead_type,
                instagramHandle: lead.instagram_handle,
                metadata: {
                  page_url: pageUrl,
                  test_mode: testMode,
                  first_10_seconds_rule: 'replace 0-6s and 6-10s, then keep original video from 10s onward',
                  delivery_deferred: deferDeliveryUntilVideoReady,
                },
              });
              videoJobId = videoJob.id;

              sendEvent(controller, encoder, {
                leadIndex: index,
                firstName: lead.first_name,
                lastName: lead.last_name,
                status: 'video_queued',
                pageUrl,
                slug,
                videoJobId,
                routePlan: routePlanPreview,
              });

              if (deferDeliveryUntilVideoReady) {
                return;
              }
            }

            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'routing',
              pageUrl,
              slug,
              routePlan: routePlanPreview,
            });

            const routeResult: SuperDocDeliveryResult = await deliverSuperDocLead({
              lead,
              pageUrl,
              videoUrl: embedUrl,
              runId,
              testMode,
            });

            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'completed',
              pageUrl,
              gammaUrl: pageUrl,
              slug,
              routePlan: routeResult.routePlan,
              routeResult,
            });
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Unknown error';
            console.error(`[OutreachRun] Lead "${lead.first_name} ${lead.last_name}" failed:`, msg);
            sendEvent(controller, encoder, {
              leadIndex: index,
              firstName: lead.first_name,
              lastName: lead.last_name,
              status: 'failed',
              pageUrl: pageUrl || undefined,
              slug: slug || undefined,
              videoJobId: videoJobId || undefined,
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
