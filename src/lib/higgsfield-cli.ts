import { execFile } from "child_process";
import crypto from "crypto";
import fs from "fs/promises";
import os from "os";
import path from "path";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface HiggsfieldJob {
  id?: string;
  status?: string;
  result_url?: string;
  resultUrl?: string;
  display_name?: string;
  job_set_type?: string;
  [key: string]: unknown;
}

interface HiggsfieldRunResult<T = unknown> {
  stdout: string;
  stderr: string;
  json: T;
}

interface TempImage {
  path: string;
  contentType: string;
}

const JOB_ID_KEYS = ["id", "job_id", "jobId", "uuid", "generation_id", "generationId", "jobID"];
const JOB_CONTAINER_KEYS = ["data", "job", "jobs", "generation", "generations", "result", "results", "item", "items"];

export async function runHiggsfieldJson<T = unknown>(args: string[], timeoutMs = 120_000): Promise<HiggsfieldRunResult<T>> {
  const command = getHiggsfieldCommand();
  const credentialContext = await createCredentialContext();

  try {
    const { stdout, stderr } = await execFileAsync(command.file, [...command.args, ...args, "--json", "--no-color"], {
      env: {
        ...process.env,
        ...credentialContext.env,
        HIGGSFIELD_DISABLE_TELEMETRY: "1",
      },
      timeout: timeoutMs,
      maxBuffer: 1024 * 1024 * 12,
    });

    return {
      stdout,
      stderr,
      json: parseJsonOutput<T>(stdout),
    };
  } catch (err) {
    if (isMissingExecutableError(err)) {
      throw new Error("Higgsfield CLI is not available in this deployment yet. Redeploy the latest build and try again.");
    }
    if (isBundledModulePathError(err)) {
      throw new Error("Higgsfield CLI failed to start in this deployment. Redeploy the latest build and try again.");
    }
    if (isCommandFailureError(err)) {
      throw new Error(formatHiggsfieldCliError(err));
    }
    throw err;
  } finally {
    await credentialContext.cleanup();
  }
}

export function getHiggsfieldJobId(value: unknown) {
  return findHiggsfieldJobId(value, new Set());
}

function findHiggsfieldJobId(value: unknown, seen: Set<object>): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string" && isLikelyJobId(item)) return item.trim();
      const id = findHiggsfieldJobId(item, seen);
      if (id) return id;
    }
    return "";
  }
  if (typeof value !== "object") return "";
  if (seen.has(value)) return "";
  seen.add(value);

  const record = value as Record<string, unknown>;
  for (const key of JOB_ID_KEYS) {
    const id = record[key];
    if (typeof id === "string" && isLikelyJobId(id)) return id.trim();
  }

  for (const key of JOB_CONTAINER_KEYS) {
    const id = findHiggsfieldJobId(record[key], seen);
    if (id) return id;
  }

  for (const nested of Object.values(record)) {
    if (nested && (Array.isArray(nested) || typeof nested === "object")) {
      const id = findHiggsfieldJobId(nested, seen);
      if (id) return id;
    }
  }

  return "";
}

function isLikelyJobId(value: string) {
  const trimmed = value.trim();
  return trimmed.length >= 8 && /^[a-zA-Z0-9_-]+$/.test(trimmed);
}

export function getHiggsfieldResultUrl(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    for (const item of value) {
      const url: string = getHiggsfieldResultUrl(item);
      if (url) return url;
    }
  }
  if (typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  for (const key of ["result_url", "resultUrl", "url"]) {
    if (typeof record[key] === "string" && /^https?:\/\//.test(record[key])) return record[key] as string;
  }
  for (const nested of Object.values(record)) {
    const url: string = getHiggsfieldResultUrl(nested);
    if (url) return url;
  }
  return "";
}

export async function writeDataUrlToTempImage(dataUrl: string, label: string): Promise<TempImage> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) throw new Error("Expected an image data URL");

  const contentType = match[1];
  const base64 = match[2];
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) throw new Error("Image was empty");
  if (buffer.length > 18 * 1024 * 1024) throw new Error("Image reference is too large");

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccos-higgsfield-image-"));
  const filePath = path.join(dir, `${sanitizeFilename(label)}-${crypto.randomBytes(5).toString("hex")}.${extensionForContentType(contentType)}`);
  await fs.writeFile(filePath, buffer);
  return { path: filePath, contentType };
}

