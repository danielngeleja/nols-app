import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";

export type PrivateSourceMapPayload = {
  version?: number;
  sources?: string[];
  sourcesContent?: Array<string | null>;
  mappings?: string;
  [key: string]: unknown;
};

const MAX_SOURCE_MAP_BYTES = 25_000_000;
const MAX_CACHE_ENTRIES = 128;
const SUCCESS_CACHE_MS = 60 * 60 * 1000;
const MISS_CACHE_MS = 60 * 1000;

type CacheEntry = {
  expiresAt: number;
  value: Promise<PrivateSourceMapPayload | null>;
};

const cache = new Map<string, CacheEntry>();
let client: S3Client | null = null;

export async function loadPrivateSourceMap(
  source: string,
  release: string | null,
): Promise<PrivateSourceMapPayload | null> {
  const bucket = cleanEnvironmentValue(process.env.SOURCE_MAP_BUCKET);
  const region = cleanEnvironmentValue(process.env.SOURCE_MAP_AWS_REGION || process.env.AWS_REGION);
  const safeRelease = safeReleaseSegment(release);
  const sourcePath = browserSourcePath(source);
  if (!bucket || !region || !safeRelease || !sourcePath) return null;

  const prefix = safePrefix(process.env.SOURCE_MAP_S3_PREFIX || "source-maps");
  const key = `${prefix}/${safeRelease}/${sourcePath}.map`;
  const cacheKey = `${bucket}:${region}:${key}`;
  const now = Date.now();
  const cached = cache.get(cacheKey);
  if (cached && cached.expiresAt > now) return cached.value;
  if (cached) cache.delete(cacheKey);

  const value = fetchSourceMap(bucket, region, key);
  cache.set(cacheKey, { expiresAt: now + MISS_CACHE_MS, value });
  trimCache();
  value.then((result) => {
    const current = cache.get(cacheKey);
    if (current?.value === value && result) current.expiresAt = Date.now() + SUCCESS_CACHE_MS;
  }).catch(() => {});
  return value;
}

async function fetchSourceMap(
  bucket: string,
  region: string,
  key: string,
): Promise<PrivateSourceMapPayload | null> {
  try {
    const response = await sourceMapClient(region).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) return null;
    if (typeof response.ContentLength === "number" && response.ContentLength > MAX_SOURCE_MAP_BYTES) return null;
    const bytes = await response.Body.transformToByteArray();
    if (bytes.byteLength > MAX_SOURCE_MAP_BYTES) return null;
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as PrivateSourceMapPayload;
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.sources) || typeof parsed.mappings !== "string") {
      return null;
    }
    return parsed;
  } catch (error: any) {
    const code = String(error?.name || error?.Code || error?.code || "");
    if (!/^(NoSuchKey|NotFound)$/i.test(code)) {
      console.warn("[source-maps] private map lookup failed", code || "unknown_error");
    }
    return null;
  }
}

function sourceMapClient(region: string) {
  if (!client) client = new S3Client({ region });
  return client;
}

function browserSourcePath(source: string): string | null {
  let pathname = source;
  try {
    pathname = new URL(source).pathname;
  } catch {
    // Stack frames may already contain only a path.
  }
  const clean = pathname.replace(/\\/g, "/").replace(/^\/+/, "").replace(/[?#].*$/, "");
  if (!clean.startsWith("_next/static/") || !/\.(?:js|mjs)$/.test(clean)) return null;
  if (clean.split("/").some((part) => part === ".." || part === ".")) return null;
  return clean;
}

function safeReleaseSegment(value: string | null): string | null {
  if (!value) return null;
  const clean = value.trim();
  return /^[A-Za-z0-9._-]{1,160}$/.test(clean) ? clean : null;
}

function safePrefix(value: string) {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  const safe = parts.filter((part) => /^[A-Za-z0-9._-]+$/.test(part) && part !== "." && part !== "..");
  return safe.length ? safe.join("/") : "source-maps";
}

function cleanEnvironmentValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const clean = value.trim();
  return clean || null;
}

function trimCache() {
  while (cache.size > MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (!oldest) break;
    cache.delete(oldest);
  }
}

export function resetPrivateSourceMapStateForTests() {
  cache.clear();
  client = null;
}
