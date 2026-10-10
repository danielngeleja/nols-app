/**
 * The readable (PDF) copy of a guest's personal data, printed on the device.
 * Same sections, wording and confidentiality notices as the web copy
 * (apps/web/lib/customerDataReport.ts on staging); the styles are self-contained
 * because the app has no shared admin report stylesheet.
 */

/** Shape of GET /api/account/export. */
export type AccountExport = {
  exportedAt: string;
  profile: { name: string | null; email: string | null; phone: string | null; memberSince: string; preferredCurrency: string | null };
  notificationPreferences: { bookings?: boolean; promotions?: boolean; referrals?: boolean };
  stays: Array<{ reference: string; property: string | null; city: string | null; status: string; checkIn: string; checkOut: string; rooms: number; total: number; bookedAt: string }>;
  rides: Array<{ reference: string; status: string; scheduledFor: string; vehicle: string | null; from: string | null; to: string | null; amount: number | null; currency: string; bookedAt: string }>;
  tours?: Array<{ reference: string; title: string; destination: string | null; startDate: string | null; status: string; amount: number; currency: string; bookedAt: string }>;
  groupStays?: Array<{ reference: string; groupType: string; accommodation: string; from: string | null; to: string | null; people: number; checkIn: string | null; checkOut: string | null; status: string; amount: number | null; currency: string; requestedAt: string }>;
  cancellations?: Array<{ stay: string | null; status: string; reason: string | null; refundAmount: number | null; refundedAt: string | null; requestedAt: string }>;
  reviews?: Array<{ property: string | null; rating: number; title: string | null; comment: string | null; writtenAt: string }>;
  savedStays?: Array<{ property: string | null; city: string | null; savedAt: string }>;
  tripEstimates?: Array<{ destination: string; startDate: string; endDate: string; travellers: number; estimatedTotal: number | null; currency: string; createdAt: string }>;
  referrals?: { peopleJoinedWithYourInvite: number };
  karibu: {
    preferences: { celebrateSpecialDays: boolean; birthday: string | null; drinksEnjoyed: string[]; dietaryNeeds: string[]; dietaryNote: string | null; shareWithProperty: boolean } | null;
    welcomes: Array<{ stay: string; status: string; issuedAt: string; servedAt: string | null; feedback: { received: boolean; rating: number | null; note: string | null } | null }>;
  };
};

const EAT = "Africa/Dar_es_Salaam";
const PRINT_ROW_LIMIT = 200;
const DRINK: Record<string, string> = { TEA_COFFEE: "Tea or coffee", FRESH_JUICE: "Fresh juice", SOFT_DRINK: "Soft drink", WATER: "Water", MOCKTAIL: "Mocktail" };
const DIET: Record<string, string> = { NO_SUGAR: "No sugar", LACTOSE_FREE: "Lactose-free", NUT_ALLERGY: "Nut allergy", VEGETARIAN: "Vegetarian" };
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

const esc = (value: unknown) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: EAT }) : "Not recorded";
const stamp = (iso: string) => {
  const d = new Date(iso);
  return `${d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: EAT })}, ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: EAT })} EAT`;
};
const money = (value: number | null | undefined, currency = "TZS") => (value == null ? "Not recorded" : `${currency} ${Math.round(value).toLocaleString("en-US")}`);
const pretty = (value: string | null | undefined) => {
  const text = String(value || "").replace(/_/g, " ").toLowerCase();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : "Not recorded";
};
// "SHERATON HOTEL" prints as "Sheraton Hotel"; mixed-case names stay as written.
const tidy = (value: string | null | undefined) => {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (c) => c.toUpperCase());
};
const nights = (from: string, to: string) => Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
const yesNo = (on: boolean | undefined) => (on ? "On" : "Off");
const birthdayLabel = (value: string | null) => {
  const [d, m] = String(value || "").split("/").map(Number);
  return d && m ? `${d} ${MONTHS[m - 1]}` : "Not set";
};
const empty = (cols: number, text: string) => `<tr><td colspan="${cols}" class="emptyState">${esc(text)}</td></tr>`;

