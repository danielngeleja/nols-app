/** A booking reference or receipt QR is not proof of the guest-held code. */
export function presentedCheckinCode(raw: unknown, bookingId?: number): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (value.startsWith("{")) {
    try {
      const parsed = JSON.parse(value);
      if (bookingId != null && parsed?.bookingId != null && Number(parsed.bookingId) !== bookingId) return null;
      value = String(parsed?.checkinCode || parsed?.bookingCode || parsed?.code || "").trim();
    } catch { return null; }
  }
  const code = value.toUpperCase();
  return /^[A-Z2-9]{8}$/.test(code) ? code : null;
}
