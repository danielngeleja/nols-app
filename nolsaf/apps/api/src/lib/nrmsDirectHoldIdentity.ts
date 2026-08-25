import crypto from "node:crypto";

/** A browser retry keeps the same public hold without exposing its UUID. */
export function directHoldExternalRef(propertyId: number, clientRequestId: string): string {
  return `DIRECT-${crypto.createHash("sha256").update(`${propertyId}:${clientRequestId}`).digest("hex").slice(0, 24).toUpperCase()}`;
}
