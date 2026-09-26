// Visa-support travel itinerary for a paid tour booking.
//
// A consulate reads this next to a passport, so it only issues for a real,
// upcoming trip with fixed dates and a daily plan (assessVisaItineraryReadiness),
// names every traveller from the TourTraveler records, and shows the operator's
// licensing and address so the operator can be checked. House document style:
// Laid out as an NRMS-style PDF by tourVisaItineraryPdf.ts.

type AnyRecord = Record<string, any>;

export type VisaItineraryDay = {
  day: number;
  title: string;
  description: string;
  /** Where the traveller sleeps that night, when the itinerary says. */
  overnight: string;
  timeline: Array<{ time: string; label: string; description: string }>;
};

export type VisaTraveller = {
  fullName: string;
  nationality?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
};

export type VisaOperator = {
  name?: string | null;
  registrationNumber?: string | null;
  tourismLicence?: string | null;
  tin?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
};

export type TourVisaItineraryInput = {
  bookingCode: string;
  title: string;
  destination?: string | null;
  startDate?: Date | string | null;
  endDate?: Date | string | null;
  travelerCount: number;
  guestName?: string | null;
  nationality?: string | null;
  paymentStatus?: string | null;
  bookingStatus?: string | null;
  currency?: string | null;
  amountPaid?: number | null;
  packageSnapshot?: unknown;
  operatorSnapshot?: unknown;
  metadata?: unknown;
  /** TourTraveler rows; the legacy metadata.groupMembers list is a fallback. */
  travellers?: VisaTraveller[];
  /** The operator's current legal details (profile), over the booking snapshot. */
  operator?: VisaOperator;
  /** Open traveller cases (change, issue, cancellation, refund). */
  openCaseCount?: number;
  issuedAt?: Date | string;
  verificationUrl?: string | null;
  verificationQrDataUrl?: string | null;
};

const EAT = "Africa/Dar_es_Salaam";

function object(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}


function list(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(/[\n,;]/).map((part) => part.trim()).filter(Boolean);
}

function date(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** Calendar day in EAT as YYYY-MM-DD, so date comparisons ignore the time of day. */
function eatDay(value: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: EAT, year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
}

function displayDate(value: Date | string | null | undefined): string {
  const parsed = date(value);
  if (!parsed) return "To be confirmed";
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: EAT }).format(parsed);
}

function durationDays(startValue: Date | string | null | undefined, endValue: Date | string | null | undefined): number | null {
  const start = date(startValue);
  const end = date(endValue);
  if (!start || !end) return null;
  const startDay = Date.parse(`${eatDay(start)}T00:00:00Z`);
  const endDay = Date.parse(`${eatDay(end)}T00:00:00Z`);
  if (endDay < startDay) return null;
  return Math.round((endDay - startDay) / 86_400_000) + 1;
}

/** Passport or ID number with only the last four characters shown; a fixed mask so the length is not revealed. */
export function maskDocumentNumber(value: unknown): string {
  const raw = text(value).replace(/\s+/g, "");
  if (!raw) return "";
  if (raw.length <= 4) return raw;
  return `••••${raw.slice(-4)}`;
}

export function normalizeVisaItineraryDays(packageSnapshot: unknown, metadata: unknown): VisaItineraryDay[] {
  const pkg = object(packageSnapshot);
  const md = object(metadata);
  const candidates = [md.agreedPlan?.itinerary, md.confirmedPlan?.itinerary, pkg.itinerary, md.itinerary, pkg.timelineDays, md.timelineDays];
  const source = candidates.find((value) => Array.isArray(value) && value.length > 0) as unknown[] | undefined;
  if (!source) return [];

  return source
    .map((raw, index) => {
      const row = object(raw);
      const timelineSource = Array.isArray(row.timeline)
        ? row.timeline
        : Array.isArray(row.events)
          ? row.events
          : Array.isArray(row.slots)
            ? row.slots
            : [];
      const timeline = timelineSource
        .map((rawEvent: unknown) => {
          if (typeof rawEvent === "string") return { time: "", label: text(rawEvent), description: "" };
          const event = object(rawEvent);
          return {
            time: text(event.time || event.startTime),
            label: text(event.label || event.activity || event.title || event.name),
            description: text(event.description || event.detail),
          };
        })
        .filter((event: { time: string; label: string; description: string }) => event.time || event.label || event.description);

      return {
        day: Math.max(1, Number(row.day) || index + 1),
        title: text(row.title || row.name) || `Day ${index + 1}`,
        description: text(row.description || row.summary),
        overnight: text(row.overnight || row.accommodation || row.lodging || row.stay || row.hotel),
        timeline,
      };
    })
    .filter((row) => row.title || row.description || row.timeline.length > 0)
    .sort((a, b) => a.day - b.day);
}

