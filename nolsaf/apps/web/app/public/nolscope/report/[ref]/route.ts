import QRCode from "qrcode";
import { buildEstimatePrintHtml } from "@/lib/nolscopeEstimatePrint";
import { estimatePrintInput, estimateReportPath, parseMonths, type ReportDestination } from "@/lib/nolscopeEstimateReport";
import { escapeAttr, escapeHtml } from "@/utils/html";

/**
 * Shareable printable NoLScope estimate: /public/nolscope/report/es_...
 *
 * Rendered on the server from the saved estimate, on the same document
 * template the estimator prints, so the link a traveller shares (or opens from
 * the mobile app) prints exactly what they calculated. A thin toolbar offers
 * print / save as PDF and is hidden from the printed page.
 */

export const dynamic = "force-dynamic";

const REFERENCE_PATTERN = /^es_[A-Za-z0-9_-]{22}$/;

function apiBase() {
  return String(process.env.API_ORIGIN || process.env.NEXT_PUBLIC_API_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:4000")).replace(/\/$/, "");
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      // A traveller's own trip document: never cached by shared caches or indexed.
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

function messagePage(title: string, body: string, status: number) {
  return htmlResponse(
    `<!doctype html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)} · NoLScope</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#f6f8f8;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;padding:24px;box-sizing:border-box}
  .card{max-width:420px;background:#fff;border:1px solid #dbe5e3;border-radius:16px;padding:28px;text-align:center}
  h1{font-size:20px;margin:0 0 8px}p{margin:0 0 20px;color:#475569;line-height:1.5;font-size:14px}
  a{display:inline-block;background:#02665e;color:#fff;text-decoration:none;font-weight:700;font-size:14px;padding:11px 18px;border-radius:10px}
</style></head><body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(body)}</p><a href="/public/nolscope">Build a new estimate</a></div></body></html>`,
    status
  );
}

function withToolbar(documentHtml: string, nonce: string | null, autoPrint: boolean) {
  const toolbar = `
<style>
  .nsToolbar{position:sticky;top:0;z-index:20;display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between;padding:10px 16px;background:#ffffff;border-bottom:1px solid #dbe5e3;font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
  .nsToolbar strong{font-size:14px;color:#0f172a}.nsToolbar span{display:block;font-size:12px;color:#64748b}
  .nsActions{display:flex;gap:8px;flex-wrap:wrap}
  .nsBtn{appearance:none;border:1px solid #c8e7e4;background:#fff;color:#02665e;font:700 13px system-ui,-apple-system,"Segoe UI",sans-serif;padding:9px 14px;border-radius:10px;cursor:pointer;text-decoration:none}
  .nsBtnPrimary{background:#02665e;border-color:#02665e;color:#fff}
  @media print{.nsToolbar{display:none!important}}
</style>
<div class="nsToolbar" role="toolbar" aria-label="Estimate actions">
  <div><strong>Your NoLScope trip estimate</strong><span>Print it, or choose Save as PDF in the print dialog.</span></div>
  <div class="nsActions">
    <button type="button" class="nsBtn nsBtnPrimary" data-ns-print>Print or save PDF</button>
    <button type="button" class="nsBtn" data-ns-copy>Copy link</button>
    <a class="nsBtn" href="/public/nolscope">New estimate</a>
  </div>
</div>`;
  const script = `
<script${nonce ? ` nonce="${escapeAttr(nonce)}"` : ""}>
(function(){
  var p=document.querySelector("[data-ns-print]");if(p)p.addEventListener("click",function(){window.print();});
  var c=document.querySelector("[data-ns-copy]");if(c)c.addEventListener("click",function(){
    var url=location.origin+location.pathname;
    if(navigator.clipboard){navigator.clipboard.writeText(url).then(function(){c.textContent="Link copied";setTimeout(function(){c.textContent="Copy link";},1800);});}
  });
  ${autoPrint ? `window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});` : ""}
})();
</script>`;
  return documentHtml.replace("<body>", `<body>${toolbar}`).replace("</body>", `${script}</body>`);
}

export async function GET(request: Request, context: { params: Promise<{ ref: string }> }) {
  const { ref } = await context.params;
  const reference = decodeURIComponent(String(ref || "")).trim();
  if (!REFERENCE_PATTERN.test(reference)) {
    return messagePage("Estimate not found", "This estimate link is not valid. Check the link, or build a new estimate.", 404);
  }

  const base = apiBase();
  if (!base) return messagePage("Estimate unavailable", "The estimate service is not reachable right now. Please try again shortly.", 503);

  let estimate: any;
  try {
    const res = await fetch(`${base}/api/public/nolscope/estimate/${encodeURIComponent(reference)}`, { cache: "no-store" });
    if (res.status === 404) return messagePage("Estimate not found", "This estimate link is not valid or the estimate is no longer available.", 404);
    if (!res.ok) throw new Error(`estimate_${res.status}`);
    estimate = await res.json();
  } catch {
    return messagePage("Estimate unavailable", "We could not load this estimate right now. Please try again shortly.", 503);
  }

  if (!estimate?.complete) {
    return messagePage("Build this estimate again", "This estimate was saved before printable reports were available, so it cannot be shown in full. Build it again to get a report you can print and share.", 410);
  }

  const destByCode = new Map<string, ReportDestination>();
  try {
    const res = await fetch(`${base}/api/public/nolscope/destinations`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      for (const r of data?.destinations ?? []) {
        const code = String(r.destinationCode ?? r.code ?? "").toUpperCase();
        if (!code) continue;
        destByCode.set(code, {
          code,
          name: r.displayName ?? r.destinationName ?? r.name ?? code,
          bestMonths: parseMonths(r.bestMonths),
          peakMonths: parseMonths(r.peakMonths),
          offPeakMonths: parseMonths(r.offPeakMonths),
        });
      }
    }
  } catch {
    // Names fall back to tidied codes; the report still prints.
  }

  const requestUrl = new URL(request.url);
  const origin = requestUrl.origin;
  const verifyUrl = new URL(estimateReportPath(reference), origin).toString();
  let qrDataUrl: string | null = null;
  try {
    qrDataUrl = await QRCode.toDataURL(verifyUrl, { errorCorrectionLevel: "M", margin: 0, width: 320, color: { dark: "#073c35", light: "#ffffff" } });
  } catch {
    qrDataUrl = null;
  }

  const html = buildEstimatePrintHtml(
    estimatePrintInput({
      result: estimate,
      route: estimate.route,
      startDate: estimate.startDate ?? null,
      month: estimate.travelMonth ?? (estimate.startDate ? Number(String(estimate.startDate).slice(5, 7)) : null),
      transportPref: estimate.transportPreference ?? "any",
      nationality: estimate.nationality,
      destByCode,
      logoUrl: new URL("/assets/NoLS2025-04.png", origin).toString(),
      verifyUrl,
      qrDataUrl,
      generatedAt: new Date(estimate.generatedAt ?? Date.now()),
    })
  );

  return htmlResponse(withToolbar(html, request.headers.get("x-nonce"), requestUrl.searchParams.get("print") === "1"));
}
