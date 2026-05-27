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

export async function runHiggsfieldJson<T = unknown>(args: string[], timeoutMs = 120_000): Promise<HiggsfieldRunResult<T>> {
  const command = getHiggsfieldCommand();
  const credentialContext = await createCredentialContext();

  try {
    const { stdout, stderr } = await execFileAsync(command, [...args, "--json", "--no-color"], {
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
  } finally {
    await credentialContext.cleanup();
  }
}

export function getHiggsfieldJobId(value: unknown) {
  if (!value) return "";
  if (Array.isArray(value)) return getHiggsfieldJobId(value[0]);
  if (typeof value === "object" && "id" in value) {
    const id = (value as { id?: unknown }).id;
    return typeof id === "string" ? id : "";
  }
  return "";
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
  if (process.env.HIGGSFIELD_CLI_PATH?.trim()) return process.env.HIGGSFIELD_CLI_PATH.trim();
  return path.join(process.cwd(), "node_modules", ".bin", "higgsfield");
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