/**
 * The trip's last day. Checkout leaves endDate optional, so many bookings only
 * carry a start date; the operator's day-by-day plan (or the package duration)
 * still fixes the length, so the end is start + days - 1.
 */
export function resolveTripEndDate(
  input: Pick<TourVisaItineraryInput, "startDate" | "endDate" | "packageSnapshot" | "metadata">
): { date: Date | null; derived: boolean } {
  const stored = date(input.endDate);
  if (stored) return { date: stored, derived: false };
  const start = date(input.startDate);
  if (!start) return { date: null, derived: false };
  const days = normalizeVisaItineraryDays(input.packageSnapshot, input.metadata);
  const planDays = days.length ? Math.max(...days.map((d) => d.day)) : 0;
  const pkg = object(input.packageSnapshot);
  const durationMatch = String(pkg.durationDays ?? pkg.duration ?? pkg.days ?? "").match(/(\d{1,3})/);
  const packageDays = durationMatch ? Number(durationMatch[1]) : 0;
  const total = planDays || packageDays;
  if (!total || total < 1) return { date: null, derived: false };
  return { date: new Date(start.getTime() + (total - 1) * 86_400_000), derived: true };
}

export type VisaReadinessCheck = {
  key: "start" | "end" | "plan" | "upcoming";
  label: string;
  ok: boolean;
  /** The value when present, or what is missing. */
  detail: string;
};

export type VisaItineraryReadiness = {
  ready: boolean;
  /** Short reasons, written for the traveller. */
  missing: string[];
  /** Every requirement with its state, so the page can show what is already in place. */
  checks: VisaReadinessCheck[];
};

/**
 * A visa officer checks entry and exit dates against the plan, so the document
 * is only issued for an upcoming, still-live trip with both dates and at least
 * one planned day. Anything else returns what is missing instead.
 */
export function assessVisaItineraryReadiness(
  input: Pick<TourVisaItineraryInput, "startDate" | "endDate" | "bookingStatus" | "packageSnapshot" | "metadata">,
  now: Date = new Date()
): VisaItineraryReadiness {
  const status = text(input.bookingStatus).toUpperCase();
  const start = date(input.startDate);
  const tripEnd = resolveTripEndDate(input);
  const end = tripEnd.date;
  const planDays = normalizeVisaItineraryDays(input.packageSnapshot, input.metadata).length;
  const finished = ["COMPLETED", "OPERATOR_COMPLETED"].includes(status);
  const passed = Boolean(start && eatDay(start) < eatDay(now));
  const endBeforeStart = Boolean(start && end && eatDay(end) < eatDay(start));

  const checks: VisaReadinessCheck[] = [
    { key: "start", label: "Trip start date", ok: Boolean(start), detail: start ? displayDate(start) : "Not set yet" },
    {
      key: "end",
      label: "Trip end date",
      ok: Boolean(end) && !endBeforeStart,
      detail: endBeforeStart ? "Before the start date" : end ? `${displayDate(end)}${tripEnd.derived ? " (from the plan)" : ""}` : "Not set yet",
    },
    { key: "plan", label: "Day-by-day plan", ok: planDays > 0, detail: planDays > 0 ? `${planDays} ${planDays === 1 ? "day" : "days"} planned` : "Not added by your operator yet" },
    { key: "upcoming", label: "Trip still ahead", ok: !finished && !passed, detail: finished ? "Trip already completed" : passed ? "Start date has passed" : "Yes" },
  ];

  const missing: string[] = [];
  if (finished) missing.push("This trip has already taken place, so a visa-support itinerary can no longer be issued.");
  else if (passed) missing.push("This trip's start date has passed, so a visa-support itinerary can no longer be issued.");
  else {
    if (!start) missing.push("The trip start date is not set yet.");
    if (!end) missing.push("The trip end date is not set yet.");
    if (endBeforeStart) missing.push("The trip end date is before its start date.");
    if (planDays === 0) missing.push("Your operator has not added the day-by-day schedule yet.");
  }
  return { ready: missing.length === 0, missing, checks };
}

