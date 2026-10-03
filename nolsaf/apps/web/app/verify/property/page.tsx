"use client";

// Public property certificate (no login required). Rendered as an NRMS
// document on a fixed A5 sheet (507px content inside 7mm print margins), using
// the NRMS report language: cover with reference barcode, uppercase meta
// labels, numbered sections, control checks, verification card and footer.
// On narrow screens the whole sheet scales down like a PDF viewer instead of
// reflowing, and it prints on one A5 page.

import { useEffect, useState } from "react";
import { Loader2, Printer } from "lucide-react";
import BrandMark from "@/components/BrandMark";

type Certificate = {
  issuer: string;
  property: {
    id: number;
    title: string;
    type: string;
    location: string;
  };
  verification: {
    status: "VERIFIED";
    verifiedAt: string | null;
    verifiedBy: string;
    verifiedByRole: string;
    method: string;
    note: string;
    checklist: string[];
    lastRefreshedAt: string | null;
  };
};

type State =
  | { status: "loading" }
  | { status: "valid"; certificate: Certificate }
  | { status: "invalid"; reason: string };

/** A5 at 96dpi: 148mm x 210mm. */
const SHEET_WIDTH = 559;
const SHEET_HEIGHT = 794;
/** Content width inside the 7mm page margins. */
const CONTENT_WIDTH = 507;
/** Printable A5 height inside the 7mm page margins, with a little slack. */
const PRINT_HEIGHT = 730;

function verificationEndpoint(token: string) {
  return `/api/public/properties/verification?token=${encodeURIComponent(token)}`;
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return date.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "2-digit", timeZone: "Africa/Dar_es_Salaam" });
}

function formatDateTime(value: Date) {
  const formatted = new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  }).format(value);
  return `${formatted} EAT`;
}

function formatType(value?: string | null) {
  const raw = String(value || "").trim();
  if (!raw) return "Property";
  return raw
    .toLowerCase()
    .split(/[_\s]+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Listings are often typed in capitals ("HOLLAND HOTEL", "MURUKI, BABATI CBD").
 * Shouting words become Title Case; short ones like "CBD" stay as acronyms
 * unless `allWords` is set (property names).
 */
function softenCaps(value: string, allWords = false) {
  return value.replace(/[A-Za-z][A-Za-z'’]*/g, (word) => {
    if (word !== word.toUpperCase() || word.length < 2) return word;
    if (!allWords && word.length <= 3) return word;
    return word.charAt(0) + word.slice(1).toLowerCase();
  });
}

/** Scales the fixed A5 sheet to fit narrow screens, like a PDF viewer. */
function useSheetScale() {
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerWidth - 16) / SHEET_WIDTH));
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, []);
  return scale;
}

/**
 * Keeps the printout to one A5 page: before printing, measure the document at
 * its true size and shrink it only if a long checklist or note would spill over.
 */
function useOnePagePrint(scale: number) {
  useEffect(() => {
    const root = document.documentElement;
    const before = () => {
      const doc = document.querySelector<HTMLElement>(".nrms-cert");
      if (!doc) return;
      const height = doc.getBoundingClientRect().height / (scale || 1);
      root.style.setProperty("--cert-print-zoom", String(Math.min(1, PRINT_HEIGHT / height)));
    };
    const after = () => root.style.removeProperty("--cert-print-zoom");
    window.addEventListener("beforeprint", before);
    window.addEventListener("afterprint", after);
    return () => {
      window.removeEventListener("beforeprint", before);
      window.removeEventListener("afterprint", after);
      after();
    };
  }, [scale]);
}

