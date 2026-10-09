import { escapeHtml } from "@/utils/html";
import { adminReportPrintStyles, buildAdminReportHeader, buildAdminReportWatermark } from "@/lib/adminReportPrint";

/** Shape of GET /api/account/export. */
export type AccountExport = {
  exportedAt: string;
  profile: { name: string | null; email: string | null; phone: string | null; memberSince: string; preferredCurrency: string | null };
  notificationPreferences: { bookings?: boolean; promotions?: boolean; referrals?: boolean };
  stays: Array<{ reference: string; property: string | null; city: string | null; status: string; checkIn: string; checkOut: string; rooms: number; total: number; bookedAt: string }>;
  rides: Array<{ reference: string; status: string; scheduledFor: string; vehicle: string | null; from: string | null; to: string | null; amount: number | null; currency: string; bookedAt: string }>;
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

const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: EAT }) : "Not recorded");
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
const empty = (cols: number, text: string) => `<tr><td colspan="${cols}" class="emptyState">${escapeHtml(text)}</td></tr>`;

/** A short, human reference for the printed copy. Not a record id. */
export function customerDataReportReference(at: Date) {
  const ymd = at.toISOString().slice(0, 10).replace(/-/g, "");
  const tail = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `NOLSAF-MYDATA-${ymd}-${tail}`;
}

/**
 * The guest's personal data copy, laid out in the NoLSAF report template
 * (lib/adminReportPrint.ts): cover, headline figures, numbered sections, and a
 * closing block. It is a personal copy, so there is no management seal or
 * signature; the reference identifies the printout.
 */
export function buildCustomerDataReportHtml(data: AccountExport, options: { logoUrl: string; reportRef: string; barcodeDataUrl?: string | null }) {
  const name = data.profile.name?.trim() || "NoLSAF guest";
  const stays = data.stays.slice(0, PRINT_ROW_LIMIT);
  const rides = data.rides.slice(0, PRINT_ROW_LIMIT);
  const stayByRef = new Map(data.stays.map((s) => [s.reference, s]));
  const completed = data.stays.filter((s) => s.status === "CHECKED_OUT");
  const nightsTotal = completed.reduce((sum, s) => sum + nights(s.checkIn, s.checkOut), 0);
  const prefs = data.karibu.preferences;
  const oldest = [...data.stays.map((s) => s.bookedAt), ...data.rides.map((r) => r.bookedAt)].sort()[0] || data.profile.memberSince;

  const stayRows = stays.length ? stays.map((s) => `
      <tr>
        <td><code>${escapeHtml(s.reference)}</code></td>
        <td>${escapeHtml(tidy(s.property) || "Property")}${s.city ? `<br /><span class="muted">${escapeHtml(tidy(s.city))}</span>` : ""}</td>
        <td>${escapeHtml(day(s.checkIn))}<br /><span class="muted">to ${escapeHtml(day(s.checkOut))}</span></td>
        <td class="num">${escapeHtml(String(nights(s.checkIn, s.checkOut)))}</td>
        <td>${escapeHtml(pretty(s.status))}</td>
        <td class="num">${escapeHtml(money(s.total))}</td>
      </tr>`).join("") : empty(6, "No stays booked with this account.");

  const rideRows = rides.length ? rides.map((r) => `
      <tr>
        <td><code>${escapeHtml(r.reference)}</code></td>
        <td>${escapeHtml(r.from || "Not recorded")}<br /><span class="muted">to ${escapeHtml(r.to || "Not recorded")}</span></td>
        <td>${escapeHtml(day(r.scheduledFor))}</td>
        <td>${escapeHtml(pretty(r.vehicle))}</td>
        <td>${escapeHtml(pretty(r.status))}</td>
        <td class="num">${escapeHtml(money(r.amount, r.currency))}</td>
      </tr>`).join("") : empty(6, "No rides booked with this account.");

  const welcomeRows = data.karibu.welcomes.length ? data.karibu.welcomes.map((w) => `
      <tr>
        <td>${escapeHtml(tidy(stayByRef.get(w.stay)?.property) || "Stay")}<br /><span class="muted"><code>${escapeHtml(w.stay)}</code></span></td>
        <td>${escapeHtml(w.status === "SERVED" ? "Served" : "Being prepared")}</td>
        <td>${escapeHtml(day(w.servedAt || w.issuedAt))}</td>
        <td>${escapeHtml(w.feedback ? (w.feedback.received ? `Received, rated ${w.feedback.rating ?? "-"}/5` : "Reported not received") : "No feedback given")}${w.feedback?.note ? `<br /><span class="muted">${escapeHtml(w.feedback.note)}</span>` : ""}</td>
      </tr>`).join("") : empty(4, "No welcome has been prepared for you yet.");

  const generatedAt = stamp(data.exportedAt);

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(`NoLSAF-my-data-${data.exportedAt.slice(0, 10)}`)}</title>
  <style>
    ${adminReportPrintStyles("portrait")}
    code { font-family: Consolas, "Courier New", monospace; font-size: 7px; }
  </style>
