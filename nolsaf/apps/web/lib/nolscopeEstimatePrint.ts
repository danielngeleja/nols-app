import { adminReportPrintStyles } from "@/lib/adminReportPrint";
import { escapeAttr, escapeHtml } from "@/utils/html";

/**
 * Printable NoLScope estimate, built on the shared report print template
 * (adminReportPrint): same Trebuchet document style, header, numbered
 * sections and tables, so a traveller's estimate reads like every other
 * NoLSAF document. Traveller facing, so no confidential watermark or
 * signature block.
 */

export type EstimatePrintCategory = { key: string; label: string; hex: string; amount: number };

export type EstimatePrintRouteStop = {
  name: string;
  nights: number;
  season?: string | null;
  best?: string | null;
};

export type EstimatePrintInput = {
  logoUrl: string;
  qrDataUrl?: string | null;
  verifyUrl: string;
  reference: string;
  generatedAt: string;
  nationalityLabel: string;
  travellers: { adults: number; children: number; total: number };
  dateRange: string;
  totalNights: number;
  season: string;
  tier: string;
  transport: string;
  confidence: string;
  totalAvg: number;
  totalMin: number;
  totalMax: number;
  perAdultAvg: number;
  perPersonPerDay: number;
  categories: EstimatePrintCategory[];
  route: EstimatePrintRouteStop[];
  parks: Array<{ name: string; days: number; rate: number; rateType: string; extras: string; subtotal: number; note?: string }>;
  legs: Array<{ from: string; to: string; how: string; unit: string; cost: number | null; note?: string }>;
  activities: Array<{ name: string; unit: string; includes?: string; cost: number }>;
  stays: Array<{ name: string; nights: number; perNight: number; tier: string; subtotal: number }>;
  visa: { perAdult: number; entry: string; validity: string; processing: string };
  notes: string[];
  seasonalRules: Array<{ name: string; change: string; description: string }>;
  freshness: Array<{ label: string; value: string }>;
};