// Type sizes and colours follow the NRMS report document (owner/nrms/reports);
// spacing is tightened so the certificate sits on one A5 page.
const DOC_CSS = `
  .cert-page { min-height: 100vh; padding: 18px 8px 40px; background: #eef2f0; }
  .cert-page *, .cert-page *::before, .cert-page *::after { box-sizing: border-box; }
  .cert-stage { width: ${SHEET_WIDTH}px; margin: 0 auto; }
  .cert-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 12px; color: #56615d; font-family: "Trebuchet MS", Arial, sans-serif; font-size: 12px; }
  .cert-print { display: inline-flex; align-items: center; gap: 6px; padding: 7px 13px; border: 1px solid #d6dfdc; border-radius: 6px; background: #fff; color: #073c35; font: inherit; font-size: 12px; font-weight: 800; cursor: pointer; }
  .cert-print:hover { background: #f5faf8; }
  .cert-sheet { display: flex; min-height: ${SHEET_HEIGHT}px; flex-direction: column; padding: 26px; background: #fff; box-shadow: 0 24px 70px rgba(7, 60, 53, .14); }

  .nrms-cert { display: flex; flex: 1; flex-direction: column; width: ${CONTENT_WIDTH}px; color: #171717; font-family: "Trebuchet MS", Arial, sans-serif; font-size: 9.5px; line-height: 1.45; text-rendering: optimizeLegibility; -webkit-font-smoothing: antialiased; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  .nrms-cert h1, .nrms-cert h2, .nrms-cert h3, .nrms-cert p, .nrms-cert dl, .nrms-cert dd { margin: 0; }

  .pdf-cover { overflow: hidden; border: 1px solid #d6dfdc; border-radius: 7px; background: #fff; }
  /* Masthead: NoLSAF identity on the left, receipt-style barcode on the right. */
  .pdf-masthead { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 13px 16px 12px; border-bottom: 1.5px solid #02665e; }
  .pdf-brand { display: flex; min-width: 0; align-items: center; gap: 10px; }
  .pdf-brand svg { display: block; flex: none; }
  .pdf-wordmark { color: #02665e; font-size: 21px; font-weight: 900; letter-spacing: -.3px; line-height: 1; }
  .pdf-company { margin-top: 4px !important; color: #213e38; font-size: 9px; font-weight: 700; }
  .pdf-tagline { margin-top: 1px !important; color: #687c75; font-size: 7.5px; font-style: italic; }
  .pdf-barcode-block { display: flex; flex: none; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
  .pdf-barcode-label { color: #51716a; font-size: 7px; font-weight: 800; letter-spacing: .8px; text-transform: uppercase; }
  .pdf-report-number { color: #0f1f1c; font-family: Consolas, "Courier New", monospace; font-size: 8.5px; font-weight: 700; letter-spacing: 2.2px; white-space: nowrap; }
  .pdf-barcode { display: block; max-width: none; height: 36px; min-width: 150px; background: #fff; }

  /* Title band: what the document is and who it is for. */
  .pdf-title-band { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; padding: 11px 16px 10px; background: linear-gradient(180deg, #ffffff 0%, #f7fbf9 100%); color: #17201e; }
  .pdf-kicker { color: #00785a; font-size: 7.5px; font-weight: 800; letter-spacing: 1.6px; text-transform: uppercase; }
  .pdf-cover h1 { margin-top: 2px; font-size: 17px; line-height: 1.15; letter-spacing: -.3px; }
  .pdf-title-property { min-width: 0; text-align: right; }
  .pdf-title-property strong { display: block; color: #17201e; font-size: 12px; overflow-wrap: anywhere; }
  .pdf-title-property .pdf-state { display: inline-block; margin-top: 3px; }
  .pdf-state { flex: none; border-radius: 4px; padding: 2px 7px; background: #dff7ed; color: #006b4f; font-size: 7px; font-weight: 900; letter-spacing: .55px; text-transform: uppercase; }
  .pdf-state-failed { background: #ffe2e2; color: #a61b1b; }
  .pdf-meta { display: grid; grid-template-columns: repeat(3, 1fr); background: #f5faf8; border-top: 1px solid #dfeae6; }
  .pdf-meta div { min-width: 0; padding: 8px 12px; border-right: 1px solid #dfeae6; border-top: 1px solid #dfeae6; }
  .pdf-meta div:nth-child(-n+3) { border-top: 0; }
  .pdf-meta div:nth-child(3n) { border-right: 0; }
  .pdf-meta dt, .pdf-sign-label, .pdf-seal p { display: block; color: #56625e; font-size: 7px; font-weight: 800; letter-spacing: .65px; text-transform: uppercase; }
  .pdf-meta dd { display: block; margin-top: 2px; color: #111816; font-size: 9.5px; font-weight: 800; overflow-wrap: anywhere; }
  .pdf-meta .ok { color: #00785a; }

  .pdf-section { margin-top: 12px; }
  .pdf-section-title { display: flex; align-items: flex-start; gap: 9px; margin-bottom: 7px; padding-bottom: 5px; border-bottom: 2px solid #073c35; }
  .pdf-section-title > span { display: grid; width: 22px; height: 22px; flex: none; place-items: center; border-radius: 5px; background: #073c35; color: #fff; font-size: 8.5px; font-weight: 800; }
  .pdf-section-title h2 { font-size: 12px; line-height: 1.2; }
  .pdf-section-title p { margin-top: 1px; color: #505a57; font-size: 8px; }

  .pdf-panel { overflow: hidden; border: 1px solid #e4e7e6; border-radius: 6px; }
  .pdf-panel-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 11px; background: #f5f7f6; }
  .pdf-panel-head strong { display: block; font-size: 9.5px; }
  .pdf-panel-head p { margin-top: 1px; color: #56615d; font-size: 7.8px; }
  .pdf-control-check { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 5px 11px; border-top: 1px solid #edf0ef; }
  .pdf-control-check:first-child { border-top: 0; }
  .pdf-control-check span { color: #4e5855; }
  .pdf-control-check b { color: #00785a; font-size: 7px; text-transform: uppercase; }

  .pdf-disclaimer-row { display: grid; grid-template-columns: minmax(0, 1fr) 110px; gap: 10px; align-items: stretch; }
  .pdf-disclaimer { padding: 11px 13px; border: 1px solid #e4dfc4; border-radius: 6px; background: #fffbed; color: #5f5739; font-size: 8.3px; line-height: 1.55; }
  .pdf-disclaimer h3 { margin: 0 0 4px; color: #574a17; font-size: 9.5px; }
  .pdf-disclaimer p + p { margin-top: 5px; }
  .pdf-verification-card { display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 8px; border: 1px solid #dce5e2; border-radius: 6px; background: #fff; text-align: center; }
  .pdf-qr { display: block; width: 64px; height: 64px; padding: 3px; border: 1px solid #d7e2de; border-radius: 4px; background: #fff; }
  .pdf-verification-card strong { margin-top: 6px; color: #073c35; font-size: 7.5px; text-transform: uppercase; }
  .pdf-verification-card p { margin-top: 2px; color: #6f7c78; font-size: 6.8px; line-height: 1.35; }

  .pdf-signoff { display: grid; grid-template-columns: 60px 1fr 1fr; gap: 18px; align-items: end; margin-top: 10px; padding: 8px 16px 10px; border: 1px solid #e1e6e4; border-radius: 6px; }
  .pdf-seal { text-align: center; }
  .pdf-seal svg { display: block; width: 44px; height: 44px; margin: 0 auto; }
  .pdf-seal p { margin-top: 4px !important; }
  .pdf-sign-name { color: #073c35; font-size: 12px; font-style: italic; font-weight: 700; overflow-wrap: anywhere; }
  .pdf-sign-line { height: 1px; margin-top: 5px; background: #8d9693; }
  .pdf-sign-label { margin-top: 3px !important; }

  .pdf-footer { display: flex; justify-content: space-between; gap: 16px; margin-top: auto; padding-top: 8px; border-top: 1px solid #dfe4e2; color: #56615d; font-size: 7px; }
  .pdf-footer strong { text-align: right; }
  .pdf-footer-spacer { height: 8px; flex: none; }
  .cert-loading { display: flex; flex: 1; flex-direction: column; align-items: center; justify-content: center; gap: 10px; color: #56615d; font-size: 11px; }

  @media print {
    @page { size: A5 portrait; margin: 7mm; }
    /* Print the certificate alone: no site chrome, cookie banner, mobile nav
       or full-height wrappers that would push it onto a second page. */
    html, body { height: auto !important; margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body > *:not(:has(.cert-page)) { display: none !important; }
    body > div:has(.cert-page) { min-height: 0 !important; padding: 0 !important; background: #fff !important; }
    .cert-page { min-height: 0; padding: 0; background: #fff; }
    .cert-stage { width: ${CONTENT_WIDTH}px; margin: 0; zoom: var(--cert-print-zoom, 1) !important; }
    .cert-toolbar { display: none; }
    /* Fill the page so the footer sits at the bottom like the NRMS documents. */
    .cert-sheet { min-height: ${PRINT_HEIGHT}px; padding: 0; box-shadow: none; }
    .nrms-cert { break-inside: avoid; page-break-inside: avoid; }
    /* Keep the green tiles, badges and panels even when the browser's
       "Background graphics" option is off. */
    .cert-page, .cert-page * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
  }
`;

