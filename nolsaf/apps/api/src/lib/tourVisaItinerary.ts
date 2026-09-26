// Visa-support travel itinerary for a paid tour booking.
//
// A consulate reads this next to a passport, so it only issues for a real,
// upcoming trip with fixed dates and a daily plan (assessVisaItineraryReadiness),
// names every traveller from the TourTraveler records, and shows the operator's
// licensing and address so the operator can be checked. House document style:
// Trebuchet MS, brand palette, logo, dotted brand rows, certified seal footer.

import { code128Svg } from "./code128.js";

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
  logoUrl?: string | null;
};

const EAT = "Africa/Dar_es_Salaam";
const DOCUMENT_FONT = `"Trebuchet MS","Lucida Grande","Lucida Sans Unicode",Tahoma,sans-serif`;

function object(value: unknown): AnyRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AnyRecord : {};
}

function text(value: unknown): string {
  return String(value ?? "").trim();
}

function html(value: unknown): string {
  return text(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

export type VisaItineraryReadiness = {
  ready: boolean;
  /** Short reasons, written for the traveller. */
  missing: string[];
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
  const missing: string[] = [];
  const status = text(input.bookingStatus).toUpperCase();
  const start = date(input.startDate);
  const end = date(input.endDate);

  if (["COMPLETED", "OPERATOR_COMPLETED"].includes(status)) {
    return { ready: false, missing: ["This trip has already taken place, so a visa-support itinerary can no longer be issued."] };
  }
  if (!start) missing.push("The trip start date is not set yet.");
  if (!end) missing.push("The trip end date is not set yet.");
  if (start && end && eatDay(end) < eatDay(start)) missing.push("The trip end date is before its start date.");
  if (start && eatDay(start) < eatDay(now)) {
    return { ready: false, missing: ["This trip's start date has passed, so a visa-support itinerary can no longer be issued."] };
  }
  if (normalizeVisaItineraryDays(input.packageSnapshot, input.metadata).length === 0) {
    missing.push("Your operator has not added the day-by-day schedule yet.");
  }
  return { ready: missing.length === 0, missing };
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

function renderRows(rows: Array<[string, string]>): string {
  return rows
    .filter(([, value]) => text(value))
    .map(([label, value]) => `<div class="fact"><span>${html(label)}</span><strong>${html(value)}</strong></div>`)
    .join("");
}

export function buildTourVisaItineraryHtml(input: TourVisaItineraryInput): string {
  const pkg = object(input.packageSnapshot);
  const snapshot = object(input.operatorSnapshot);
  const op = input.operator || {};
  const days = normalizeVisaItineraryDays(input.packageSnapshot, input.metadata);
  const issuedAt = date(input.issuedAt || new Date()) || new Date();
  const duration = durationDays(input.startDate, input.endDate);
  const accommodation = text(pkg.accommodation || pkg.lodging || pkg.hotel);
  const meetingPoint = text(pkg.meetingPoint || pkg.departurePoint);
  const inclusions = list(pkg.inclusions || pkg.included || pkg.includes);
  const flights = flightSummary(input.metadata);
  const travellers = travelParty(input);
  const paid = ["PAID", "APPROVED", "SETTLED", "DISBURSED"].includes(text(input.paymentStatus).toUpperCase());
  const underReview = (input.openCaseCount || 0) > 0;
  const statusText = underReview
    ? "Provisional: booking under review"
    : paid
      ? "Confirmed and paid"
      : text(input.paymentStatus || input.bookingStatus).replace(/_/g, " ") || "Pending confirmation";
  const amount = Number(input.amountPaid || 0);

  const operatorName = text(op.name || snapshot.companyName || snapshot.name) || "NoLSAF tour operator";
  const operatorEmail = text(op.email || snapshot.contactEmail);
  const operatorPhone = text(op.phone || snapshot.contactPhone);
  const operatorFacts: Array<[string, string]> = [
    ["Registered name", operatorName],
    ["Tourism licence", text(op.tourismLicence)],
    ["Business registration", text(op.registrationNumber)],
    ["TIN", text(op.tin)],
    ["Registered address", text(op.address)],
    ["Email", operatorEmail],
    ["Telephone", operatorPhone],
    ["Website", text(op.website)],
  ];

  // Tanzanians on a domestic trip need no visa: same document, honest title.
  const allTanzanian = travellers.length > 0 && travellers.every((t) => /tanzan/i.test(t.nationality || text(input.nationality)));
  const documentTitle = allTanzanian ? "Travel itinerary" : "Visa-support travel itinerary";
  const documentNumber = `NLSAF-VI-${text(input.bookingCode).replace(/^TOUR-/i, "")}`;
  const issuedLabel = `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: EAT }).format(issuedAt)} EAT`;
  const startDay = date(input.startDate);

  const itineraryHtml = days.length
    ? days.map((day) => {
        const onDate = startDay ? displayDate(new Date(startDay.getTime() + (day.day - 1) * 86_400_000)) : "";
        const events = day.timeline.length
          ? `<ul>${day.timeline.map((event) => {
              const eventText = [event.label, event.description].filter(Boolean).join(": ");
              return `<li>${event.time ? `<time>${html(event.time)}</time>` : "<time></time>"}<span>${html(eventText || "Scheduled activity")}</span></li>`;
            }).join("")}</ul>`
          : "";
        const overnight = day.overnight ? `<p class="overnight"><b>Overnight</b> ${html(day.overnight)}</p>` : "";
        return `<li class="day"><div class="day-number"><small>Day</small>${day.day}</div><div class="daycard"><h3>${html(day.title)}${onDate ? `<em>${html(onDate)}</em>` : ""}</h3>${day.description ? `<p>${html(day.description)}</p>` : ""}${events}${overnight}</div></li>`;
      }).join("")
    : `<p class="empty">A detailed daily schedule has not yet been added to this booking.</p>`;

  const supportItems = [
    accommodation && `Accommodation: ${accommodation}`,
    meetingPoint && `Meeting point: ${meetingPoint}`,
    ...flights,
    ...inclusions.slice(0, 12).map((item) => `Included: ${item}`),
  ].filter((value): value is string => Boolean(value));

  const logo = input.logoUrl
    ? `<img class="logo" src="${html(input.logoUrl)}" alt="NoLSAF">`
    : `<div class="logo logo-text">N</div>`;
  const barcode = (() => {
    try {
      return code128Svg(documentNumber, { height: 44, color: "#0f2e2b" });
    } catch {
      return "";
    }
  })();
  const partyRows = travellers
    .map((t, i) => `<tr><td class="num">${i + 1}</td><td class="name">${html(t.name)}${t.role === "Lead traveller" ? `<span class="tag">Lead</span>` : ""}</td><td>${html(t.nationality || "Not recorded")}</td><td class="mono">${html(t.document || "Not recorded")}</td></tr>`)
    .join("");
  const summary: Array<[string, string]> = [
    ["Arrival", displayDate(input.startDate)],
    ["Departure", displayDate(input.endDate)],
    ["Duration", duration ? `${duration} day${duration === 1 ? "" : "s"}` : "To be confirmed"],
    ["Travellers", String(Math.max(1, Number(input.travelerCount || 1)))],
  ];
  const bookingFacts: Array<[string, string]> = [
    ["Booking reference", input.bookingCode],
    ["Lead traveller", text(input.guestName) || "Not recorded"],
    ["Destination", text(input.destination) || "Tanzania"],
    ["Payment", amount > 0 ? `${text(input.currency || "TZS")} ${amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}${paid ? " paid in full" : ""}` : statusText],
  ];

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${html(documentTitle)} ${html(input.bookingCode)}</title>
<style>
  :root{color-scheme:light;--brand:#02665e;--deep:#024d47;--ink:#0f2e2b;--body:#1e3a38;--muted:#5a9990;--soft:#8aaca9;--cell:#f7fbfa;--line:#dcebe8}
  *{box-sizing:border-box}html,body{margin:0;background:#fff;color:var(--body);font-family:${DOCUMENT_FONT};font-size:11px;line-height:1.5}
  .sheet{position:relative;width:210mm;min-height:297mm;margin:0 auto;padding:12mm 14mm 14mm;background:#fff}
  .dots{height:4px;background-image:radial-gradient(circle,var(--brand) 1.2px,transparent 1.4px);background-size:9px 4px;background-repeat:repeat-x;opacity:.55}

  /* Header: identity left, document number and barcode right */
  .head{display:grid;grid-template-columns:1fr auto;align-items:center;gap:20px;padding:10px 0 12px}
  .brandline{display:flex;align-items:center;gap:11px}.logo{width:44px;height:44px;border-radius:10px;object-fit:contain;background:#fff;border:1px solid var(--line)}
  .logo-text{display:grid;place-items:center;background:var(--brand);color:#fff;font-weight:900;font-size:20px;border:0}
  .brand{font-size:20px;font-weight:900;color:var(--deep);letter-spacing:-.3px;line-height:1.1}.brand small{display:block;margin-top:3px;color:var(--muted);font-size:7.5px;font-weight:700;letter-spacing:1.6px;text-transform:uppercase}
  .docid{text-align:right}.docid .kind{font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px}
  .barcode{margin-top:6px;width:62mm;height:12mm}.barcode svg{display:block;width:100%;height:100%}
  .symb{margin-top:1px;font-size:6.5px;color:var(--soft);letter-spacing:.8px}.docno{margin-top:3px;font-family:"Courier New",Courier,monospace;font-size:9.5px;font-weight:700;letter-spacing:1.6px;color:var(--ink)}

  /* Title block */
  .titlebar{display:grid;grid-template-columns:1fr auto;align-items:end;gap:18px;margin-top:16px}
  .caption{margin:0;color:var(--muted);font-size:8.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase}
  h1{margin:3px 0 3px;font-size:24px;line-height:1.12;font-weight:900;color:var(--ink)}.lead{margin:0;color:var(--muted);font-size:10px}
  .status{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;border-radius:999px;background:#e6f3f1;color:var(--brand);font-weight:800;font-size:9.5px;white-space:nowrap}
  .status::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor}
  .status.review{background:#fff4e0;color:#8a5a00}

  /* Summary: four key figures, then booking facts */
  .summary{display:grid;grid-template-columns:repeat(4,1fr);margin-top:14px;border-radius:10px;overflow:hidden;background:var(--deep);color:#fff}
  .summary div{padding:10px 12px;border-right:1px solid rgba(255,255,255,.14)}.summary div:last-child{border-right:0}
  .summary span{display:block;font-size:7.5px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:rgba(255,255,255,.65)}
  .summary strong{display:block;margin-top:3px;font-size:12.5px;font-weight:800}
  .facts{display:grid;grid-template-columns:1fr 1fr;gap:5px 10px;margin-top:8px}.fact{display:flex;justify-content:space-between;gap:12px;padding:7px 10px;border-radius:7px;background:var(--cell)}.fact span{color:var(--muted)}.fact strong{text-align:right;color:var(--ink)}

  section{margin-top:16px}
  h2{display:flex;align-items:center;gap:8px;margin:0 0 8px;font-size:9.5px;font-weight:800;color:var(--deep);text-transform:uppercase;letter-spacing:1.3px}
  h2::after{content:"";flex:1;border-top:1px dotted var(--soft)}
  h2 b{display:inline-grid;place-items:center;width:17px;height:17px;border-radius:5px;background:var(--brand);color:#fff;font-size:9px;letter-spacing:0}

  table{width:100%;border-collapse:collapse}thead th{padding:6px 9px;text-align:left;background:var(--cell);color:var(--muted);font-size:7.5px;font-weight:700;text-transform:uppercase;letter-spacing:.9px}
  tbody td{padding:7px 9px;border-bottom:1px dotted var(--line);color:var(--ink)}td.num{width:26px;color:var(--soft);font-weight:700}td.name{font-weight:700}td.mono{font-family:"Courier New",Courier,monospace;letter-spacing:.8px}
  .tag{margin-left:6px;padding:1px 6px;border-radius:999px;background:#e6f3f1;color:var(--brand);font-size:7.5px;font-weight:800;text-transform:uppercase;letter-spacing:.6px}

  .timeline{position:relative;margin:0;padding:0;list-style:none}
  .day{position:relative;display:grid;grid-template-columns:44px 1fr;gap:12px;padding:0 0 10px;break-inside:avoid}
  .day:not(:last-child)::before{content:"";position:absolute;left:19px;top:40px;bottom:0;border-left:1.5px dotted var(--soft)}
  .day-number{display:flex;flex-direction:column;width:40px;height:40px;align-items:center;justify-content:center;border-radius:10px;background:var(--brand);color:#fff;font-weight:900;font-size:15px;line-height:1}
  .day-number small{font-size:6.5px;font-weight:700;letter-spacing:.9px;text-transform:uppercase;opacity:.8;margin-bottom:2px}
  .daycard{padding:8px 11px;border-radius:9px;background:var(--cell)}
  .day h3{display:flex;justify-content:space-between;gap:10px;margin:0 0 3px;font-size:11.5px;color:var(--ink)}.day h3 em{font-style:normal;font-weight:700;font-size:9px;color:var(--muted);white-space:nowrap}
  .day p{margin:0 0 3px}.day ul{margin:4px 0 0;padding:0;list-style:none}.day li{display:grid;grid-template-columns:44px 1fr;gap:8px;margin:2px 0}.day time{font-weight:800;color:var(--brand)}
  .overnight{margin-top:5px;padding-top:5px;border-top:1px dotted var(--line);color:var(--deep)}.overnight b{font-size:8px;text-transform:uppercase;letter-spacing:.8px;color:var(--muted)}
  .empty{color:var(--muted);font-style:italic}

  .split{display:grid;grid-template-columns:1fr 1fr;gap:16px}
  .kv{margin:0}.kv div{display:flex;justify-content:space-between;gap:12px;padding:5px 0;border-bottom:1px dotted var(--line)}.kv dt{color:var(--muted)}.kv dd{margin:0;text-align:right;color:var(--ink);font-weight:700}
  .support{margin:0;padding:0;list-style:none}.support li{padding:5px 0 5px 14px;border-bottom:1px dotted var(--line);position:relative}.support li::before{content:"";position:absolute;left:2px;top:11px;width:5px;height:5px;border-radius:50%;background:var(--brand)}

  /* Authentication: the QR opens the online check; the barcode lives in the header */
  .auth{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:16px;margin-top:16px;padding:12px 14px;border:1px solid var(--line);border-radius:11px;break-inside:avoid}
  .auth .qr{width:78px;height:78px;padding:4px;border-radius:8px;background:#fff;border:1px solid var(--line)}
  .auth strong{display:block;color:var(--deep);font-size:11px}.auth p{margin:3px 0 0;color:var(--muted);font-size:8.5px}.auth .url{margin-top:4px;font-family:"Courier New",Courier,monospace;font-size:7.5px;color:var(--body);word-break:break-all}

  .notice{margin-top:12px;padding:8px 11px;border-radius:8px;background:#fff9ed;color:#70521c;font-size:8.5px}
  footer{margin-top:14px}.seal{display:flex;justify-content:space-between;align-items:center;gap:20px;padding:8px 0;color:var(--muted);font-size:8px}.seal b{color:var(--deep);letter-spacing:.4px}
  @page{size:A4;margin:0}@media print{html,body{print-color-adjust:exact;-webkit-print-color-adjust:exact}.sheet{margin:0;box-shadow:none}section,.auth{break-inside:avoid-page}}
</style></head><body><main class="sheet">
  <div class="dots"></div>
  <div class="head">
    <div class="brandline">${logo}<div class="brand">NoLSAF<small>Travel booking platform</small></div></div>
    <div class="docid"><div class="kind">${html(documentTitle)}</div>${barcode ? `<div class="barcode">${barcode}</div>` : ""}<div class="docno">${html(documentNumber)}</div><div class="symb">CODE 128 · ISO/IEC 15417</div></div>
  </div>
  <div class="dots"></div>

  <div class="titlebar">
    <div>
      <p class="caption">${html(input.destination || "Tanzania")} · ${html(duration ? `${duration} day${duration === 1 ? "" : "s"}` : "Tour package")} · ${html(operatorName)}</p>
      <h1>${html(input.title || "Tour itinerary")}</h1>
      <p class="lead">Issued ${html(issuedLabel)} for presentation with a travel or visa application.</p>
    </div>
    <span class="status${underReview ? " review" : ""}">${html(statusText)}</span>
  </div>

  <div class="summary">${summary.map(([label, value]) => `<div><span>${html(label)}</span><strong>${html(value)}</strong></div>`).join("")}</div>
  <div class="facts">${renderRows(bookingFacts)}</div>

  <section><h2><b>1</b>Travelling party</h2><table><thead><tr><th>#</th><th>Full name</th><th>Nationality</th><th>Travel document</th></tr></thead><tbody>${partyRows}</tbody></table></section>

  <section><h2><b>2</b>Day-by-day itinerary</h2>${days.length ? `<ol class="timeline">${itineraryHtml}</ol>` : itineraryHtml}</section>

  <section class="split">
    <div><h2><b>3</b>Arrangements</h2>${supportItems.length ? `<ul class="support">${supportItems.map((item) => `<li>${html(item)}</li>`).join("")}</ul>` : `<p class="empty">No additional arrangements recorded.</p>`}</div>
    <div><h2><b>4</b>Tour operator</h2><dl class="kv">${operatorFacts.filter(([, v]) => text(v)).map(([label, value]) => `<div><dt>${html(label)}</dt><dd>${html(value)}</dd></div>`).join("")}</dl></div>
  </section>

  <div class="auth">
    ${input.verificationQrDataUrl ? `<img class="qr" src="${html(input.verificationQrDataUrl)}" alt="Verification QR code">` : ""}
    <div><strong>Document authentication</strong><p>Scan the QR code, or open the link below, to confirm this booking, its dates and travellers directly with NoLSAF. The barcode at the top of this page carries the document number.</p>${input.verificationUrl ? `<div class="url">${html(input.verificationUrl)}</div>` : ""}</div>
  </div>

  <div class="notice"><strong>Important:</strong> This document confirms the itinerary recorded for the NoLSAF booking shown above. It is not a visa, immigration decision, airline ticket, or guarantee of entry. Travel document numbers are partly hidden for privacy. The traveller remains responsible for meeting the requirements of the relevant embassy, consulate, airline, and border authority.</div>
  <footer><div class="dots"></div><div class="seal"><span><b>NoLSAF · Certified travel itinerary</b> · Issued electronically, valid without signature</span><span>${html(documentNumber)}</span></div><div class="dots"></div></footer>
</main></body></html>`;
}