function flightSummary(metadata: unknown): string[] {
  const md = object(metadata);
  const flight = object(md.flight);
  const departure = object(flight.departureAirport || md.departureAirport || md.selectedAirport);
  const arrival = object(flight.arrivalAirport || md.arrivalAirport || md.pickupAirport);
  const airportText = (value: unknown, nested: AnyRecord) => text(
    typeof value === "string" ? value : nested.shortLabel || nested.label || nested.iataCode || nested.airportName || nested.city,
  );
  const values = [
    text(flight.airline) && `Airline: ${text(flight.airline)}`,
    text(flight.flightNumber) && `Flight: ${text(flight.flightNumber)}`,
    airportText(flight.departureAirport || md.departureAirport || md.selectedAirport, departure) && `Pickup airport: ${airportText(flight.departureAirport || md.departureAirport || md.selectedAirport, departure)}`,
    airportText(flight.arrivalAirport || md.arrivalAirport || md.pickupAirport, arrival) && `Arrival: ${airportText(flight.arrivalAirport || md.arrivalAirport || md.pickupAirport, arrival)}`,
  ];
  return values.filter((value): value is string => Boolean(value));
}

type PartyRow = { name: string; nationality: string; document: string; role: string };

function travelParty(input: TourVisaItineraryInput): PartyRow[] {
  const rows: PartyRow[] = [];
  const lead = text(input.guestName).toLowerCase();
  if (Array.isArray(input.travellers) && input.travellers.length) {
    for (const t of input.travellers) {
      const docType = text(t.documentType).toLowerCase() === "passport" || !text(t.documentType) ? "Passport" : text(t.documentType);
      const masked = maskDocumentNumber(t.documentNumber);
      rows.push({
        name: text(t.fullName),
        nationality: text(t.nationality),
        document: masked ? `${docType} ${masked}` : "",
        role: text(t.fullName).toLowerCase() === lead ? "Lead traveller" : "Traveller",
      });
    }
  } else {
    rows.push({ name: text(input.guestName), nationality: text(input.nationality), document: "", role: "Lead traveller" });
    const md = object(input.metadata);
    if (Array.isArray(md.groupMembers)) {
      for (const raw of md.groupMembers) {
        const member = object(raw);
        rows.push({ name: text(member.fullName || member.name), nationality: text(member.nationality), document: "", role: text(member.relation) || "Traveller" });
      }
    }
  }
  if (lead && !rows.some((row) => row.name.toLowerCase() === lead)) {
    rows.unshift({ name: text(input.guestName), nationality: text(input.nationality), document: "", role: "Lead traveller" });
  }
  const seen = new Set<string>();
  return rows
    .filter((row) => {
      const key = row.name.toLowerCase();
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => (a.role === "Lead traveller" ? -1 : b.role === "Lead traveller" ? 1 : 0));
}


export type VisaItineraryModel = {
  documentTitle: string;
  documentNumber: string;
  bookingCode: string;
  title: string;
  destination: string;
  issuedLabel: string;
  status: { label: string; tone: "confirmed" | "review" | "pending" };
  arrival: string;
  departure: string;
  departureDerived: boolean;
  duration: string;
  travellerCount: number;
  leadTraveller: string;
  leadNationality: string;
  payment: string;
  travellers: Array<{ name: string; nationality: string; document: string; lead: boolean }>;
  days: Array<{ day: number; date: string; title: string; description: string; overnight: string; timeline: Array<{ time: string; text: string }> }>;
  arrangements: string[];
  operatorName: string;
  operatorFacts: Array<[string, string]>;
};

/** Everything the itinerary shows, resolved once so the PDF only lays it out. */
export function buildVisaItineraryModel(input: TourVisaItineraryInput): VisaItineraryModel {
  const pkg = object(input.packageSnapshot);
  const snapshot = object(input.operatorSnapshot);
  const op = input.operator || {};
  const days = normalizeVisaItineraryDays(input.packageSnapshot, input.metadata);
  const issuedAt = date(input.issuedAt || new Date()) || new Date();
  const tripEnd = resolveTripEndDate(input);
  const duration = durationDays(input.startDate, tripEnd.date);
  const accommodation = text(pkg.accommodation || pkg.lodging || pkg.hotel);
  const meetingPoint = text(pkg.meetingPoint || pkg.departurePoint);
  const inclusions = list(pkg.inclusions || pkg.included || pkg.includes);
  const travellers = travelParty(input);
  const paid = ["PAID", "APPROVED", "SETTLED", "DISBURSED"].includes(text(input.paymentStatus).toUpperCase());
  const underReview = (input.openCaseCount || 0) > 0;
  const amount = Number(input.amountPaid || 0);

  const operatorName = text(op.name || snapshot.companyName || snapshot.name) || "NoLSAF tour operator";
  const operatorFacts: Array<[string, string]> = ([
    ["Registered name", operatorName],
    ["Tourism licence", text(op.tourismLicence)],
    ["Business registration", text(op.registrationNumber)],
    ["TIN", text(op.tin)],
    ["Registered address", text(op.address)],
    ["Email", text(op.email || snapshot.contactEmail)],
    ["Telephone", text(op.phone || snapshot.contactPhone)],
    ["Website", text(op.website)],
  ] as Array<[string, string]>).filter(([, value]) => value);

  // Tanzanians on a domestic trip need no visa: same document, honest title.
  const allTanzanian = travellers.length > 0 && travellers.every((t) => /tanzan/i.test(t.nationality || text(input.nationality)));
  const startDay = date(input.startDate);

  return {
    documentTitle: allTanzanian ? "Travel itinerary" : "Visa-support travel itinerary",
    documentNumber: `NLSAF-VI-${text(input.bookingCode).replace(/^TOUR-/i, "")}`,
    bookingCode: text(input.bookingCode),
    title: text(input.title) || "Tour itinerary",
    destination: text(input.destination) || "Tanzania",
    issuedLabel: `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: EAT }).format(issuedAt)} EAT`,
    status: underReview
      ? { label: "Provisional: under review", tone: "review" }
      : paid
        ? { label: "Confirmed and paid", tone: "confirmed" }
        : { label: text(input.paymentStatus || input.bookingStatus).replace(/_/g, " ") || "Pending confirmation", tone: "pending" },
    arrival: displayDate(input.startDate),
    departure: displayDate(tripEnd.date),
    departureDerived: tripEnd.derived,
    duration: duration ? `${duration} day${duration === 1 ? "" : "s"}` : "To be confirmed",
    travellerCount: Math.max(1, Number(input.travelerCount || 1)),
    leadTraveller: text(input.guestName) || "Not recorded",
    leadNationality: text(input.nationality),
    payment: amount > 0 ? `${text(input.currency || "TZS")} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}${paid ? " paid in full" : ""}` : "Not recorded",
    travellers: travellers.map((t) => ({ name: t.name, nationality: t.nationality, document: t.document, lead: t.role === "Lead traveller" })),
    days: days.map((day) => ({
      day: day.day,
      date: startDay ? displayDate(new Date(startDay.getTime() + (day.day - 1) * 86_400_000)) : "",
      title: day.title,
      description: day.description,
      overnight: day.overnight,
      timeline: day.timeline.map((event) => ({ time: event.time, text: [event.label, event.description].filter(Boolean).join(": ") || "Scheduled activity" })),
    })),
    arrangements: [
      accommodation && `Accommodation: ${accommodation}`,
      meetingPoint && `Meeting point: ${meetingPoint}`,
      ...flightSummary(input.metadata),
      ...inclusions.slice(0, 12).map((item) => `Included: ${item}`),
    ].filter((value): value is string => Boolean(value)),
    operatorName,
    operatorFacts,
  };
}