export default function PropertyVerificationPage() {
  const [state, setState] = useState<State>({ status: "loading" });
  const scale = useSheetScale();
  useOnePagePrint(scale);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = (params.get("t") || params.get("token") || "").trim();
    if (!token) {
      setState({ status: "invalid", reason: "No property verification token was provided." });
      return;
    }

    let alive = true;
    fetch(verificationEndpoint(token), { credentials: "same-origin" })
      .then(async (res) => {
        const data = await res.json().catch(() => null);
        if (!alive) return;
        if (data?.ok && data?.valid && data?.certificate) {
          setState({ status: "valid", certificate: data.certificate as Certificate });
        } else {
          setState({
            status: "invalid",
            reason: "This property certificate could not be verified. The link may be altered, expired, or the property is no longer publicly approved.",
          });
        }
      })
      .catch(() => {
        if (!alive) return;
        setState({ status: "invalid", reason: "We could not reach the verification service. Please try again." });
      });

    return () => {
      alive = false;
    };
  }, []);

  return (
    <main className="cert-page">
      <style>{DOC_CSS}</style>
      <div className="cert-stage" style={{ zoom: scale }}>
        <div className="cert-toolbar">
          <span>Official NoLSAF document</span>
          {state.status === "valid" ? (
            <button type="button" className="cert-print" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" aria-hidden />
              Print or save PDF
            </button>
          ) : null}
        </div>
        <div className="cert-sheet">
          {state.status === "loading" ? (
            <div className="nrms-cert">
              <div className="cert-loading">
                <Loader2 className="h-6 w-6 animate-spin" style={{ color: "#073c35" }} aria-hidden />
                <span>Verifying property certificate</span>
              </div>
            </div>
          ) : state.status === "invalid" ? (
            <InvalidView reason={state.reason} />
          ) : (
            <ValidView certificate={state.certificate} />
          )}
        </div>
      </div>
    </main>
  );
}

