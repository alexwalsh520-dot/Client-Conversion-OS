import crypto from "crypto";

const R2_REGION = "auto";
const R2_SERVICE = "s3";

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicBaseUrl: string;
}

interface PresignedPutInput {
  key: string;
  contentType: string;
  expiresSeconds?: number;
}

interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
}

export function getR2Config(): R2Config {
  const accountId = process.env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
  const bucketName = process.env.R2_BUCKET_NAME?.trim();
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();

  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName || !publicBaseUrl) {
    throw new Error("R2 env vars not configured");
  }

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicBaseUrl: publicBaseUrl.replace(/\/+$/, ""),
  };
}

export function inferMediaKind(contentType: string): "image" | "video" {
  return contentType.startsWith("video/") ? "video" : "image";
}

export function createR2ObjectKey(filename: string, contentType: string) {
  const kind = inferMediaKind(contentType);
  const ext = getSafeExtension(filename, contentType);
  const date = new Date().toISOString().slice(0, 10);
  const random = crypto.randomBytes(10).toString("hex");
  return `studio-2/${kind}s/${date}/${Date.now()}-${random}.${ext}`;
}

// Video testimonials are stored in the SAME R2 bucket as Studio 2, but under a
// dedicated `testimonials/` prefix so they never share a path with Studio 2
// media (studio-2/...). Keys are high-entropy + unguessable: the bucket is
// public-read, so obscurity of the key is what keeps a video from being
// enumerated. The object is only ever surfaced through the admin-authed proxy.
export function createTestimonialR2Key(clientId: number | string, filename: string, contentType: string) {
  const ext = getSafeExtension(filename, contentType);
  const date = new Date().toISOString().slice(0, 10);
  const random = crypto.randomBytes(24).toString("hex");
  const safeClient = String(clientId).replace(/[^a-z0-9]/gi, "") || "unknown";
  return `testimonials/${safeClient}/${date}/${Date.now()}-${random}.${ext}`;
}

// Ads Leaderboard contest videos. Same R2 bucket as Studio 2 + testimonials,
// but under a dedicated `ad-contest/` prefix so they never share a path with
// studio-2/ or testimonials/. High-entropy keys keep the public-read bucket
// unenumerable; the URL is surfaced only on the leaderboard for submitted ads.
export function createAdContestR2Key(entryId: string, filename: string, contentType: string) {
  const ext = getSafeExtension(filename, contentType);
  const date = new Date().toISOString().slice(0, 10);
  const random = crypto.randomBytes(24).toString("hex");
  const safeEntry = String(entryId).replace(/[^a-z0-9]/gi, "") || "unknown";
  return `ad-contest/${safeEntry}/${date}/${Date.now()}-${random}.${ext}`;
}

export function getR2PublicUrl(key: string) {
  const config = getR2Config();
  return `${config.publicBaseUrl}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

export function createPresignedPutUrl({ key, contentType, expiresSeconds = 900 }: PresignedPutInput) {
  const config = getR2Config();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const canonicalUri = `/${config.bucketName}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const signedHeaders = "host";
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = canonicalizeQuery(query);
  const normalizedContentType = contentType || "application/octet-stream";
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(config.secretAccessKey, dateStamp);
  const signature = hmacHex(signingKey, stringToSign);
  const uploadUrl = `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;

  return {
    uploadUrl,
    publicUrl: getR2PublicUrl(key),
    headers: {
      "Content-Type": normalizedContentType,
    },
  };
}

// Short-lived presigned GET URL. Lets us serve objects without relying on the
// bucket's public base URL — used for testimonial playback/download so we can
// move testimonials to a private bucket later without changing callers.
export function createPresignedGetUrl({ key, expiresSeconds = 900 }: { key: string; expiresSeconds?: number }) {
  const config = getR2Config();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const canonicalUri = `/${config.bucketName}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const signedHeaders = "host";
  const query: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Content-Sha256": "UNSIGNED-PAYLOAD",
    "X-Amz-Credential": `${config.accessKeyId}/${credentialScope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSeconds),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = canonicalizeQuery(query);
  const canonicalHeaders = `host:${host}\n`;
  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(config.secretAccessKey, dateStamp);
  const signature = hmacHex(signingKey, stringToSign);
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export async function deleteR2Object(key: string) {
  const config = getR2Config();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${config.bucketName}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payloadHash = sha256Hex("");
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const canonicalRequest = [
    "DELETE",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(config.secretAccessKey, dateStamp);
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "DELETE",
    headers: {
      Authorization: authorization,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
  });

  if (!res.ok && res.status !== 404) {
    throw new Error(`R2 delete failed: ${res.status}`);
  }
}

export async function putR2Object({ key, body, contentType }: PutObjectInput) {
  const config = getR2Config();
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${config.bucketName}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const payload = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const payloadHash = sha256BufferHex(payload);
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalHeaders = [
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
    "",
  ].join("\n");
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(config.secretAccessKey, dateStamp);
  const signature = hmacHex(signingKey, stringToSign);
  const authorization = [
    `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}`,
    `SignedHeaders=${signedHeaders}`,
    `Signature=${signature}`,
  ].join(", ");

  const res = await fetch(`https://${host}${canonicalUri}`, {
    method: "PUT",
    headers: {
      Authorization: authorization,
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    },
    body: new Uint8Array(payload),
  });

  if (!res.ok) {
    throw new Error(`R2 upload failed: ${res.status}`);
  }

  return {
    publicUrl: getR2PublicUrl(key),
  };
}

function getSafeExtension(filename: string, contentType: string) {
  const fromName = filename.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (fromName && fromName.length <= 8) return fromName;
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  if (contentType === "image/gif") return "gif";
  if (contentType === "video/quicktime") return "mov";
  if (contentType.startsWith("video/")) return "mp4";
  return "jpg";
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function canonicalizeQuery(query: Record<string, string>) {
  return Object.entries(query)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

function sha256BufferHex(value: Buffer) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key: crypto.BinaryLike, value: string) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest();
}

function hmacHex(key: crypto.BinaryLike, value: string) {
  return crypto.createHmac("sha256", key).update(value, "utf8").digest("hex");
}

function getSigningKey(secretAccessKey: string, dateStamp: string) {
  const kDate = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, R2_REGION);
  const kService = hmac(kRegion, R2_SERVICE);
  return hmac(kService, "aws4_request");
}
