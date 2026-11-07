/** How a visit is shown on partner and admin screens. The photo hash and IP hash never leave the server. */
import { VISIT_FLAG_TEXT, type VisitFlag } from "./salesLeadVisits.js";
import { signedVisitPhotoUrl } from "./salesVisitPhotos.js";

const num = (value: unknown) => (value == null ? null : Number(value));

export function serializeVisit(row: any) {
  const flags: VisitFlag[] = Array.isArray(row.flags) ? row.flags : [];
  return {
    id: row.id,
    status: row.status,
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    accuracyMeters: row.accuracyMeters,
    capturedAt: row.capturedAt,
    receivedAt: row.receivedAt,
    metWith: row.metWith,
    note: row.note ?? null,
    distanceMeters: row.distanceMeters ?? null,
    referenceSource: row.referenceSource,
    flags: flags.map((code) => ({ code, text: VISIT_FLAG_TEXT[code] ?? code })),
    photoUrl: signedVisitPhotoUrl(row.photoPublicId),
    reviewedAt: row.reviewedAt ?? null,
    reviewNote: row.reviewNote ?? null,
    createdBy: row.createdBy ? { name: row.createdBy.fullName || row.createdBy.name || null } : undefined,
  };
}

export const visitSelect = {
  id: true,
  status: true,
  latitude: true,
  longitude: true,
  accuracyMeters: true,
  capturedAt: true,
  receivedAt: true,
  metWith: true,
  note: true,
  distanceMeters: true,
  referenceSource: true,
  flags: true,
  photoPublicId: true,
  reviewedAt: true,
  reviewNote: true,
  createdBy: { select: { name: true, fullName: true } },
};