function InvalidView({ reason }: { reason: string }) {
  return (
    <article className="nrms-cert" aria-label="Certificate could not be verified">
      <header className="pdf-cover">
        <Masthead>
          <span className="pdf-state pdf-state-failed">Not verified</span>
        </Masthead>
        <div className="pdf-title-band">
          <div>
            <p className="pdf-kicker">Property verification</p>
            <h1>Certificate could not be verified</h1>
          </div>
        </div>
      </header>
      <section className="pdf-section">
        <div className="pdf-panel">
          <div className="pdf-panel-head">
            <div>
              <strong>Not a valid NoLSAF certificate</strong>
              <p>{reason}</p>
            </div>
          </div>
        </div>
      </section>
      <div className="pdf-footer-spacer" />
      <footer className="pdf-footer">
        <span>No login is required to view this page.</span>
        <strong>NoLS Africa Co Ltd</strong>
      </footer>
    </article>
  );
}

/** NoLSAF identity block, as on the NRMS payment receipt. */
function Masthead({ children }: { children: React.ReactNode }) {
  return (
    <div className="pdf-masthead">
      <div className="pdf-brand">
        <BrandMark size={38} />
        <div>
          <p className="pdf-wordmark">NoLSAF</p>
          <p className="pdf-company">NoLS Africa Co Ltd</p>
          <p className="pdf-tagline">Quality Stay For Every Wallet</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Seal() {
  const bumps = Array.from({ length: 16 }, (_, i) => {
    const a = (i * Math.PI) / 8;
    return { cx: 100 + 58 * Math.cos(a), cy: 100 + 58 * Math.sin(a) };
  });
  return (
    <svg viewBox="0 0 200 200" role="img" aria-label="Verified seal">
      <g fill="#073c35">
        {bumps.map((b, i) => (
          <circle key={i} cx={b.cx} cy={b.cy} r="9" />
        ))}
      </g>
      <circle cx="100" cy="100" r="60" fill="#02665e" />
      <circle cx="100" cy="100" r="49" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
      <path d="M100 76 L122 86 L122 104 C122 122 112 130 100 136 C88 130 78 122 78 104 L78 86 Z" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinejoin="round" />
      <polyline points="91,101 98,109 111,93" fill="none" stroke="#ffffff" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ValidView({ certificate }: { certificate: Certificate }) {
  const { property, verification } = certificate;
  const certId = `NLS-P-${property.id}`;
  const title = softenCaps(property.title, true);
  const location = property.location ? softenCaps(property.location) : "Location not listed";
  const checklist = (verification.checklist || []).filter(Boolean);
  const verifiedBy = verification.verifiedBy || "NoLSAF Admin";
  const verifiedOn = formatDate(verification.verifiedAt);

  const [checkedAt] = useState(() => formatDateTime(new Date()));
  const [codes, setCodes] = useState<{ qr: string | null; bars: { src: string; width: number } | null }>({ qr: null, bars: null });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [qrModule, barcodeModule] = await Promise.all([import("qrcode"), import("jsbarcode")]);
        const toDataUrl = qrModule.toDataURL ?? qrModule.default?.toDataURL;
        const qr = await toDataUrl(window.location.href, { margin: 1, width: 220, errorCorrectionLevel: "M", color: { dark: "#073c35", light: "#ffffff" } });
        // Vector bars shown at their natural width (never stretched), like the
        // NRMS receipt barcode, so they stay thin, even and scannable.
        const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        barcodeModule.default(svg, certId, { format: "CODE128", width: 1.5, height: 44, displayValue: false, margin: 0, background: "#ffffff", lineColor: "#0f1f1c" });
        const width = Math.round(parseFloat(svg.getAttribute("width") || "0")) || 180;
        if (!svg.getAttribute("viewBox")) svg.setAttribute("viewBox", `0 0 ${svg.getAttribute("width")} ${svg.getAttribute("height")}`);
        svg.setAttribute("shape-rendering", "crispEdges");
        const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(svg))}`;
        if (alive) setCodes({ qr, bars: { src, width } });
      } catch {
        /* codes are a convenience; the certificate still reads without them */
      }
    })();
    return () => {
      alive = false;
    };
  }, [certId]);

  return (
    <article className="nrms-cert" aria-label={`Certificate of verification for ${title}`}>
      <header className="pdf-cover">
        <Masthead>
          {/* Receipt-style barcode block: label, bars at natural proportions, reference. */}
          <div className="pdf-barcode-block">
            <span className="pdf-barcode-label">Verification certificate</span>
            {codes.bars ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pdf-barcode" src={codes.bars.src} width={codes.bars.width} alt={`Barcode ${certId}`} />
            ) : (
              <div className="pdf-barcode" />
            )}
            <span className="pdf-report-number">{certId}</span>
          </div>
        </Masthead>
        <div className="pdf-title-band">
          <div>
            <p className="pdf-kicker">Property verification</p>
            <h1>Certificate of verification</h1>
          </div>
          <div className="pdf-title-property">
            <strong>{title}</strong>
            <span className="pdf-state">Verified</span>
          </div>
        </div>
        <dl className="pdf-meta">
          <div><dt>Verified on</dt><dd>{verifiedOn}</dd></div>
          <div><dt>Verified by</dt><dd>{verifiedBy}</dd></div>
          <div><dt>Property type</dt><dd>{formatType(property.type)}</dd></div>
          <div><dt>Location</dt><dd>{location}</dd></div>
          <div><dt>Method</dt><dd>{verification.method || "Site visit and listing review"}</dd></div>
          <div><dt>Checked</dt><dd>{checkedAt}</dd></div>
        </dl>
      </header>

      <section className="pdf-section">
        <div className="pdf-section-title">
          <span>01</span>
          <div>
            <h2>Verification result</h2>
            <p>Approved to host guests on NoLSAF. Checked against NoLSAF records just now and active.</p>
          </div>
        </div>
        <div className="pdf-panel">
          {checklist.map((item) => (
            <div className="pdf-control-check" key={item}>
              <span>{item}</span>
              <b>Pass</b>
            </div>
          ))}
        </div>
      </section>

      <section className="pdf-section">
        <div className="pdf-section-title">
          <span>02</span>
          <div>
            <h2>Certification</h2>
            <p>Issuer, reference and how to confirm this document.</p>
          </div>
        </div>
        <div className="pdf-disclaimer-row">
          <div className="pdf-disclaimer">
            <h3>About this certificate</h3>
            <p>{verification.note || "This stay is listed publicly only after NoLSAF verification and approval."}</p>
            <p>It confirms the listing was verified by NoLSAF. It is not a business licence, tax clearance or safety inspection. Always confirm a printed copy by scanning the QR code.</p>
          </div>
          <aside className="pdf-verification-card">
            {codes.qr ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="pdf-qr" src={codes.qr} alt="Certificate verification QR code" />
            ) : (
              <div className="pdf-qr" />
            )}
            <strong>Verify certificate</strong>
            <p>Scan to confirm it is genuine and still active.</p>
          </aside>
        </div>
      </section>

      <section className="pdf-signoff" aria-label="Sign-off">
        <div className="pdf-seal">
          <Seal />
          <p>Official seal</p>
        </div>
        <div className="pdf-sign">
          <p className="pdf-sign-name">{verifiedBy}</p>
          <div className="pdf-sign-line" />
          <p className="pdf-sign-label">Verified by</p>
        </div>
        <div className="pdf-sign">
          <p className="pdf-sign-name">{verifiedOn}</p>
          <div className="pdf-sign-line" />
          <p className="pdf-sign-label">Date of verification</p>
        </div>
      </section>

      <div className="pdf-footer-spacer" />
      <footer className="pdf-footer">
        <span>Issued by {certificate.issuer}. No login is required to view this page.</span>
        <strong>{title} · {certId}</strong>
      </footer>
    </article>
  );
}
