export type BookingComAriPolicy = {
  minAdvanceRes?: string | null;
  maxAdvanceRes?: string | null;
  minimumStay?: number | null;
  minimumStayArrival?: number | null;
  maximumStay?: number | null;
  maximumStayArrival?: number | null;
  exactStayArrival?: number | null;
  closedOnArrival?: boolean | null;
  closedOnDeparture?: boolean | null;
};

export type BookingComAriRoomLevelUpdate = {
  roomId: string;
  date: string;
  roomsToSell: number;
};

export type BookingComAriRateLevelUpdate = {
  roomId: string;
  rateId: string;
  date: string;
  currency: string;
  price: number;
  closed?: boolean;
  policy?: BookingComAriPolicy | null;
};

function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function numberValue(value: number | null | undefined): string | null {
  return Number.isFinite(value) ? String(Math.trunc(value as number)) : null;
}

function rateDateXml(update: BookingComAriRateLevelUpdate): string {
  const policy = update.policy ?? {};
  const fields = [
    `<currencycode>${xml(update.currency.toUpperCase())}</currencycode>`,
    `<rate id="${xml(update.rateId)}" />`,
    `<price>${update.price.toFixed(2)}</price>`,
    `<closed>${update.closed ? 1 : 0}</closed>`,
    policy.minAdvanceRes ? `<min_advance_res>${xml(policy.minAdvanceRes)}</min_advance_res>` : "",
    policy.maxAdvanceRes ? `<max_advance_res>${xml(policy.maxAdvanceRes)}</max_advance_res>` : "",
    numberValue(policy.minimumStay) != null ? `<minimumstay>${numberValue(policy.minimumStay)}</minimumstay>` : "",
    numberValue(policy.minimumStayArrival) != null ? `<minimumstay_arrival>${numberValue(policy.minimumStayArrival)}</minimumstay_arrival>` : "",
    numberValue(policy.maximumStay) != null ? `<maximumstay>${numberValue(policy.maximumStay)}</maximumstay>` : "",
    numberValue(policy.maximumStayArrival) != null ? `<maximumstay_arrival>${numberValue(policy.maximumStayArrival)}</maximumstay_arrival>` : "",
    numberValue(policy.exactStayArrival) != null ? `<exactstay_arrival>${numberValue(policy.exactStayArrival)}</exactstay_arrival>` : "",
    policy.closedOnArrival == null ? "" : `<closedonarrival>${policy.closedOnArrival ? 1 : 0}</closedonarrival>`,
    policy.closedOnDeparture == null ? "" : `<closedondeparture>${policy.closedOnDeparture ? 1 : 0}</closedondeparture>`,
  ].filter(Boolean).join("");
  return `<room id="${xml(update.roomId)}"><date value="${xml(update.date)}">${fields}</date></room>`;
}

export function buildBookingComAvailabilityXml(input: {
  hotelId: string | number;
  roomLevel: BookingComAriRoomLevelUpdate[];
  rateLevel: BookingComAriRateLevelUpdate[];
}): string {
  const roomLevel = input.roomLevel.map((update) => `<room id="${xml(update.roomId)}"><date value="${xml(update.date)}"><roomstosell>${Math.max(0, Math.min(255, Math.trunc(update.roomsToSell)))}</roomstosell></date></room>`).join("");
  const rateLevel = input.rateLevel.map(rateDateXml).join("");
  if (!roomLevel && !rateLevel) throw new Error("Booking.com availability payload has no updates");
  return `<request><hotel_id>${xml(String(input.hotelId))}</hotel_id>${roomLevel}${rateLevel}</request>`;
}