const usd = (n: number) => `$${Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

function section(n: number, title: string, sub: string, body: string) {
  return `
    <section class="reportSection">
      <div class="sectionHead"><span class="sectionNumber">${n}</span><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(sub)}</p></div></div>
      ${body}
    </section>`;
}

function table(head: string[], rows: string[][], numericCols: number[] = []) {
  if (!rows.length) return `<div class="tableWrap"><div class="emptyState">Nothing on this trip.</div></div>`;
  return `
    <div class="tableWrap"><table>
      <thead><tr>${head.map((h, i) => `<th${numericCols.includes(i) ? ' class="num"' : ""}>${escapeHtml(h)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((c, i) => `<td${numericCols.includes(i) ? ' class="num"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>`;
}

export function buildEstimatePrintHtml(d: EstimatePrintInput) {
  const sum = d.categories.reduce((s, c) => s + c.amount, 0) || 1;
  const e = escapeHtml;
  let n = 0;

  const header = `
    <header class="reportCover">
      <div class="reportCoverTop">
        <div class="reportBrand">
          <img class="reportLogo" src="${escapeAttr(d.logoUrl)}" alt="NoLSAF" />
          <div class="reportBrandCopy">
            <p class="reportEyebrow">NoLScope trip estimate</p>
            <h1>Your Tanzania trip estimate</h1>
            <p class="reportDescription">Itemised estimate for ${d.travellers.total} traveller${d.travellers.total === 1 ? "" : "s"} over ${d.totalNights} night${d.totalNights === 1 ? "" : "s"}, priced from official tariffs and verified operator rates.</p>
            <div class="reportReference">
              <div class="reportReferenceHead"><span class="reportReferenceLabel">Estimate reference</span><span class="reportReferenceCode">${e(d.reference)}</span></div>
            </div>
          </div>
        </div>
        <div class="reportMeta">
          <div class="reportMetaRow"><span>Passport</span><strong>${e(d.nationalityLabel)}</strong></div>
          <div class="reportMetaRow"><span>Travellers</span><strong>${d.travellers.adults} adult${d.travellers.adults === 1 ? "" : "s"}${d.travellers.children ? `, ${d.travellers.children} child${d.travellers.children === 1 ? "" : "ren"}` : ""}</strong></div>
          <div class="reportMetaRow"><span>Dates</span><strong>${e(d.dateRange)}</strong></div>
          <div class="reportMetaRow"><span>Season</span><strong>${e(d.season)}</strong></div>
          <div class="reportMetaRow"><span>Style</span><strong>${e(d.tier)} · ${e(d.transport)}</strong></div>
          <div class="reportMetaRow"><span>Prepared</span><strong>${e(d.generatedAt)}</strong></div>
        </div>
      </div>
      <div class="reportScope">
        <div><span>Estimated total</span><strong>${usd(d.totalAvg)}</strong></div>
        <div><span>Likely range</span><strong>${usd(d.totalMin)} to ${usd(d.totalMax)}</strong></div>
        <div><span>Per person, per day</span><strong>${usd(d.perPersonPerDay)}</strong></div>
      </div>
    </header>`;

  const metrics = `
    <div class="metricGrid">
      <div class="metricCard metricCardGood"><span class="metricLabel">Estimated total</span><strong>${usd(d.totalAvg)}</strong><small>Most likely cost for the whole group</small></div>
      <div class="metricCard"><span class="metricLabel">Per adult</span><strong>${usd(d.perAdultAvg)}</strong><small>${d.travellers.adults} adult${d.travellers.adults === 1 ? "" : "s"} sharing the trip</small></div>
      <div class="metricCard"><span class="metricLabel">Accuracy</span><strong>${e(d.confidence)}</strong><small>Based on how complete the rate data is for this route</small></div>
    </div>`;

  const composition = section(
    ++n,
    "Where the money goes",
    "Each part of the trip as a share of the total.",
    `<div class="reportPanel"><div class="panelBody">
      <div class="typeLine">${d.categories.filter((c) => c.amount > 0).map((c) => `<span class="typeSeg" style="width:${((c.amount / sum) * 100).toFixed(2)}%;background:${c.hex}"></span>`).join("")}</div>
      <div class="typeLegend">${d.categories
        .filter((c) => c.amount > 0)
        .map((c) => `<div class="typeItem"><span class="dot" style="background:${c.hex}"></span><span class="name">${e(c.label)}</span><span class="pct">${Math.round((c.amount / sum) * 100)}%</span><span class="val">${usd(c.amount)}</span></div>`)
        .join("")}</div>
    </div></div>`
  );

  const lineByLine = section(
    ++n,
    "Line by line",
    "Every cost in the estimate.",
    table(
      ["Cost", "Share", "Amount"],
      [...d.categories.map((c) => [`<strong>${e(c.label)}</strong>`, `${Math.round((c.amount / sum) * 100)}%`, usd(c.amount)]), [`<strong>Estimated total</strong>`, "100%", `<strong>${usd(d.totalAvg)}</strong>`]],
      [1, 2]
    )
  );

  const route = section(
    ++n,
    "Route and seasons",
    "Stops in the order transport is priced, matched to your travel month.",
    table(
      ["#", "Place", "Nights", "Your month", "Best months"],
      d.route.map((s, i) => [String(i + 1), `<strong>${e(s.name)}</strong>`, String(s.nights), e(s.season || "Not set"), e(s.best || "Not recorded")]),
      [2]
    )
  );

  const visa = section(
    ++n,
    "Visa",
    "The rule that applies to your passport.",
    table(["Per adult", "Entry", "Valid for", "Processing"], [[usd(d.visa.perAdult), e(d.visa.entry), e(d.visa.validity), e(d.visa.processing)]], [0])
  );

  const parks = section(
    ++n,
    "Park fees",
    "Official daily tariffs for each park on the route.",
    table(
      ["Park", "Days", "Per adult per day", "Rate", "Extras", "Subtotal"],
      d.parks.map((p) => [`<strong>${e(p.name)}</strong>${p.note ? `<br/><span class="muted">${e(p.note)}</span>` : ""}`, String(p.days), usd(p.rate), e(p.rateType), e(p.extras || "None"), usd(p.subtotal)]),
      [1, 2, 5]
    )
  );

  const transport = section(
    ++n,
    "Transport",
    "Priced leg by leg along your route.",
    table(
      ["From", "To", "How", "Unit price", "Cost"],
      d.legs.map((l) => [e(l.from), e(l.to), `${e(l.how)}${l.note ? `<br/><span class="muted">${e(l.note)}</span>` : ""}`, e(l.unit), l.cost != null ? usd(l.cost) : "Not priced"]),
      [4]
    )
  );

  const activities = d.activities.length
    ? section(
        ++n,
        "Activities",
        "What you chose to do, and what it includes.",
        table(["Activity", "Priced", "Includes", "Cost"], d.activities.map((a) => [`<strong>${e(a.name)}</strong>`, e(a.unit), e(a.includes || "See operator"), usd(a.cost)]), [3])
      )
    : "";

  const stays = section(
    ++n,
    "Accommodation",
    "Estimated per night for each stop at your chosen comfort level.",
    table(["Place", "Nights", "Per adult per night", "Level", "Subtotal"], d.stays.map((s) => [`<strong>${e(s.name)}</strong>`, String(s.nights), usd(s.perNight), e(s.tier), usd(s.subtotal)]), [1, 2, 4])
  );

  const seasonal = d.seasonalRules.length
    ? section(++n, "Seasonal pricing", "Adjustments applied for your travel month.", table(["Season", "Change", "Why"], d.seasonalRules.map((r) => [`<strong>${e(r.name)}</strong>`, e(r.change), e(r.description)])))
    : "";

  const notes = d.notes.length
    ? section(++n, "Know before you book", "Practical points drawn from this estimate.", d.notes.map((t) => `<div class="reportNote">${e(t)}</div>`).join(""))
    : "";

  const freshness = section(
    ++n,
    "Where these numbers come from",
    "Sources: TANAPA official rates, Tanzania Immigration and operator market surveys, maintained by the NoLSAF Research Team.",
    table(["Data", "Last verified"], d.freshness.map((f) => [e(f.label), e(f.value)]))
  );

  const closing = `
    <section class="reportCertification">
      <div class="sectionHead"><span class="sectionNumber">✓</span><div><h2>About this estimate</h2><p>How to use it, and how to check it.</p></div></div>
      <div class="certificationGrid" style="grid-template-columns:112px minmax(0,1fr)">
        <div class="verificationCard">${d.qrDataUrl ? `<img src="${escapeAttr(d.qrDataUrl)}" alt="Scan to open NoLScope" />` : ""}<strong>Plan again</strong><code>${e(d.reference)}</code></div>
        <div class="certificationCopy"><strong>An estimate, not a quote</strong>Prices come from official tariffs and verified operator rates, maintained by the NoLSAF Research Team. Final prices can change with availability, exchange rates and operator pricing at the time of booking. Book verified stays and tours on NoLSAF to lock in prices. Scan the code or visit ${e(d.verifyUrl)} to build a new estimate.</div>
      </div>
      <div class="documentFooter"><span>NoLSAF · NoLScope trip cost estimator</span><span>${e(d.reference)}</span></div>
    </section>`;

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${e(d.reference)} · NoLScope trip estimate</title>
  <style>${adminReportPrintStyles("portrait")}
    /* The eyebrow carries the brand name, so no uppercase transform ("NoLScope", not "NOLSCOPE") */
    .reportEyebrow { text-transform: none; letter-spacing: .3px; font-size: 9px; }
  </style>
</head>
<body>
  <div class="reportPage">
    <main class="reportDocument">
      ${header}
      ${metrics}
      ${composition}
      ${lineByLine}
      ${route}
      ${visa}
      ${parks}
      ${transport}
      ${activities}
      ${stays}
      ${seasonal}
      ${notes}
      ${freshness}
      ${closing}
    </main>
  </div>
</body>
</html>`;
}
