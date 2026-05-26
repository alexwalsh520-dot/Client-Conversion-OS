#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });
dotenv.config({ path: path.resolve(process.cwd(), '.env.production.local') });
dotenv.config();

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const keepTemp = args.has('--keep-temp');
const jobArgIndex = process.argv.indexOf('--job');
const jobId = jobArgIndex >= 0 ? process.argv[jobArgIndex + 1] : '';
const limitArgIndex = process.argv.indexOf('--limit');
const limit = Math.max(1, Math.min(25, Number(process.argv[limitArgIndex + 1] || 5)));

const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
const serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
const bunnyLibraryId = clean(process.env.BUNNY_STREAM_LIBRARY_ID);
const bunnyApiKey = clean(process.env.BUNNY_STREAM_API_KEY);
const ffmpegPath = clean(process.env.FFMPEG_PATH) || 'ffmpeg';
const workerSecret = clean(process.env.SUPER_DOC_WORKER_SECRET);
const siteBaseUrl =
  clean(process.env.SUPER_DOC_WORKER_SITE_URL) ||
  clean(process.env.NEXT_PUBLIC_SITE_URL) ||
  (clean(process.env.VERCEL_URL) ? `https://${clean(process.env.VERCEL_URL)}` : '') ||
  'https://client-conversion-os.vercel.app';

function clean(value) {
  return (value || '').trim();
}

function requireEnv(name, value) {
  if (!value) throw new Error(`Missing ${name}`);
}

function supabaseHeaders(extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    ...extra,
  };
}

