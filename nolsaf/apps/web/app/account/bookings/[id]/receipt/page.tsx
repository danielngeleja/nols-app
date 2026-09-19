"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Download } from "lucide-react";
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

  const backHref = useMemo(() => `/account/bookings/${encodeURIComponent(bookingReference)}`, [bookingReference]);

  const sanitizedReceiptHtml = useMemo(() => {
    return sanitizeTrustedHtml(receiptHtml);
  }, [receiptHtml]);

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
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href={backHref}
          className="no-underline inline-flex items-center justify-center w-10 h-10 rounded-xl bg-white border border-gray-200 text-gray-800 shadow-sm hover:shadow-md hover:bg-gray-50 active:scale-[0.99] transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#02665e] focus-visible:ring-offset-2"
          title="Back"
          aria-label="Back"
        >
          <ArrowLeft className="w-4 h-4" />
        </Link>

        <a
          href={pdfUrl || "#"}
          download={filename}
          className={`no-underline inline-flex items-center gap-2 px-4 py-2 rounded-xl text-white transition-all ${
            pdfUrl ? "bg-[#02665e] hover:bg-[#014e47] shadow-sm hover:shadow-md" : "bg-gray-300 cursor-not-allowed"
          }`}
          onClick={(e) => { if (!pdfUrl) e.preventDefault(); }}
          title={pdfUrl ? "Download PDF" : "Generating PDF…"}
        >
          <Download className="w-4 h-4" />
          Download PDF
        </a>
      </div>

      {pdfGenerating && (
        <div className="text-sm text-gray-600 flex items-center gap-2">
          <LogoSpinner size="xs" className="h-4 w-4" ariaLabel="Generating PDF" />
          Generating PDF…
        </div>
      )}

      {pdfUrl ? (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <iframe title="Receipt PDF" src={pdfUrl} className="w-full h-[75vh]" />
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm">
          <iframe title="Receipt Template" srcDoc={sanitizedReceiptHtml} className="w-full h-[75vh]" />
        </div>
      )}

      {/* Hidden source HTML for PDF generation */}
      <div className="fixed left-[-10000px] top-0">
        <div ref={containerRef} dangerouslySetInnerHTML={{ __html: sanitizedReceiptHtml }} />
      </div>
    </div>
  );
}
