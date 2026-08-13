export const STANDARD_GROUP_MIN_ROOMS = 5;
export const APPROVED_SMALL_GROUP_MIN_ROOMS = 2;
export const SMALL_GROUP_REASON_MIN_LENGTH = 10;

export type GroupQualification =
  | { ok: true; classification: "STANDARD" | "APPROVED_SMALL"; approvalReason: string | null }
  | { ok: false; code: "SINGLE_ROOM_NOT_GROUP" | "GROUP_MINIMUM_NOT_MET" | "SMALL_GROUP_APPROVAL_REASON_REQUIRED"; error: string };

/**
 * Classification is fixed when the agreement is created. Names submitted and
 * rooms later released do not rewrite the commercial history of the group.
 */
export function qualifyGroupBlock(roomCount: number, approvalReason?: string | null): GroupQualification {
  if (roomCount < APPROVED_SMALL_GROUP_MIN_ROOMS) {
    return {
      ok: false,
      code: "SINGLE_ROOM_NOT_GROUP",
      error: "A group must include at least two rooms. Create a normal reservation for one room.",
    };
  }
  if (roomCount >= STANDARD_GROUP_MIN_ROOMS) {
    return { ok: true, classification: "STANDARD", approvalReason: null };
  }
  const reason = String(approvalReason || "").trim();
  if (!reason) {
    return {
      ok: false,
      code: "GROUP_MINIMUM_NOT_MET",
      error: `Standard groups start at ${STANDARD_GROUP_MIN_ROOMS} rooms. Approve this contracted party as a small group, or use normal reservations.`,
    };
  }
  if (reason.length < SMALL_GROUP_REASON_MIN_LENGTH) {
    return {
      ok: false,
      code: "SMALL_GROUP_APPROVAL_REASON_REQUIRED",
      error: `Explain the contracted small-group exception in at least ${SMALL_GROUP_REASON_MIN_LENGTH} characters.`,
    };
  }
  return { ok: true, classification: "APPROVED_SMALL", approvalReason: reason };
}
