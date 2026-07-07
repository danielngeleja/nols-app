import type { ApiError } from "./apiClient";

/** Extracts the cooldown end timestamp (ms epoch) from a rate-limit error, if present. */
export function getCooldownUntil(error: unknown): number | null {
  const payload = (error as ApiError | undefined)?.payload as
    | { retryAfterMs?: number; cooldownUntil?: number }
    | undefined;
  if (!payload) return null;
  if (typeof payload.cooldownUntil === "number") return payload.cooldownUntil;
  if (typeof payload.retryAfterMs === "number") return Date.now() + payload.retryAfterMs;
  return null;
}

/** Formats a remaining duration in ms as "Xm Ys" or "Ys". */
export function formatCooldown(remainingMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}