/** A short, human reference for the printed copy. Not a record id. */
export function dataReportReference(at: Date) {
  const ymd = at.toISOString().slice(0, 10).replace(/-/g, "");
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NOLSAF-MYDATA-${ymd}-${tail}`;
}

/** Record counts for the "your copy is ready" summary. */
export function exportCounts(data: AccountExport) {
  return [
    { label: "Stays", count: data.stays.length },
    { label: "Tours", count: (data.tours ?? []).length },
    { label: "Group stays", count: (data.groupStays ?? []).length },
    { label: "Rides", count: data.rides.length },
    { label: "Cancellations", count: (data.cancellations ?? []).length },
    { label: "Reviews", count: (data.reviews ?? []).length },
    { label: "Saved stays", count: (data.savedStays ?? []).length },
    { label: "Welcomes", count: data.karibu.welcomes.length }
  ];
}

const STYLES = `
  @page { size: A4 portrait; margin: 14mm 12mm 16mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; font-size: 9.5px; line-height: 1.45; }
  .watermark { position: fixed; top: 42%; left: 0; right: 0; text-align: center; transform: rotate(-28deg); font-size: 46px; font-weight: 800; color: rgba(185,28,28,.07); letter-spacing: 2px; z-index: 0; }
  .doc { position: relative; z-index: 1; }
  .cover { border-radius: 10px; background: #012a26; color: #fff; padding: 18px 20px; }
  .brand { font-size: 15px; font-weight: 800; letter-spacing: .2px; }
  .brand span { color: #a7d8d2; }
  .eyebrow { margin-top: 14px; color: #a7d8d2; font-size: 9px; font-weight: 700; }
  h1 { margin: 2px 0 6px; font-size: 21px; }
  .lede { margin: 0; color: #cfe7e3; font-size: 9.5px; max-width: 92%; }
  .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 14px; }
  .meta div { border: 1px solid rgba(255,255,255,.14); border-radius: 6px; padding: 7px 9px; }
  .meta b { display: block; color: #a7d8d2; font-size: 7.5px; font-weight: 700; margin-bottom: 2px; }
  .confidential { display: grid; grid-template-columns: 22px 1fr; gap: 10px; margin-top: 10px; padding: 10px 12px; border: 1px solid #f3c2c2; border-radius: 6px; background: #fff5f5; color: #6b1d1d; font-size: 8.5px; }
  .confidential .mark { width: 22px; height: 22px; border-radius: 5px; background: #b91c1c; color: #fff; font-weight: 900; text-align: center; line-height: 22px; }
  .confidential strong { display: block; color: #7f1d1d; margin-bottom: 2px; }
  .metrics { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; margin-top: 12px; }
  .metric { border: 1px solid #e2e8f0; border-radius: 8px; padding: 9px 10px; break-inside: avoid; }
  .metric span { color: #64748b; font-size: 8px; font-weight: 700; }
  .metric strong { display: block; font-size: 15px; margin: 2px 0; color: #02665e; }
  .metric small { color: #64748b; font-size: 7.5px; }
  section { margin-top: 16px; break-inside: auto; }
  .head { display: flex; gap: 9px; align-items: flex-start; margin-bottom: 6px; }
  .num { color: #02665e; }
  .head .n { flex: none; width: 22px; height: 22px; border-radius: 5px; background: #e6f4f2; color: #02665e; font-weight: 800; font-size: 9px; text-align: center; line-height: 22px; }
  h2 { margin: 0; font-size: 12px; }
  .head p { margin: 1px 0 0; color: #64748b; font-size: 8.5px; }
  table { width: 100%; border-collapse: collapse; }
  th { text-align: left; font-size: 7.5px; color: #64748b; font-weight: 700; border-bottom: 1px solid #cbd5e1; padding: 5px 6px; }
  td { border-bottom: 1px solid #eef2f6; padding: 5px 6px; vertical-align: top; }
  tr { break-inside: avoid; }
  td.r, th.r { text-align: right; }
  .muted { color: #64748b; }
  code { font-family: Consolas, "Courier New", monospace; font-size: 7.5px; }
  .emptyState { color: #64748b; font-style: italic; text-align: center; padding: 10px; }
  .panels { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 8px; }
  .panel { border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; break-inside: avoid; }
  .panel .t { background: #f8fafc; padding: 6px 9px; font-weight: 700; font-size: 8.5px; border-bottom: 1px solid #e2e8f0; }
  .note { margin-top: 6px; color: #64748b; font-size: 8px; }
  .about { margin-top: 18px; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; break-inside: avoid; }
  .about .ref { display: inline-block; margin-top: 4px; padding: 4px 8px; border-radius: 5px; background: #f1f5f9; }
  .footer { position: fixed; bottom: -8mm; left: 0; right: 0; display: flex; justify-content: space-between; color: #8a3b3b; font-size: 7px; border-top: 1px solid #f0d4d4; padding-top: 3px; }
`;

export function buildDataReportHtml(data: AccountExport, reportRef: string) {
  const name = data.profile.name?.trim() || "NoLSAF guest";
  const stays = data.stays.slice(0, PRINT_ROW_LIMIT);
  const rides = data.rides.slice(0, PRINT_ROW_LIMIT);
  const stayByRef = new Map(data.stays.map((s) => [s.reference, s]));
  const completed = data.stays.filter((s) => s.status === "CHECKED_OUT");
  const nightsTotal = completed.reduce((sum, s) => sum + nights(s.checkIn, s.checkOut), 0);
  const prefs = data.karibu.preferences;
  const oldest = [...data.stays.map((s) => s.bookedAt), ...data.rides.map((r) => r.bookedAt)].sort()[0] || data.profile.memberSince;
  const tours = (data.tours ?? []).slice(0, PRINT_ROW_LIMIT);
  const groupStays = (data.groupStays ?? []).slice(0, PRINT_ROW_LIMIT);
  const cancellations = (data.cancellations ?? []).slice(0, PRINT_ROW_LIMIT);
  const reviews = (data.reviews ?? []).slice(0, PRINT_ROW_LIMIT);
  const savedStays = (data.savedStays ?? []).slice(0, PRINT_ROW_LIMIT);
  const estimates = (data.tripEstimates ?? []).slice(0, PRINT_ROW_LIMIT);
  const joined = data.referrals?.peopleJoinedWithYourInvite ?? 0;
  const generatedAt = stamp(data.exportedAt);

  const stayRows = stays.length
    ? stays.map((s) => `<tr><td><code>${esc(s.reference)}</code></td><td>${esc(tidy(s.property) || "Property")}${s.city ? `<br/><span class="muted">${esc(tidy(s.city))}</span>` : ""}</td><td>${esc(day(s.checkIn))}<br/><span class="muted">to ${esc(day(s.checkOut))}</span></td><td class="r">${nights(s.checkIn, s.checkOut)}</td><td>${esc(pretty(s.status))}</td><td class="r">${esc(money(s.total))}</td></tr>`).join("")
    : empty(6, "No stays booked with this account.");
  const tourRows = tours.length
    ? tours.map((t) => `<tr><td><code>${esc(t.reference)}</code></td><td>${esc(t.title)}${t.destination ? `<br/><span class="muted">${esc(t.destination)}</span>` : ""}</td><td>${esc(day(t.startDate))}</td><td>${esc(pretty(t.status))}</td><td class="r">${esc(money(t.amount, t.currency))}</td></tr>`).join("")
    : empty(5, "No tour packages booked with this account.");
  const groupRows = groupStays.length
    ? groupStays.map((g) => `<tr><td><code>${esc(g.reference)}</code></td><td>${esc(pretty(g.groupType))}, ${esc(g.people)} people<br/><span class="muted">${esc(pretty(g.accommodation))}${g.to ? ` in ${esc(g.to)}` : ""}</span></td><td>${esc(day(g.checkIn))}<br/><span class="muted">to ${esc(day(g.checkOut))}</span></td><td>${esc(pretty(g.status))}</td><td class="r">${esc(money(g.amount, g.currency))}</td></tr>`).join("")
    : empty(5, "No group stays requested with this account.");
  const rideRows = rides.length
    ? rides.map((r) => `<tr><td><code>${esc(r.reference)}</code></td><td>${esc(r.from || "Not recorded")}<br/><span class="muted">to ${esc(r.to || "Not recorded")}</span></td><td>${esc(day(r.scheduledFor))}</td><td>${esc(pretty(r.vehicle))}</td><td>${esc(pretty(r.status))}</td><td class="r">${esc(money(r.amount, r.currency))}</td></tr>`).join("")
    : empty(6, "No rides booked with this account.");
  const cancellationRows = cancellations.length
    ? cancellations.map((c) => `<tr><td>${c.stay ? `<code>${esc(c.stay)}</code>` : "Stay"}</td><td>${esc(day(c.requestedAt))}</td><td>${esc(pretty(c.status))}${c.reason ? `<br/><span class="muted">${esc(c.reason)}</span>` : ""}</td><td class="r">${esc(c.refundAmount == null ? "None" : money(c.refundAmount))}</td><td>${esc(c.refundedAt ? day(c.refundedAt) : "Not refunded")}</td></tr>`).join("")
    : empty(5, "No cancellation or refund requests.");
  const reviewRows = reviews.length
    ? reviews.map((r) => `<tr><td>${esc(tidy(r.property) || "Property")}</td><td class="r">${esc(r.rating)}/5</td><td>${esc(r.title || "")}${r.comment ? `<br/><span class="muted">${esc(r.comment)}</span>` : ""}</td><td>${esc(day(r.writtenAt))}</td></tr>`).join("")
    : empty(4, "No reviews written.");
  const savedRows = savedStays.length
    ? savedStays.map((v) => `<tr><td>${esc(tidy(v.property) || "Property")}${v.city ? `<br/><span class="muted">${esc(tidy(v.city))}</span>` : ""}</td><td class="r">${esc(day(v.savedAt))}</td></tr>`).join("")
    : empty(2, "No saved stays.");
  const estimateRows = estimates.length
    ? estimates.map((e) => `<tr><td>${esc(e.destination)}<br/><span class="muted">${esc(day(e.startDate))} to ${esc(day(e.endDate))}, ${esc(e.travellers)} traveller(s)</span></td><td class="r">${esc(money(e.estimatedTotal, e.currency))}</td></tr>`).join("")
    : empty(2, "No trip estimates made.");
  const welcomeRows = data.karibu.welcomes.length
    ? data.karibu.welcomes.map((w) => `<tr><td>${esc(tidy(stayByRef.get(w.stay)?.property) || "Stay")}<br/><span class="muted"><code>${esc(w.stay)}</code></span></td><td>${w.status === "SERVED" ? "Served" : "Being prepared"}</td><td>${esc(day(w.servedAt || w.issuedAt))}</td><td>${esc(w.feedback ? (w.feedback.received ? `Received, rated ${w.feedback.rating ?? "-"}/5` : "Reported not received") : "No feedback given")}${w.feedback?.note ? `<br/><span class="muted">${esc(w.feedback.note)}</span>` : ""}</td></tr>`).join("")
    : empty(4, "No welcome has been prepared for you yet.");

  const section = (n: string, title: string, sub: string, body: string) =>
    `<section><div class="head"><span class="n">${n}</span><div><h2>${esc(title)}</h2><p>${esc(sub)}</p></div></div>${body}</section>`;

  return `<!doctype html><html><head><meta charset="utf-8"/><title>${esc(`NoLSAF-my-data-${data.exportedAt.slice(0, 10)}`)}</title><style>${STYLES}</style></head><body>
<div class="watermark">CONFIDENTIAL · ${esc(reportRef)}</div>
<div class="footer"><span>Confidential. Personal data of ${esc(name)}. Do not share or copy.</span><span>${esc(reportRef)}</span></div>
<div class="doc">
  <div class="cover">
    <div class="brand">NoL<span>SAF</span></div>
    <div class="eyebrow">NoLSAF personal data copy</div>
    <h1>Your data with NoLSAF</h1>
    <p class="lede">Everything your NoLSAF account holds about ${esc(name)}: your profile, every stay, tour, group stay and ride, cancellations and refunds, reviews, saved stays, trip estimates, your notification choices and your welcome preferences. Prepared at your request.</p>
    <div class="meta">
      <div><b>Prepared for</b>${esc(name)}</div>
      <div><b>Records covered</b>${esc(day(oldest))} to ${esc(day(data.exportedAt))}</div>
      <div><b>Generated</b>${esc(generatedAt)}</div>
      <div><b>Data controller</b>NoLS Africa Co Ltd</div>
      <div><b>Basis</b>Your right to access your personal data</div>
      <div><b>Reference</b><code>${esc(reportRef)}</code></div>
    </div>
  </div>

  <div class="confidential"><span class="mark">!</span><div><strong>Confidential personal data</strong>This document contains the personal data of ${esc(name)}, prepared only for them at their own request after confirming their identity with a one-time code. It is not an invoice, receipt or proof of payment, and it cannot be used to make or change a booking. Do not share, forward, publish or copy it. If you are not ${esc(name)} and this document reached you, delete it and tell NoLSAF at privacy@nolsaf.com.</div></div>

  <div class="metrics">
    <div class="metric"><span>Stays</span><strong>${data.stays.length}</strong><small>${completed.length} completed, ${nightsTotal} night(s) in total.</small></div>
    <div class="metric"><span>Tour packages</span><strong>${(data.tours ?? []).length}</strong><small>Booked through NoLSAF.</small></div>
    <div class="metric"><span>Group stays</span><strong>${(data.groupStays ?? []).length}</strong><small>Requested for a group.</small></div>
    <div class="metric"><span>Rides</span><strong>${data.rides.length}</strong><small>Booked through NoLSAF.</small></div>
    <div class="metric"><span>Reviews written</span><strong>${(data.reviews ?? []).length}</strong><small>${joined} people joined with your invite.</small></div>
    <div class="metric"><span>Member since</span><strong style="font-size:12px">${esc(day(data.profile.memberSince))}</strong><small>The date your NoLSAF account was created.</small></div>
  </div>

  ${section("01", "Your profile", "The details you gave us and use to sign in.", `<table><thead><tr><th>Field</th><th>Recorded value</th><th>Field</th><th>Recorded value</th></tr></thead><tbody>
    <tr><td>Name</td><td>${esc(data.profile.name || "Not set")}</td><td>Member since</td><td>${esc(day(data.profile.memberSince))}</td></tr>
    <tr><td>Email</td><td>${esc(data.profile.email || "Not set")}</td><td>Phone</td><td>${esc(data.profile.phone || "Not set")}</td></tr>
    <tr><td>Preferred currency</td><td>${esc(data.profile.preferredCurrency || "TZS")}</td><td>Copy prepared</td><td>${esc(generatedAt)}</td></tr>
  </tbody></table>`)}

  ${section("02", "Stays", "Every stay booked with this account, newest first.", `<table><thead><tr><th style="width:24%">Reference</th><th>Property</th><th style="width:16%">Dates</th><th class="r" style="width:7%">Nights</th><th style="width:12%">Status</th><th class="r" style="width:14%">Total</th></tr></thead><tbody>${stayRows}</tbody></table>${data.stays.length > PRINT_ROW_LIMIT ? `<div class="note">This copy prints the latest ${PRINT_ROW_LIMIT} stays. The machine-readable copy holds them all.</div>` : ""}`)}

  ${section("03", "Tour packages", "Every tour booked with this account, newest first.", `<table><thead><tr><th style="width:24%">Reference</th><th>Tour</th><th style="width:13%">Starts</th><th style="width:14%">Status</th><th class="r" style="width:15%">Amount</th></tr></thead><tbody>${tourRows}</tbody></table>`)}

  ${section("04", "Group stays", "Group accommodation you requested, newest first.", `<table><thead><tr><th style="width:24%">Reference</th><th>Group</th><th style="width:16%">Dates</th><th style="width:14%">Status</th><th class="r" style="width:15%">Amount</th></tr></thead><tbody>${groupRows}</tbody></table>`)}

  ${section("05", "Rides", "Every ride booked with this account, newest first.", `<table><thead><tr><th style="width:24%">Reference</th><th>Route</th><th style="width:13%">Date</th><th style="width:11%">Vehicle</th><th style="width:12%">Status</th><th class="r" style="width:14%">Fare</th></tr></thead><tbody>${rideRows}</tbody></table>`)}

  ${section("06", "Cancellations and refunds", "Every cancellation you asked for, and whether money came back.", `<table><thead><tr><th style="width:24%">Stay</th><th style="width:13%">Requested</th><th>Status and reason</th><th class="r" style="width:15%">Refund</th><th style="width:14%">Refunded</th></tr></thead><tbody>${cancellationRows}</tbody></table>`)}

  ${section("07", "Reviews, saved stays and trip estimates", "What you wrote, kept and planned on NoLSAF.", `<table><thead><tr><th style="width:30%">Reviewed property</th><th class="r" style="width:9%">Rating</th><th>Your review</th><th style="width:14%">Written</th></tr></thead><tbody>${reviewRows}</tbody></table>
    <div class="panels"><div class="panel"><div class="t">Saved stays</div><table><tbody>${savedRows}</tbody></table></div><div class="panel"><div class="t">Trip estimates</div><table><tbody>${estimateRows}</tbody></table></div></div>`)}

  ${section("08", "Your choices", "What we may send you, and what you told us about how you like to be welcomed.", `<div class="panels">
    <div class="panel"><div class="t">Notifications</div><table><tbody>
      <tr><td>Bookings and payments</td><td class="r">Always on</td></tr>
      <tr><td>Account security</td><td class="r">Always on</td></tr>
      <tr><td>Offers and news</td><td class="r">${yesNo(data.notificationPreferences.promotions)}</td></tr>
      <tr><td>Referral updates</td><td class="r">${yesNo(data.notificationPreferences.referrals)}</td></tr>
    </tbody></table></div>
    <div class="panel"><div class="t">Welcome preferences</div>${prefs ? `<table><tbody>
      <tr><td>Drinks you enjoy</td><td class="r">${esc(prefs.drinksEnjoyed.map((d) => DRINK[d] ?? d).join(", ") || "None chosen")}</td></tr>
      <tr><td>Dietary needs</td><td class="r">${esc(prefs.dietaryNeeds.map((t) => DIET[t] ?? t).join(", ") || "None")}</td></tr>
      ${prefs.dietaryNote ? `<tr><td>Note</td><td class="r">${esc(prefs.dietaryNote)}</td></tr>` : ""}
      <tr><td>Celebrate special days</td><td class="r">${yesNo(prefs.celebrateSpecialDays)}${prefs.celebrateSpecialDays ? `, ${esc(birthdayLabel(prefs.birthday))}` : ""}</td></tr>
      <tr><td>Shared with the property</td><td class="r">${prefs.shareWithProperty ? "Yes, during your stay" : "No"}</td></tr>
    </tbody></table>` : `<p class="emptyState">You have not set any welcome preferences.</p>`}</div>
  </div>`)}

  ${section("09", "Welcomes prepared for you", "Karibu by NoLSAF welcomes served by a property during your stays.", `<table><thead><tr><th>Stay</th><th style="width:15%">Status</th><th style="width:15%">Date</th><th style="width:34%">Your feedback</th></tr></thead><tbody>${welcomeRows}</tbody></table>`)}

  <div class="about">
    <h2>About this copy</h2>
    <p>This document was prepared from your NoLSAF account at your request on ${esc(generatedAt)}. Passwords and sign-in secrets are never stored in readable form and are not included. Bookings are listed by their reference, never by internal record numbers. To correct anything here, update it in your account or write to privacy@nolsaf.com. To close your account, see nolsaf.com/account-deletion. Keep this copy private: it contains your contact details and travel history.</p>
    <p><strong>Confidentiality.</strong> This copy is confidential and for the named account holder only. NoLSAF is not responsible for what happens to it after it leaves your account. Anyone else who holds it may not use, share or rely on it, and should delete it and inform privacy@nolsaf.com. NoLSAF records every copy that is downloaded.</p>
    <span class="ref">Reference <code>${esc(reportRef)}</code></span>
  </div>
</div>
</body></html>`;
}
