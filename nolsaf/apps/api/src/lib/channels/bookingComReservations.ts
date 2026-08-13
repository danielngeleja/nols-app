import { XMLParser } from "fast-xml-parser";

export type BookingReservationAction = "CREATE" | "MODIFY" | "CANCEL";

export type BookingReservationRoomStay = {
  roomTypeExternalId: string;
  rateExternalId: string | null;
  quantity: number;
  checkIn: string;
  checkOut: string;
};

export type BookingReservationMessage = {
  providerReservationId: string;
  hotelId: number | null;
  action: BookingReservationAction;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  guestName: string;
  guestPhone: string | null;
  guestEmail: string | null;
  currency: string;
  totalAmount: number;
  roomStays: BookingReservationRoomStay[];
  roomTypeExternalIds: string[];
  rateExternalIds: string[];
  raw: Record<string, unknown>;
};

/**
 * Persist only fields required for replay and reconciliation. The provider's
 * raw reservation may contain payment-card data and must not enter the generic
 * channel inbox JSON.
 */
export function bookingComEventPayload(message: BookingReservationMessage): Record<string, unknown> {
  return {
    providerReservationId: message.providerReservationId,
    hotelId: message.hotelId,
    action: message.action,
    checkIn: message.checkIn,
    checkOut: message.checkOut,
    adults: message.adults,
    children: message.children,
    currency: message.currency,
    totalAmount: message.totalAmount,
    roomStays: message.roomStays,
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  parseTagValue: false,
  trimValues: true,
  removeNSPrefix: true,
});

function arrayOf<T>(value: T | T[] | null | undefined): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" ? value as Record<string, any> : {};
}

function text(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value).trim();
  if (value && typeof value === "object" && "#text" in value) return text((value as Record<string, unknown>)["#text"]);
  return "";
}

function attr(node: unknown, name: string): string {
  const value = record(node)[`@_${name}`];
  return text(value);
}

function firstText(...values: unknown[]): string {
  for (const value of values) {
    const parsed = text(value);
    if (parsed) return parsed;
  }
  return "";
}

