import { mergeNotificationPrefs } from "./notificationPrefs.js";

export function optionalPushKind(meta: unknown, type?: string | null): "promotions" | "referrals" | null {
  const kind = meta && typeof meta === "object" && !Array.isArray(meta)
    ? String((meta as Record<string, unknown>).notificationKind || (meta as Record<string, unknown>).category || "").toLowerCase()
    : "";
  const classification = `${kind} ${String(type || "").toLowerCase()}`;
  if (/promotion|marketing/.test(classification) || String(type || "").toLowerCase() === "offer") return "promotions";
  if (/referral/.test(classification)) return "referrals";
  return null;
}

export function mayPushNotification(meta: unknown, type: string | null, preferences: unknown): boolean {
  const kind = optionalPushKind(meta, type);
  return !kind || mergeNotificationPrefs(preferences)[kind];
}