async function supabaseFetch(pathname, options = {}) {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey);

  const res = await fetch(`${supabaseUrl}/rest/v1/${pathname}`, {
    ...options,
    headers: supabaseHeaders(options.headers),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function getJobs() {
  if (jobId) {
    const rows = await supabaseFetch(
      `super_doc_video_jobs?select=*,template:super_doc_video_templates(*)&id=eq.${encodeURIComponent(jobId)}&limit=1`,
    );
    return rows;
  }

  return supabaseFetch(
    `super_doc_video_jobs?select=*,template:super_doc_video_templates(*)&status=eq.clips_ready&order=created_at.asc&limit=${limit}`,
  );
}

async function updateJob(id, updates) {
  const rows = await supabaseFetch(`super_doc_video_jobs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      ...updates,
      updated_at: new Date().toISOString(),
    }),
  });
  return rows?.[0] || null;
}

async function updateLeadVideo(slug, bunnyEmbedUrl) {
  if (!slug) return;
  await supabaseFetch(`super_doc_leads?slug=eq.${encodeURIComponent(slug)}`, {
    method: 'PATCH',
    body: JSON.stringify({ video_url: bunnyEmbedUrl }),
  });
}

function hasFfmpeg() {
  const result = spawnSync(ffmpegPath, ['-version'], { stdio: 'ignore' });
  return result.status === 0;
}

function runFfmpeg(argsForFfmpeg, label) {
  const result = spawnSync(ffmpegPath, argsForFfmpeg, { stdio: 'inherit' });
  if (result.status !== 0) {
    throw new Error(`${label} failed. Check ffmpeg output above.`);
  }
}

function numeric(value, fallback) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function segmentBaseSource(job) {
  const template = job.template || {};
  const segment = job.segment === 'agency_tm' ? 'AGENCY_TM' : 'CREATOR';
  return (
    clean(template.base_video_source) ||
    clean(process.env[`SUPER_DOC_${segment}_BASE_VIDEO_SOURCE`]) ||
    clean(process.env.SUPER_DOC_BASE_VIDEO_SOURCE)
  );
}

async function sourceToFile(source, outputPath) {
  const value = clean(source);
  if (!value) throw new Error('Missing source file or URL');

  if (value.startsWith('file://')) {
    const filePath = decodeURIComponent(new URL(value).pathname);
    await access(filePath);
    await writeFile(outputPath, await readFile(filePath));
    return;
  }

  if (value.startsWith('/')) {
    await access(value);
    await writeFile(outputPath, await readFile(value));
    return;
  }

  const res = await fetch(value);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Could not download ${value}: ${res.status} ${text.slice(0, 200)}`);
  }
  await writeFile(outputPath, Buffer.from(await res.arrayBuffer()));
}

function normalizedVideoArgs(input, output, options = {}) {
  const argsForFfmpeg = ['-y'];
  if (options.startSeconds !== undefined) argsForFfmpeg.push('-ss', String(options.startSeconds));
  argsForFfmpeg.push('-i', input);
  if (options.durationSeconds !== undefined) argsForFfmpeg.push('-t', String(options.durationSeconds));
  argsForFfmpeg.push(
    '-vf',
    'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p',
    '-af',
    'aresample=48000',
    '-c:v',
    'libx264',
    '-preset',
    'veryfast',
    '-crf',
    '18',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    output,
  );
  return argsForFfmpeg;
}

async function stitchVideo(job, workDir) {
  const template = job.template || {};
  const clip1Start = numeric(template.clip_1_start_seconds, 0);
  const clip1End = numeric(template.clip_1_end_seconds, 6);
  const clip2Start = numeric(template.clip_2_start_seconds, 6);
  const clip2End = numeric(template.clip_2_end_seconds, 10);
  const clip1Duration = clip1End - clip1Start;
  const clip2Duration = clip2End - clip2Start;
  const tailStart = clip2End;

  if (!job.higgsfield_clip_1_url || !job.higgsfield_clip_2_url) {
    throw new Error('Job needs higgsfield_clip_1_url and higgsfield_clip_2_url before editing.');
  }

  const baseSource = segmentBaseSource(job);
  if (!baseSource) {
    throw new Error(`Missing base video source for ${job.segment}. Add it to the video template or SUPER_DOC_BASE_VIDEO_SOURCE.`);
  }

  const basePath = path.join(workDir, 'base.mp4');
  const clip1Path = path.join(workDir, 'clip-1-source.mp4');
  const clip2Path = path.join(workDir, 'clip-2-source.mp4');
  const normClip1 = path.join(workDir, 'clip-1-normalized.mp4');
  const normClip2 = path.join(workDir, 'clip-2-normalized.mp4');
  const normTail = path.join(workDir, 'base-tail-normalized.mp4');
  const concatList = path.join(workDir, 'concat.txt');
  const finalPath = path.join(workDir, `${job.first_name}-${job.last_name || 'lead'}-super-doc.mp4`.replace(/[^a-z0-9.-]+/gi, '-'));

  await sourceToFile(baseSource, basePath);
  await sourceToFile(job.higgsfield_clip_1_url, clip1Path);
  await sourceToFile(job.higgsfield_clip_2_url, clip2Path);

  runFfmpeg(normalizedVideoArgs(clip1Path, normClip1, { durationSeconds: clip1Duration }), 'Normalize clip 1');
  runFfmpeg(normalizedVideoArgs(clip2Path, normClip2, { durationSeconds: clip2Duration }), 'Normalize clip 2');
  runFfmpeg(normalizedVideoArgs(basePath, normTail, { startSeconds: tailStart }), 'Cut base video tail');

  await writeFile(
    concatList,
    [`file '${normClip1}'`, `file '${normClip2}'`, `file '${normTail}'`].join('\n'),
  );

  runFfmpeg(['-y', '-f', 'concat', '-safe', '0', '-i', concatList, '-c', 'copy', finalPath], 'Final stitch');
  return finalPath;
}

async function uploadToBunny(videoPath, title) {
  requireEnv('BUNNY_STREAM_LIBRARY_ID', bunnyLibraryId);
  requireEnv('BUNNY_STREAM_API_KEY', bunnyApiKey);

  const createRes = await fetch(`https://video.bunnycdn.com/library/${bunnyLibraryId}/videos`, {
    method: 'POST',
    headers: {
      AccessKey: bunnyApiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ title }),
  });
  const createText = await createRes.text();
  if (!createRes.ok) throw new Error(`Bunny create failed: ${createRes.status} ${createText.slice(0, 500)}`);
  const created = JSON.parse(createText);
  if (!created.guid) throw new Error(`Bunny create did not return a guid: ${createText.slice(0, 500)}`);

  const uploadRes = await fetch(`https://video.bunnycdn.com/library/${bunnyLibraryId}/videos/${created.guid}`, {
    method: 'PUT',
    headers: { AccessKey: bunnyApiKey },
    body: createReadStream(videoPath),
    duplex: 'half',
  });
  const uploadText = await uploadRes.text();
  if (!uploadRes.ok) throw new Error(`Bunny upload failed: ${uploadRes.status} ${uploadText.slice(0, 500)}`);

  return `https://iframe.mediadelivery.net/embed/${bunnyLibraryId}/${created.guid}`;
}

