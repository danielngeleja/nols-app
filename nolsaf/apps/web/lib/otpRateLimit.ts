type OtpErrorPayload = {
  error?: unknown
  message?: unknown
  retryAfterMs?: unknown
  retryAfterSeconds?: unknown
  cooldownUntil?: unknown
}

function positiveNumber(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0
}

export function getOtpRetryAfterSeconds(
  payload: OtpErrorPayload | null | undefined,
  retryAfterHeader?: string | null,
): number {
  const directSeconds = positiveNumber(payload?.retryAfterSeconds)
  if (directSeconds > 0) return Math.max(1, Math.ceil(directSeconds))

  const milliseconds = positiveNumber(payload?.retryAfterMs)
  if (milliseconds > 0) return Math.max(1, Math.ceil(milliseconds / 1000))

  const cooldownUntil = positiveNumber(payload?.cooldownUntil)
  if (cooldownUntil > Date.now()) {
    return Math.max(1, Math.ceil((cooldownUntil - Date.now()) / 1000))
  }

  if (retryAfterHeader) {
    const seconds = positiveNumber(retryAfterHeader)
    if (seconds > 0) return Math.max(1, Math.ceil(seconds))

    const retryAt = Date.parse(retryAfterHeader)
    if (Number.isFinite(retryAt) && retryAt > Date.now()) {
      return Math.max(1, Math.ceil((retryAt - Date.now()) / 1000))
    }
  }

  return 0
}

export function formatOtpCountdown(totalSeconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(totalSeconds))
  const minutes = Math.floor(safeSeconds / 60)
  const seconds = safeSeconds % 60
  return minutes > 0 ? `${minutes}:${String(seconds).padStart(2, "0")}` : `${seconds}s`
}

export function getOtpSendErrorMessage(
  payload: OtpErrorPayload | null | undefined,
  status: number,
  retryAfterSeconds: number,
): string {
  if (status === 429) {
    const wait = retryAfterSeconds > 0 ? ` Try again in ${formatOtpCountdown(retryAfterSeconds)}.` : " Please wait before trying again."
    return `Too many OTP requests.${wait}`
  }

  const message = typeof payload?.message === "string" ? payload.message.trim() : ""
  if (message) return message

  const error = typeof payload?.error === "string" ? payload.error.trim() : ""
  return error || "Failed to send OTP. Please try again."
}
