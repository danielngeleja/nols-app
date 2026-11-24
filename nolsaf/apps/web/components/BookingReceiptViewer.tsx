"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Download, FileText, Printer } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

export default function BookingReceiptViewer({ reference, backHref, apiBase, title = "Booking receipt", subtitle = "NoLSAF proof of reservation" }: {
  reference: string;
  backHref: string;
  apiBase: string;
  title?: string;
  subtitle?: string;
}) {
  const fallbackFilename = `Booking-Receipt-${reference}.pdf`;
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string>("");
  const [filename, setFilename] = useState(fallbackFilename);
  const viewerFrameRef = useRef<HTMLIFrameElement | null>(null);
  const viewerStageRef = useRef<HTMLDivElement | null>(null);

  const pdfHref = `${apiBase}/pdf`;

  const fitReceipt = useCallback(() => {
    const frame = viewerFrameRef.current;
    const stage = viewerStageRef.current;
    const doc = frame?.contentDocument;
    const sheet = doc?.querySelector(".sheet") as HTMLElement | null;
    if (!frame || !stage || !doc?.body || !sheet) return;

    sheet.style.position = "absolute";
    sheet.style.left = "0";
    sheet.style.top = "0";
    sheet.style.margin = "0";
    sheet.style.transform = "scale(1)";
    sheet.style.transformOrigin = "top left";

    const width = sheet.offsetWidth;
    const height = sheet.offsetHeight;
    if (!width || !height) return;

    const availableWidth = Math.max(1, stage.clientWidth - 32);
    const scale = Math.min(availableWidth / width, 1.12);
    const renderedWidth = Math.ceil(width * scale);
    const renderedHeight = Math.ceil(height * scale);

    doc.documentElement.style.width = `${width}px`;
    doc.documentElement.style.height = `${height}px`;
    doc.documentElement.style.overflow = "hidden";
    Object.assign(doc.body.style, {
      width: `${width}px`,
      height: `${height}px`,
      margin: "0",
      padding: "0",
      overflow: "hidden",
      background: "#ffffff",
    });

    sheet.style.transform = `scale(${scale})`;
    frame.style.width = `${renderedWidth}px`;
    frame.style.height = `${renderedHeight}px`;
  }, []);

  useEffect(() => {
    const stage = viewerStageRef.current;
    const observer = stage ? new ResizeObserver(fitReceipt) : null;
    if (stage) observer?.observe(stage);
    window.addEventListener("resize", fitReceipt);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fitReceipt);
    };
  }, [fitReceipt, loading, receiptHtml]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const url = `${apiBase}/receipt.html`;
      const r = await fetch(url, { credentials: "include", cache: "no-store" });
      const html = await r.text();
      if (!r.ok) {
        throw new Error(`Failed to load receipt (${r.status})`);
      }
      const fn = r.headers.get("x-nolsaf-filename") || fallbackFilename;
      setFilename(fn);
      setReceiptHtml(html);
    } catch (e: any) {
      setErr(e?.message || "Failed to load receipt");
      setReceiptHtml("");
    } finally {
      setLoading(false);
    }
  }, [apiBase, fallbackFilename]);

  const printReceipt = useCallback(() => {
    viewerFrameRef.current?.contentWindow?.focus();
    viewerFrameRef.current?.contentWindow?.print();
  }, []);

  useEffect(() => {
    if (!reference) {
      setErr("Invalid booking reference");
      setLoading(false);
      return;
    }
    load();
  }, [reference, load]);

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
            <h1 className="m-0 truncate text-[15px] font-bold text-slate-900 sm:text-[16px]">{title}</h1>
            <p className="m-0 truncate text-[11.5px] text-slate-500">{subtitle}</p>
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
          href={pdfHref}
          download={filename}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#02665e] px-3.5 text-sm font-semibold text-white no-underline transition-colors hover:bg-[#014e47]"
          title="Download PDF"
        >
          <Download className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Download PDF</span>
        </a>
        </div>
      </header>

      <main className="relative min-h-0 flex-1 overflow-auto bg-[#dfe5e4]">
        <div ref={viewerStageRef} className="flex min-h-full w-full items-start justify-center px-3 py-5 sm:px-6 sm:py-7">
          <iframe
            ref={viewerFrameRef}
            title={title}
            srcDoc={receiptHtml}
            onLoad={fitReceipt}
            className="block shrink-0 border-0 bg-white shadow-[0_12px_35px_rgba(15,46,43,0.16)]"
          />
        </div>
      </main>
    </div>
  );
}
