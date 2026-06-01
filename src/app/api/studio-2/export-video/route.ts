import { spawn } from "child_process";
import { randomUUID } from "crypto";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import ffmpegPath from "ffmpeg-static";
import { NextRequest, NextResponse } from "next/server";
import { createR2ObjectKey, putR2Object } from "@/lib/r2";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const CANVAS_W = 1080;
const CANVAS_H = 1920;

type ExportSegment = {
  start?: number;
  end?: number | null;
  enabled?: boolean;
};

type NormalizedExportSegment = {
  start: number;
  end: number | null;
  enabled: boolean;
};

type ImageTransformPayload = {
  scale?: number;
  rotate?: number;
  offsetX?: number;
  offsetY?: number;
};

type ExportVideoBody = {
  videoUrl?: string;
  overlayDataUrl?: string;
  segments?: ExportSegment[];
  muted?: boolean;
  volume?: number;
  imageTransform?: ImageTransformPayload;
  filename?: string;
};

export async function POST(req: NextRequest) {
  const workDir = path.join(os.tmpdir(), `studio2-export-${randomUUID()}`);

  try {
    if (!ffmpegPath) {
      return NextResponse.json({ error: "Server video export is missing FFmpeg." }, { status: 500 });
    }

    const body = (await req.json()) as ExportVideoBody;
    const videoUrl = String(body.videoUrl || "");
    if (!isHttpUrl(videoUrl)) {
      return NextResponse.json({ error: "Server export needs a public video URL." }, { status: 400 });
    }

    const overlayBuffer = parseDataUrlPng(body.overlayDataUrl || "");
    const filename = ensureMp4Filename(body.filename || "studio-2-video.mp4");
    const segments = normalizeSegments(body.segments || []);
    const muted = body.muted !== false;
    const volume = clampNumber(Number(body.volume ?? 1), 0, 1);

    await mkdir(workDir, { recursive: true });
    const inputPath = path.join(workDir, "input-video");
    const overlayPath = path.join(workDir, "overlay.png");
    const outputPath = path.join(workDir, "output.mp4");

    const videoBuffer = await fetchVideo(videoUrl);
    await writeFile(inputPath, videoBuffer);
    await writeFile(overlayPath, overlayBuffer);

    const audioWanted = !muted && volume > 0;
    let result: Buffer;
    try {
      await runFfmpeg(ffmpegPath, buildFfmpegArgs({
        inputPath,
        overlayPath,
        outputPath,
        segments,
        imageTransform: body.imageTransform || {},
        includeAudio: audioWanted,
        volume,
      }));
      result = await readFile(outputPath);
    } catch (error) {
      if (!audioWanted) throw error;
      await runFfmpeg(ffmpegPath, buildFfmpegArgs({
        inputPath,
        overlayPath,
        outputPath,
        segments,
        imageTransform: body.imageTransform || {},
        includeAudio: false,
        volume: 0,
      }));
      result = await readFile(outputPath);
    }

    if (!result.length) {
      throw new Error("FFmpeg created an empty MP4.");
    }

    try {
      const key = createR2ObjectKey(filename, "video/mp4").replace("/videos/", "/exports/");
      const uploaded = await putR2Object({ key, body: result, contentType: "video/mp4" });
      const downloadUrl = `/api/studio-2/media/proxy?url=${encodeURIComponent(uploaded.publicUrl)}&download=${encodeURIComponent(filename)}`;

      return NextResponse.json({
        url: uploaded.publicUrl,
        downloadUrl,
        extension: "mp4",
        contentType: "video/mp4",
        audioIncluded: audioWanted,
      });
    } catch (uploadError) {
      console.error("Studio 2 R2 export upload failed; returning MP4 directly.", uploadError);
      return new NextResponse(new Uint8Array(result), {
        headers: {
          "Content-Type": "video/mp4",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store",
        },
      });
    }
  } catch (err) {
    console.error("Studio 2 server video export error:", err);
    const message = err instanceof Error ? err.message : "Video export failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function fetchVideo(videoUrl: string) {
  const res = await fetch(videoUrl, { cache: "no-store" });
  if (!res.ok) {
    throw new Error(`Could not download source video (${res.status}).`);
  }
  const contentType = res.headers.get("content-type") || "";
  if (contentType && !contentType.startsWith("video/") && !contentType.includes("octet-stream")) {
    throw new Error("Source media is not a video.");
  }
  return Buffer.from(await res.arrayBuffer());
}

function buildFfmpegArgs({
  inputPath,
  overlayPath,
  outputPath,
  segments,
  imageTransform,
  includeAudio,
  volume,
}: {
  inputPath: string;
  overlayPath: string;
  outputPath: string;
  segments: NormalizedExportSegment[];
  imageTransform: ImageTransformPayload;
  includeAudio: boolean;
  volume: number;
}) {
  const activeSegments = segments.length ? segments : [{ start: 0, end: null, enabled: true }];
  const filters: string[] = [];

  activeSegments.forEach((segment, index) => {
    const start = formatSeconds(segment.start);
    const end = Number.isFinite(segment.end as number) && (segment.end as number) > segment.start
      ? `:end=${formatSeconds(segment.end as number)}`
      : "";
    filters.push(`[0:v]trim=start=${start}${end},setpts=PTS-STARTPTS[v${index}]`);
    if (includeAudio) {
      filters.push(`[0:a]atrim=start=${start}${end},asetpts=PTS-STARTPTS,volume=${formatNumber(volume)}[a${index}]`);
    }
  });

  if (includeAudio) {
    const concatInputs = activeSegments.map((_, index) => `[v${index}][a${index}]`).join("");
    filters.push(`${concatInputs}concat=n=${activeSegments.length}:v=1:a=1[vcat][acat]`);
  } else {
    const concatInputs = activeSegments.map((_, index) => `[v${index}]`).join("");
    filters.push(`${concatInputs}concat=n=${activeSegments.length}:v=1:a=0[vcat]`);
  }

  filters.push(`[vcat]${buildVideoTransformFilter(imageTransform)}[base]`);
  filters.push("[base][1:v]overlay=0:0:format=auto[outv]");

  const args = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    inputPath,
    "-i",
    overlayPath,
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[outv]",
  ];

  if (includeAudio) {
    args.push("-map", "[acat]", "-c:a", "aac", "-b:a", "160k");
  } else {
    args.push("-an");
  }

  args.push(
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    outputPath
  );

  return args;
}

