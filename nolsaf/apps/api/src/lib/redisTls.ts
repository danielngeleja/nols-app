import fs from "node:fs";
import path from "node:path";
import type { RedisOptions } from "ioredis";

let cachedCaPath: string | null = null;
let cachedCaBundle: Buffer | null = null;

function resolveCaPath(): string {
  const configured = String(process.env.REDIS_CA_CERT_PATH || "").trim();
  const candidates = configured
    ? [path.resolve(configured)]
    : [
        path.resolve(process.cwd(), "certs", "redis_ca.pem"),
        path.resolve(__dirname, "..", "..", "certs", "redis_ca.pem"),
        path.resolve(__dirname, "..", "..", "..", "certs", "redis_ca.pem"),
      ];

  const resolved = candidates.find((candidate) => fs.existsSync(candidate));
  if (!resolved) {
    const detail = configured
      ? `Configured Redis CA bundle was not found: ${configured}`
      : "Redis CA bundle was not found at certs/redis_ca.pem";
    throw new Error(`${detail}. TLS verification cannot continue.`);
  }
  return resolved;
}

function readCaBundle(): Buffer {
  const caPath = resolveCaPath();
  if (cachedCaBundle && cachedCaPath === caPath) return cachedCaBundle;

  const bundle = fs.readFileSync(caPath);
  const certificateCount = (bundle.toString("utf8").match(/-----BEGIN CERTIFICATE-----/g) || []).length;
  if (certificateCount < 1) {
    throw new Error("Redis CA bundle contains no PEM certificates. TLS verification cannot continue.");
  }

  cachedCaPath = caPath;
  cachedCaBundle = bundle;
  return bundle;
}

/**
 * Return strict TLS options for rediss:// connections. Plain redis:// URLs are
 * left unchanged for local development only.
 */
export function getRedisTlsOptions(url: string): Pick<RedisOptions, "tls"> {
  if (!/^rediss:\/\//i.test(url)) return {};

  const parsed = new URL(url);
  return {
    tls: {
      ca: readCaBundle(),
      rejectUnauthorized: true,
      servername: parsed.hostname,
    },
  };
}