async function deliverJob(jobIdToDeliver) {
  const res = await fetch(`${siteBaseUrl}/api/super-doc/video/jobs/${jobIdToDeliver}/deliver`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(workerSecret ? { Authorization: `Bearer ${workerSecret}` } : {}),
    },
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Delivery failed after upload: ${res.status} ${text.slice(0, 500)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function processJob(job) {
  const fullName = [job.first_name, job.last_name].filter(Boolean).join(' ');
  const workDir = await mkdtemp(path.join(tmpdir(), `super-doc-video-${job.id}-`));
  console.log(`\n[VideoJob] ${job.id} ${fullName} (${job.segment})`);
  console.log(`[VideoJob] Temp: ${workDir}`);

  try {
    await updateJob(job.id, { status: 'editing', error: null });
    const finalVideoPath = await stitchVideo(job, workDir);
    const bunnyEmbedUrl = await uploadToBunny(finalVideoPath, fullName || `Super Doc ${job.id}`);
    await updateLeadVideo(job.lead_slug, bunnyEmbedUrl);
    await updateJob(job.id, {
      status: 'uploaded',
      final_video_url: bunnyEmbedUrl,
      bunny_embed_url: bunnyEmbedUrl,
      error: null,
    });
    console.log(`[VideoJob] Uploaded and attached: ${bunnyEmbedUrl}`);
    if (job.metadata?.delivery_deferred) {
      console.log(`[VideoJob] Sending to GHL + Smartlead through ${siteBaseUrl}`);
      await deliverJob(job.id);
      console.log('[VideoJob] Delivered to GHL + Smartlead');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateJob(job.id, { status: 'failed', error: message }).catch(() => {});
    throw error;
  } finally {
    if (keepTemp) {
      console.log(`[VideoJob] Keeping temp folder: ${workDir}`);
    } else {
      await rm(workDir, { recursive: true, force: true });
    }
  }
}

async function main() {
  requireEnv('NEXT_PUBLIC_SUPABASE_URL', supabaseUrl);
  requireEnv('SUPABASE_SERVICE_ROLE_KEY', serviceKey);

  const ffmpegReady = hasFfmpeg();
  if (!ffmpegReady) {
    const message = `ffmpeg is not installed or not found at "${ffmpegPath}". Install ffmpeg before stitching videos.`;
    if (!dryRun) throw new Error(message);
    console.log(`[DryRun] ${message}`);
  }

  const jobs = await getJobs();
  console.log(`[VideoWorker] Found ${jobs.length} job${jobs.length === 1 ? '' : 's'}.`);

  for (const job of jobs) {
    console.log(`- ${job.id} | ${job.first_name} ${job.last_name || ''} | ${job.segment} | ${job.status}`);
    if (dryRun) {
      const template = job.template || {};
      console.log(`  clip 1: ${template.clip_1_start_seconds ?? 0}-${template.clip_1_end_seconds ?? 6}s`);
      console.log(`  clip 2: ${template.clip_2_start_seconds ?? 6}-${template.clip_2_end_seconds ?? 10}s`);
      console.log(`  base source: ${segmentBaseSource(job) || '(missing)'}`);
      continue;
    }
    await processJob(job);
  }

  if (dryRun) {
    console.log('[DryRun] No videos were edited, uploaded, or generated.');
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
