import { createCipheriv, createDecipheriv, createHash, createHmac, timingSafeEqual } from "node:crypto";
import { publicLinkSecrets, publicLinkSigningSecret } from "./publicLinkSecrets.js";

/**
 * Opaque, shareable NoLScope estimate reference (es_...), used by the public
 * printable report link. Unlike the bk_/iv_ record references it has to be
 * resolvable without login, so it cannot be a one-way digest checked by
 * scanning rows: that would let anyone make a public endpoint walk the whole
 * estimates table. Instead the id and a 64-bit HMAC tag are sealed in a single
 * AES-256 block. The reference never reveals the id, cannot be enumerated or
 * forged, resolves in constant time, and needs no extra column.
 *
 * Rotation follows publicLinkSecrets: the newest secret seals, every secret opens.
 */

const PREFIX = "es_";
const REFERENCE_PATTERN = /^es_[A-Za-z0-9_-]{22}$/;

function blockKey(secret: string): Buffer {
  return createHash("sha256").update(`nolscope-estimate-reference-key:${secret}`).digest();
}

function tag(secret: string, estimateId: number): Buffer {
  return createHmac("sha256", secret).update(`nolscope-estimate:${estimateId}`).digest().subarray(0, 8);
}

function seal(estimateId: number, secret: string): string {
  const block = Buffer.alloc(16);
  block.writeBigUInt64BE(BigInt(estimateId), 0);
  tag(secret, estimateId).copy(block, 8);
  const cipher = createCipheriv("aes-256-ecb", blockKey(secret), null);
  cipher.setAutoPadding(false);
  return `${PREFIX}${Buffer.concat([cipher.update(block), cipher.final()]).toString("base64url")}`;
}

export function nolscopeEstimateReference(estimateId: number): string {
  if (!Number.isSafeInteger(estimateId) || estimateId <= 0) {
    throw new Error("invalid_nolscope_estimate_id");
  }
  return seal(estimateId, publicLinkSigningSecret("nolscope_estimate_reference_secret_missing"));
}

export function isNolscopeEstimateReference(value: string): boolean {
  return REFERENCE_PATTERN.test(String(value || "").trim());
}

/** The estimate id a reference was issued for, or null when it is malformed or forged. */
export function resolveNolscopeEstimateReference(reference: string): number | null {
  const value = String(reference || "").trim();
  if (!REFERENCE_PATTERN.test(value)) return null;
  const sealed = Buffer.from(value.slice(PREFIX.length), "base64url");
  if (sealed.length !== 16) return null;

  for (const secret of publicLinkSecrets()) {
    const decipher = createDecipheriv("aes-256-ecb", blockKey(secret), null);
    decipher.setAutoPadding(false);
    const block = Buffer.concat([decipher.update(sealed), decipher.final()]);
    const id = block.readBigUInt64BE(0);
    if (id <= 0n || id > BigInt(Number.MAX_SAFE_INTEGER)) continue;
    const estimateId = Number(id);
    if (timingSafeEqual(block.subarray(8), tag(secret, estimateId))) return estimateId;
  }
  return null;
}
