export type AvailabilityRoomFilter = {
  roomCode?: string | null;
  roomType?: string | null;
};

export function buildAvailabilityRangePath(
  id: number,
  checkIn: string,
  checkOut: string,
  filter: AvailabilityRoomFilter = {}
): string {
  const query = new URLSearchParams({ ids: String(id), checkIn, checkOut });
  const roomCode = String(filter.roomCode || "").trim();
  const roomType = String(filter.roomType || "").trim();

  // An exact stable code must never be sent as a room type. The API keeps the
  // roomType fallback only for listings created before stable codes existed.
  if (roomCode) query.set("roomCode", roomCode);
  else if (roomType) query.set("roomType", roomType);

  return `/api/public/properties/availability?${query.toString()}`;
}

export type BookingAvailabilityStatus =
  | "dates_required"
  | "room_required"
  | "checking"
  | "unknown"
  | "sold_out"
  | "insufficient"
  | "available";

export type BookingAvailabilityDecision = {
  status: BookingAvailabilityStatus;
  canBook: boolean;
  showTotal: boolean;
};

export function resolveBookingAvailability(input: {
  hasValidDates: boolean;
  requiresRoomSelection: boolean;
  roomSelected: boolean;
  loading: boolean;
  availableRooms: number | null | undefined;
  requestedRooms: number;
}): BookingAvailabilityDecision {
  if (!input.hasValidDates) return { status: "dates_required", canBook: false, showTotal: false };
  if (input.requiresRoomSelection && !input.roomSelected) {
    return { status: "room_required", canBook: false, showTotal: false };
  }
  if (input.loading) return { status: "checking", canBook: false, showTotal: false };

  const available = input.availableRooms;
  if (available == null || !Number.isFinite(available)) {
    return { status: "unknown", canBook: false, showTotal: false };
  }
  if (available <= 0) return { status: "sold_out", canBook: false, showTotal: false };
  if (available < Math.max(1, input.requestedRooms)) {
    return { status: "insufficient", canBook: false, showTotal: false };
  }
  return { status: "available", canBook: true, showTotal: true };
}