export async function cleanupTempPaths(paths: string[]) {
  await Promise.all(
    paths.map(async (filePath) => {
      try {
        await fs.rm(path.dirname(filePath), { recursive: true, force: true });
      } catch {
        // Best-effort cleanup only.
      }
    })
  );
}

function getHiggsfieldCommand() {
  if (process.env.HIGGSFIELD_CLI_PATH?.trim()) {
    return { file: process.env.HIGGSFIELD_CLI_PATH.trim(), args: [] };
  }

  return {
    file: process.execPath,
    args: [path.join(process.cwd(), "node_modules", "@higgsfield", "cli", "bin", "higgsfield.js")],
  };
}

async function createCredentialContext(): Promise<{ env: Record<string, string>; cleanup: () => Promise<void> }> {
  const accessToken = process.env.HIGGSFIELD_ACCESS_TOKEN?.trim();
  const refreshToken = process.env.HIGGSFIELD_REFRESH_TOKEN?.trim();

  if (!accessToken || !refreshToken) {
    return { env: {}, cleanup: async () => undefined };
  }

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ccos-higgsfield-auth-"));
  const credentialsPath = path.join(dir, "credentials.json");
  await fs.writeFile(
    credentialsPath,
    JSON.stringify({ access_token: accessToken, refresh_token: refreshToken }),
    { mode: 0o600 }
  );

  return {
    env: {
      HIGGSFIELD_CREDENTIALS_PATH: credentialsPath,
    },
    cleanup: async () => {
      await fs.rm(dir, { recursive: true, force: true });
    },
  };
}

function parseJsonOutput<T>(stdout: string): T {
  const trimmed = stdout.trim();
  if (!trimmed) throw new Error("Higgsfield returned no JSON output");
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const start = Math.min(
      ...["{", "["].map((char) => {
        const index = trimmed.indexOf(char);
        return index === -1 ? Number.POSITIVE_INFINITY : index;
      })
    );
    if (!Number.isFinite(start)) throw new Error("Higgsfield JSON output could not be parsed");
    return JSON.parse(trimmed.slice(start)) as T;
  }
}

function sanitizeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "image";
}

function extensionForContentType(contentType: string) {
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  return "jpg";
}

function isMissingExecutableError(err: unknown) {
  const maybeError = err as { code?: unknown; message?: unknown };
  return maybeError.code === "ENOENT" || String(maybeError.message || "").includes("ENOENT");
}

function isBundledModulePathError(err: unknown) {
  const message = String((err as { message?: unknown }).message || "");
  return message.includes("Cannot find module") && /\/var\/task\/\d+/.test(message);
}

function isCommandFailureError(err: unknown) {
  const maybeError = err as { code?: unknown; stdout?: unknown; stderr?: unknown; message?: unknown };
  return maybeError.code !== undefined || typeof maybeError.stdout === "string" || typeof maybeError.stderr === "string";
}

function formatHiggsfieldCliError(err: unknown) {
  const maybeError = err as { stdout?: unknown; stderr?: unknown; message?: unknown };
  const detail = cleanCliOutput(maybeError.stderr) || cleanCliOutput(maybeError.stdout) || cleanCliOutput(maybeError.message);
  if (!detail) return "Higgsfield CLI failed before it could start the generation.";

  const lower = detail.toLowerCase();
  if (lower.includes("unauthorized") || lower.includes("forbidden") || lower.includes("auth")) {
    return "Higgsfield needs a fresh login token before it can generate.";
  }

  return `Higgsfield CLI failed: ${detail}`;
}

function cleanCliOutput(value: unknown) {
  const text = String(value || "")
    .replace(/\u001b\[[0-9;]*m/g, "")
    .trim();
  if (!text) return "";

  const usefulLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("Command failed:"))
    .filter((line) => !line.startsWith("node:internal/"))
    .filter((line) => !line.startsWith("at "))
    .filter((line) => !line.includes("Module._"))
    .slice(0, 4);

  const cleaned = usefulLines.join(" ").trim();
  if (!cleaned) return "";
  return cleaned.length > 420 ? `${cleaned.slice(0, 420).trim()}...` : cleaned;
}
