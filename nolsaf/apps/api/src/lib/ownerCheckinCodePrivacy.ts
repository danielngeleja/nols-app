import type { RequestHandler } from "express";

/** Booking codes are guest-held check-in credentials. Remove them from owner
 * JSON responses while preserving status and public booking references. */
export function redactOwnerCheckinCode<T>(body: T): T {
  if (body == null) return body;
  return JSON.parse(JSON.stringify(body, function (key, value) {
    if (key === "codeVisible" || key === "codeHash" || key === "bookingCode") return null;
    if (key === "code" && typeof value === "string" &&
        (this?.bookingId != null || this?.bookingReference != null || this?.codeVisible != null || this?.codeHash != null)) return null;
    return value;
  })) as T;
}

export const hideOwnerCheckinCode: RequestHandler = (_req, res, next) => {
  const json = res.json.bind(res);
  res.json = ((body: unknown) => json(redactOwnerCheckinCode(body))) as typeof res.json;
  next();
};
