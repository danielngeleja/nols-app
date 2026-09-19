"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import { sanitizeTrustedHtml } from "@/utils/html";
import LogoSpinner from "@/components/LogoSpinner";

export default function BookingReceiptPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const bookingReference = String(idParam || "");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string>("");
  const [filename, setFilename] = useState<string>(`Booking-Receipt-${bookingReference}.pdf`);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [pdfGenerating, setPdfGenerating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerFrameRef = useRef<HTMLIFrameElement | null>(null);

  const backHref = useMemo(() => `/account/bookings/${encodeURIComponent(bookingReference)}`, [bookingReference]);

  const sanitizedReceiptHtml = useMemo(() => {
    return sanitizeTrustedHtml(receiptHtml);
  }, [receiptHtml]);

  const fitReceipt = useCallback(() => {
    const frame = viewerFrameRef.current;
    const doc = frame?.contentDocument;
    const sheet = doc?.querySelector(".sheet") as HTMLElement | null;
    if (!frame || !doc?.body || !sheet) return;

    doc.documentElement.style.width = "100%";
    doc.documentElement.style.height = "100%";
    doc.documentElement.style.overflow = "hidden";
    Object.assign(doc.body.style, {
      width: "100%",
      height: "100%",
      margin: "0",
      padding: "0",
      overflow: "hidden",
      background: "transparent",
    });

    sheet.style.position = "absolute";
    sheet.style.left = "50%";
    sheet.style.top = "50%";
    sheet.style.margin = "0";
    sheet.style.transform = "translate(-50%, -50%) scale(1)";
    sheet.style.transformOrigin = "center center";

    const width = sheet.offsetWidth;
    const height = sheet.offsetHeight;
    if (!width || !height) return;
    const scale = Math.min((frame.clientWidth - 24) / width, (frame.clientHeight - 24) / height, 1);
    sheet.style.transform = `translate(-50%, -50%) scale(${Math.max(scale, 0.1)})`;
  }, []);

  useEffect(() => {
    window.addEventListener("resize", fitReceipt);
    return () => window.removeEventListener("resize", fitReceipt);
  }, [fitReceipt]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const url = `/api/customer/bookings/${encodeURIComponent(bookingReference)}/receipt.html`;
      const r = await fetch(url, { credentials: "include", cache: "no-store" });
      const html = await r.text();
      if (!r.ok) {
        throw new Error(`Failed to load receipt (${r.status})`);
      }
      const fn = r.headers.get("x-nolsaf-filename") || `Booking-Receipt-${bookingReference}.pdf`;
      setFilename(fn);
      setReceiptHtml(html);
    } catch (e: any) {
      setErr(e?.message || "Failed to load receipt");
      setReceiptHtml("");
    } finally {
      setLoading(false);
    }
  }, [bookingReference]);

  const printReceipt = useCallback(() => {
    viewerFrameRef.current?.contentWindow?.focus();
    viewerFrameRef.current?.contentWindow?.print();
  }, []);

  useEffect(() => {
    if (!bookingReference) {
      setErr("Invalid booking reference");
      setLoading(false);
      return;
    }
    load();
  }, [bookingReference, load]);

  useEffect(() => {
    let revokedUrl: string | null = null;
    async function gen() {
      if (!sanitizedReceiptHtml) return;
      const root = containerRef.current;
      if (!root) return;

      const el = (root.querySelector(".sheet") as HTMLElement | null) || root;

      setPdfGenerating(true);
      try {
        const html2pdfModule: any = await import("html2pdf.js");
        const h2p = html2pdfModule && (html2pdfModule.default || html2pdfModule);
        if (!h2p) throw new Error("html2pdf load failed");

        const worker = h2p().from(el).set({
          filename,
          margin: 0,
          jsPDF: { unit: "mm", format: "a5", orientation: "portrait" },
          html2canvas: { scale: 2, useCORS: true, logging: false, windowWidth: 558 },
          pagebreak: { mode: [] },
        });

        const pdf = await worker.toPdf().get("pdf");
        const nextUrl = pdf.output("bloburl");
        revokedUrl = nextUrl;
        setPdfUrl(nextUrl);
      } catch (e: any) {
        setPdfUrl(null);
        setErr(e?.message || "Failed to generate PDF");
      } finally {
        setPdfGenerating(false);
      }
    }
    gen();
    return () => {
      if (revokedUrl) {
        try { URL.revokeObjectURL(revokedUrl); } catch {}
      }
    };
  }, [sanitizedReceiptHtml, filename, bookingReference]);

  if (loading) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <div className="text-center">
          <LogoSpinner size="md" className="mx-auto mb-3" ariaLabel="Loading receipt" />
          <div className="text-sm text-gray-600">Loading receipt…</div>
        </div>
      </div>
    );
  }

  if (err || !receiptHtml) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white rounded-2xl border border-gray-200 p-6">
          <div className="text-sm text-red-600 font-medium">{err || "Receipt not available"}</div>
          <div className="mt-4">
            <Link href={backHref} className="text-[#02665e] hover:text-[#014e47] underline">
              ← Back
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#eef2f1]">
      <header className="flex h-16 flex-shrink-0 items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 bg-white px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
        <Link
          href={backHref}
          className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-700 no-underline transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e]"
          title="Back to booking"
          aria-label="Back to booking"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
        </Link>
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-[15px] font-bold text-slate-900 sm:text-[16px]">Booking receipt</h1>
            <p className="m-0 truncate text-[11.5px] text-slate-500">NoLSAF proof of reservation</p>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={printReceipt}
            title="Print receipt"
            aria-label="Print receipt"
            className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-700 transition-colors hover:border-[#02665e]/40 hover:text-[#02665e]"
          >
            <Printer className="h-4 w-4" aria-hidden />
          </button>
        <a
          href={pdfUrl || "#"}
          download={filename}
          className={`inline-flex h-10 items-center gap-2 rounded-lg px-3.5 text-sm font-semibold text-white no-underline transition-colors ${
            pdfUrl ? "bg-[#02665e] hover:bg-[#014e47]" : "cursor-not-allowed bg-slate-300"
          }`}
          onClick={(e) => { if (!pdfUrl) e.preventDefault(); }}
          title={pdfUrl ? "Download PDF" : "Generating PDF…"}
        >
          <Download className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Download PDF</span>
        </a>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 p-2 sm:p-4">
        {pdfGenerating ? (
          <div className="absolute right-4 top-4 z-10 inline-flex items-center gap-2 rounded-lg border border-solid border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-sm">
            <LogoSpinner size="xs" className="h-4 w-4" ariaLabel="Generating PDF" />
            Preparing download
          </div>
        ) : null}
        <iframe
          ref={viewerFrameRef}
          title="Booking receipt"
          srcDoc={sanitizedReceiptHtml}
          onLoad={fitReceipt}
          className="block h-full w-full rounded-lg border-0 bg-transparent"
        />
      </main>

      {/* Hidden source HTML for PDF generation */}
      <div className="fixed left-[-10000px] top-0" aria-hidden>
        <div ref={containerRef} dangerouslySetInnerHTML={{ __html: sanitizedReceiptHtml }} />
      </div>
    </div>
  );
}