function numberValue(value: unknown, fallback = 0): number {
  const parsed = Number(text(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateValue(value: unknown): string {
  const raw = text(value);
  if (!raw) return "";
  const iso = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return iso ?? raw;
}

function extractReservationId(reservation: Record<string, any>): string {
  const uniqueIds = arrayOf(record(reservation).UniqueID);
  const fromUniqueId = uniqueIds.find((id) => attr(id, "ID"));
  const hotelReservationIds = record(record(reservation).ResGlobalInfo).HotelReservationIDs;
  const ids = arrayOf(record(hotelReservationIds).HotelReservationID);
  return firstText(attr(fromUniqueId, "ID"), attr(ids[0], "ResID_Value"), text(reservation.ReservationID));
}

function extractRoomStays(reservation: Record<string, any>): BookingReservationRoomStay[] {
  const result: BookingReservationRoomStay[] = [];
  const roomStays = arrayOf(record(reservation).RoomStays ? record(reservation).RoomStays.RoomStay : undefined);
  for (const roomStay of roomStays) {
    const stay = record(roomStay);
    const timeSpan = record(stay.TimeSpan);
    const checkIn = dateValue(firstText(attr(timeSpan, "Start"), text(timeSpan.Start)));
    const checkOut = dateValue(firstText(attr(timeSpan, "End"), text(timeSpan.End)));
    const roomRates = arrayOf(record(stay.RoomRates).RoomRate).map((value) => record(value));
    const roomTypes = arrayOf(record(stay.RoomTypes).RoomType).map((value) => record(value));
    const candidates = roomTypes.length ? roomTypes : roomRates;
    for (const roomType of candidates) {
      const roomTypeExternalId = firstText(attr(roomType, "RoomTypeCode"), attr(roomType, "RoomID"), attr(roomType, "ID"));
      if (!roomTypeExternalId) continue;
      const matchingRate = roomRates.find((roomRate) => {
        const rateRoomId = firstText(attr(roomRate, "RoomTypeCode"), attr(roomRate, "RoomID"));
        return !rateRoomId || rateRoomId === roomTypeExternalId;
      });
      const rateExternalId = matchingRate
        ? firstText(attr(matchingRate, "RatePlanCode"), attr(matchingRate, "RatePlanID")) || null
        : null;
      const quantity = Math.max(1, Math.trunc(numberValue(
        firstText(attr(roomType, "NumberOfUnits"), attr(roomType, "Quantity"), attr(stay, "NumberOfUnits")),
        1,
      )));
      result.push({ roomTypeExternalId, rateExternalId, quantity, checkIn, checkOut });
    }
  }
  return result;
}

function extractGuestCounts(reservation: Record<string, any>, roomStays: Record<string, any>[]): { adults: number; children: number } {
  const counts = roomStays.flatMap((stay) => arrayOf(record(stay.GuestCounts).GuestCount));
  if (!counts.length) {
    return {
      adults: Math.max(1, numberValue(reservation.Adults, 1)),
      children: Math.max(0, numberValue(reservation.Children, 0)),
    };
  }
  let adults = 0;
  let children = 0;
  for (const guestCount of counts) {
    const count = Math.max(0, numberValue(attr(guestCount, "Count"), numberValue(guestCount.Count, 0)));
    const ageCode = firstText(attr(guestCount, "AgeQualifyingCode"), text(guestCount.AgeQualifyingCode));
    if (ageCode === "8" || ageCode.toLowerCase().includes("child")) children += count;
    else adults += count;
  }
  return { adults: Math.max(1, adults), children: Math.max(0, children) };
}

function parseOneReservation(reservation: Record<string, any>, rootName: string): BookingReservationMessage {
  const roomStays = arrayOf(record(reservation.RoomStays).RoomStay);
  const firstStay = record(roomStays[0]);
  const timeSpan = record(firstStay.TimeSpan);
  const resGlobalInfo = record(reservation.ResGlobalInfo);
  const total = record(resGlobalInfo.Total ?? firstStay.Total);
  const profiles = arrayOf(record(reservation.ResGuests).ResGuest);
  const customer = record(record(record(record(profiles[0]).Profiles).ProfileInfo).Profile).Customer;
  const personName = record(customer.PersonName);
  const guestName = firstText(
    [text(personName.GivenName), text(personName.MiddleName), text(personName.Surname)].filter(Boolean).join(" "),
    text(customer.CompanyName),
    text(reservation.GuestName),
    "Booking.com guest",
  ).slice(0, 160);
  const telephone = arrayOf(customer.Telephone)[0];
  const email = arrayOf(customer.Email)[0];
  const normalizedRoomStays = extractRoomStays(reservation);
  const roomTypeExternalIds = [...new Set(normalizedRoomStays.map((stay) => stay.roomTypeExternalId))];
  const rateExternalIds = [...new Set(normalizedRoomStays.map((stay) => stay.rateExternalId).filter((id): id is string => Boolean(id)))];
  const guestCounts = extractGuestCounts(reservation, roomStays.map((stay) => record(stay)));
  const hotelInfo = record(firstStay.BasicPropertyInfo);
  const status = firstText(attr(reservation, "ResStatus"), text(reservation.Status)).toLowerCase();
  const action: BookingReservationAction = status.includes("cancel") || rootName.toLowerCase().includes("modify") && status === "cancel"
    ? "CANCEL"
    : rootName.toLowerCase().includes("modify") || status.includes("modify")
      ? "MODIFY"
      : "CREATE";
  const hotelIdRaw = firstText(attr(reservation, "HotelCode"), attr(firstStay, "HotelCode"), attr(hotelInfo, "HotelCode"), text(reservation.HotelId));
  return {
    providerReservationId: extractReservationId(reservation),
    hotelId: hotelIdRaw && /^\d+$/.test(hotelIdRaw) ? Number(hotelIdRaw) : null,
    action,
    checkIn: normalizedRoomStays.map((stay) => stay.checkIn).filter(Boolean).sort()[0]
      ?? dateValue(firstText(attr(timeSpan, "Start"), text(timeSpan.Start))),
    checkOut: normalizedRoomStays.map((stay) => stay.checkOut).filter(Boolean).sort().at(-1)
      ?? dateValue(firstText(attr(timeSpan, "End"), text(timeSpan.End))),
    adults: guestCounts.adults,
    children: guestCounts.children,
    guestName,
    guestPhone: firstText(attr(telephone, "PhoneNumber"), text(telephone.PhoneNumber), text(customer.Phone)) || null,
    guestEmail: firstText(text(email), text(customer.Email)) || null,
    currency: firstText(attr(total, "CurrencyCode"), text(total.CurrencyCode), "TZS").slice(0, 3).toUpperCase(),
    totalAmount: Math.max(0, numberValue(firstText(attr(total, "AmountAfterTax"), attr(total, "AmountBeforeTax"), text(total.AmountAfterTax)), 0)),
    roomStays: normalizedRoomStays,
    roomTypeExternalIds,
    rateExternalIds,
    raw: reservation,
  };
}

export function parseBookingReservationMessages(xml: string): BookingReservationMessage[] {
  if (!xml.trim()) return [];
  const parsed = parser.parse(xml) as Record<string, any>;
  const rootName = Object.keys(parsed)[0] ?? "";
  const root = record(parsed[rootName]);
  const reservations = arrayOf(record(root.HotelReservations).HotelReservation);
  return reservations.map((reservation) => parseOneReservation(record(reservation), rootName)).filter((message) => message.providerReservationId);
}

export function parseBookingResponseHasErrors(xml: string): boolean {
  if (!xml.trim()) return true;
  const parsed = parser.parse(xml) as Record<string, any>;
  const root = record(parsed[Object.keys(parsed)[0] ?? ""]);
  return Boolean(root.Errors || root.errors || root.fault || root.Fault);
}