</head>
<body>
  <div class="reportPage">
    ${buildAdminReportWatermark({ printedBy: name, reportRef: options.reportRef, printedAt: generatedAt, classification: "Personal copy" })}
    <main class="reportDocument">
    ${buildAdminReportHeader({
      logoUrl: options.logoUrl,
      eyebrow: "NoLSAF personal data copy",
      title: "Your data with NoLSAF",
      description: `Everything your NoLSAF account holds about ${name}: your profile, every stay and ride you booked, your notification choices, and your welcome preferences. Prepared at your request.`,
      reportId: data.exportedAt,
      reportRef: options.reportRef,
      barcodeDataUrl: options.barcodeDataUrl,
      periodLabel: "Records covered",
      from: day(oldest),
      to: day(data.exportedAt),
      generatedAt,
      preparedBy: `${name}, from their account`,
      classification: "Personal and confidential",
      scope: [
        { label: "Data controller", value: "NoLS Africa Co Ltd" },
        { label: "Prepared for", value: name },
        { label: "Basis", value: "Your right to access your personal data" },
      ],
    })}

    <div class="metricGrid">
      <div class="metricCard metricCardGood"><span class="metricLabel">Stays</span><strong>${escapeHtml(String(data.stays.length))}</strong><small>${escapeHtml(String(completed.length))} completed, ${escapeHtml(String(nightsTotal))} night(s) in total.</small></div>
      <div class="metricCard"><span class="metricLabel">Rides</span><strong>${escapeHtml(String(data.rides.length))}</strong><small>Booked through NoLSAF.</small></div>
      <div class="metricCard"><span class="metricLabel">Member since</span><strong>${escapeHtml(day(data.profile.memberSince))}</strong><small>The date your NoLSAF account was created.</small></div>
    </div>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">01</span><div><h2>Your profile</h2><p>The details you gave us and use to sign in.</p></div></div>
      <div class="tableWrap"><table>
        <thead><tr><th>Field</th><th>Recorded value</th><th>Field</th><th>Recorded value</th></tr></thead>
        <tbody>
          <tr><td>Name</td><td>${escapeHtml(data.profile.name || "Not set")}</td><td>Member since</td><td>${escapeHtml(day(data.profile.memberSince))}</td></tr>
          <tr><td>Email</td><td>${escapeHtml(data.profile.email || "Not set")}</td><td>Phone</td><td>${escapeHtml(data.profile.phone || "Not set")}</td></tr>
          <tr><td>Preferred currency</td><td>${escapeHtml(data.profile.preferredCurrency || "TZS")}</td><td>Copy prepared</td><td>${escapeHtml(generatedAt)}</td></tr>
        </tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">02</span><div><h2>Stays</h2><p>Every stay booked with this account, newest first.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th style="width:24%;">Reference</th><th>Property</th><th style="width:16%;">Dates</th><th style="width:7%;text-align:right;">Nights</th><th style="width:12%;">Status</th><th style="width:14%;text-align:right;">Total</th></tr></thead>
        <tbody>${stayRows}</tbody>
      </table></div>
      ${data.stays.length > PRINT_ROW_LIMIT ? `<div class="reportNote">This copy prints the latest ${PRINT_ROW_LIMIT} stays. The machine-readable copy on the Privacy and data page holds them all.</div>` : ""}
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">03</span><div><h2>Rides</h2><p>Every ride booked with this account, newest first.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th style="width:24%;">Reference</th><th>Route</th><th style="width:13%;">Date</th><th style="width:11%;">Vehicle</th><th style="width:12%;">Status</th><th style="width:14%;text-align:right;">Fare</th></tr></thead>
        <tbody>${rideRows}</tbody>
      </table></div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">04</span><div><h2>Your choices</h2><p>What we may send you, and what you told us about how you like to be welcomed.</p></div></div>
      <div class="panelGrid panelGridTwo">
        <div class="reportPanel">
          <div class="panelTitle">Notifications</div>
          <div class="panelBody"><table><tbody>
            <tr><td>Bookings and payments</td><td class="num">Always on</td></tr>
            <tr><td>Account security</td><td class="num">Always on</td></tr>
            <tr><td>Offers and news</td><td class="num">${escapeHtml(yesNo(data.notificationPreferences.promotions))}</td></tr>
            <tr><td>Referral updates</td><td class="num">${escapeHtml(yesNo(data.notificationPreferences.referrals))}</td></tr>
          </tbody></table></div>
        </div>
        <div class="reportPanel">
          <div class="panelTitle">Welcome preferences</div>
          <div class="panelBody">${prefs ? `<table><tbody>
            <tr><td>Drinks you enjoy</td><td class="num">${escapeHtml(prefs.drinksEnjoyed.map((d) => DRINK[d] ?? d).join(", ") || "None chosen")}</td></tr>
            <tr><td>Dietary needs</td><td class="num">${escapeHtml(prefs.dietaryNeeds.map((t) => DIET[t] ?? t).join(", ") || "None")}</td></tr>
            ${prefs.dietaryNote ? `<tr><td>Note</td><td class="num">${escapeHtml(prefs.dietaryNote)}</td></tr>` : ""}
            <tr><td>Celebrate special days</td><td class="num">${escapeHtml(yesNo(prefs.celebrateSpecialDays))}${prefs.celebrateSpecialDays ? `, ${escapeHtml(birthdayLabel(prefs.birthday))}` : ""}</td></tr>
            <tr><td>Shared with the property</td><td class="num">${escapeHtml(prefs.shareWithProperty ? "Yes, during your stay" : "No")}</td></tr>
          </tbody></table>` : `<p class="emptyState">You have not set any welcome preferences.</p>`}</div>
        </div>
      </div>
    </section>

    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">05</span><div><h2>Welcomes prepared for you</h2><p>Karibu by NoLSAF welcomes served by a property during your stays.</p></div></div>
      <div class="tableWrap"><table class="details">
        <thead><tr><th>Stay</th><th style="width:15%;">Status</th><th style="width:15%;">Date</th><th style="width:34%;">Your feedback</th></tr></thead>
        <tbody>${welcomeRows}</tbody>
      </table></div>
    </section>

    <section class="reportCertification">
      <div class="sectionHead"><span class="sectionNumber">✓</span><div><h2>About this copy</h2><p>What it contains, what it does not, and how to ask for changes.</p></div></div>
      <div class="certificationGrid" style="grid-template-columns: 150px minmax(0, 1fr);">
        <div class="verificationCard"><strong>Reference</strong><code>${escapeHtml(options.reportRef)}</code></div>
        <div class="certificationCopy"><strong>Your personal copy</strong>This document was prepared from your NoLSAF account at your request on ${escapeHtml(generatedAt)}. Passwords and sign-in secrets are never stored in readable form and are not included. Bookings are listed by their reference, never by internal record numbers. To correct anything here, update it in your account or write to privacy@nolsaf.com. To close your account, see nolsaf.com/account-deletion. Keep this copy private: it contains your contact details and travel history.</div>
      </div>
      <div class="documentFooter"><span>NoLSAF personal data copy</span><span>${escapeHtml(options.reportRef)}</span></div>
    </section>
    </main>
  </div>
</body>
</html>`;
}
