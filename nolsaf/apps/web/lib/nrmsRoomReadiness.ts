type RoomAllocation = { status: string; roomUnitId?: number | null; roomUnitCode?: string | null };

export function roomReadiness(reservation: { allocations?: RoomAllocation[] }) {
  const active = (reservation.allocations ?? []).filter((allocation) => allocation.status === "ACTIVE");
  const assigned = active.filter((allocation) => allocation.roomUnitId != null && Boolean(allocation.roomUnitCode)).length;
  return { total: active.length, assigned, missingAllocation: active.length === 0, ready: active.length > 0 && assigned === active.length };
}

export function roomAssignmentRequirement(reservation: {
  status: string;
  bookingId?: number | null;
  marketplaceBooking?: { status?: string | null; checkInCodeStatus?: string | null } | null;
  agencySettlement?: { settled: boolean } | null;
  effectivePaid?: number;
  amountPaid?: number | null;
  transferredToMaster?: number;
  totalAmount?: number | null;
  chargesTotal?: number | null;
  balance?: number | null;
}): { ready: boolean; kind: "READY" | "STATUS" | "RECORD_PAYMENT"; message: string } {
  if (!["CONFIRMED", "CHECKED_IN"].includes(reservation.status)) return { ready: false, kind: "STATUS", message: "Confirm the reservation before assigning a room." };
  if (reservation.bookingId != null) {
    const ready = ["CONFIRMED", "PENDING_CHECKIN", "CHECKED_IN"].includes(String(reservation.marketplaceBooking?.status ?? "").toUpperCase());
    return { ready, kind: ready ? "READY" : "STATUS", message: ready ? "NoLSAF booking confirmed." : "Confirm the NoLSAF booking before assigning a room." };
  }
  if (reservation.agencySettlement) {
    const ready = reservation.agencySettlement.settled;
    return { ready, kind: ready ? "READY" : "RECORD_PAYMENT", message: ready ? "Agency payment settled." : "Settle the agency folio before assigning a room." };
  }
  const paid = reservation.effectivePaid ?? (Number(reservation.amountPaid ?? 0) + Number(reservation.transferredToMaster ?? 0));
  const total = Number(reservation.totalAmount ?? 0) + Number(reservation.chargesTotal ?? 0);
  const ready = Number(reservation.balance ?? total - paid) <= 0.005 && (total <= 0.005 || paid > 0);
  return { ready, kind: ready ? "READY" : "RECORD_PAYMENT", message: ready ? "Payment recorded." : "Settle and record the guest payment before assigning a room." };
}
