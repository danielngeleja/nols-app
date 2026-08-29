import crypto from "node:crypto";

/**
 * Stable, non-reversible key used to enforce one active Meta conversation per
 * property, channel and external sender. The raw provider identifier remains
 * in externalConversationId for delivery; this key exists only for locking.
 */
export function nrmsMetaConversationKey(propertyId: number, channel: string, externalConversationId: string): string {
  return crypto
    .createHash("sha256")
    .update(`${propertyId}:${channel.trim().toUpperCase()}:${externalConversationId.trim()}`)
    .digest("hex");
}

export function closesActiveConversation(status: string | null | undefined): boolean {
  return status === "CONVERTED" || status === "CLOSED" || status === "RESOLVED";
}