function buildVideoTransformFilter(transform: ImageTransformPayload) {
  const scale = clampNumber(Number(transform.scale ?? 1), 0.4, 4);
  const rotateDeg = clampNumber(Number(transform.rotate ?? 0), -180, 180);
  const offsetX = clampNumber(Number(transform.offsetX ?? 0), -CANVAS_W * 2, CANVAS_W * 2);
  const offsetY = clampNumber(Number(transform.offsetY ?? 0), -CANVAS_H * 2, CANVAS_H * 2);
  const rotateRadians = (rotateDeg * Math.PI) / 180;
  const cropX = `max(0\\,min(iw-${CANVAS_W}\\,(iw-${CANVAS_W})/2+${formatNumber(-offsetX)}))`;
  const cropY = `max(0\\,min(ih-${CANVAS_H}\\,(ih-${CANVAS_H})/2+${formatNumber(-offsetY)}))`;

  return [
    `scale=${CANVAS_W}:${CANVAS_H}:force_original_aspect_ratio=increase`,
    `scale=iw*${formatNumber(scale)}:ih*${formatNumber(scale)}`,
    Math.abs(rotateDeg) > 0.001
      ? `rotate=${formatNumber(rotateRadians)}:ow=rotw(iw):oh=roth(ih):c=black`
      : null,
    `pad=max(iw\\,${CANVAS_W}):max(ih\\,${CANVAS_H}):(ow-iw)/2:(oh-ih)/2:black`,
    `crop=${CANVAS_W}:${CANVAS_H}:${cropX}:${cropY}`,
    "setsar=1",
  ].filter(Boolean).join(",");
}

function runFfmpeg(binaryPath: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(binaryPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Video export took too long and was stopped."));
    }, 240_000);

    child.stderr.on("data", (chunk) => {
      stderr = `${stderr}${chunk.toString()}`.slice(-4000);
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `FFmpeg failed with exit code ${code}.`));
    });
  });
}

function parseDataUrlPng(dataUrl: string) {
  const match = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!match) {
    throw new Error("Missing Studio text overlay.");
  }
  return Buffer.from(match[1], "base64");
}

function normalizeSegments(segments: ExportSegment[]) {
  return segments
    .filter((segment) => segment.enabled !== false)
    .map((segment) => {
      const start = Math.max(0, Number(segment.start || 0));
      const end = Number.isFinite(segment.end as number) ? Math.max(start, Number(segment.end)) : null;
      return { start, end, enabled: true };
    })
    .filter((segment) => segment.end === null || segment.end > segment.start);
}

function isHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function ensureMp4Filename(value: string) {
  const safe = value
    .replace(/[^\w.\- ]+/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 96) || "studio-2-video";
  return safe.toLowerCase().endsWith(".mp4") ? safe : `${safe}.mp4`;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

function formatSeconds(value: number) {
  return formatNumber(Math.max(0, value));
}

function formatNumber(value: number) {
  return Number(value.toFixed(4)).toString();
}
