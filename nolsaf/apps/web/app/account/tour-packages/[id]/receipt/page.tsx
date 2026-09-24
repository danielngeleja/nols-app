"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, FileText, Printer } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

/**
 * Tour receipt viewer. The receipt itself is the shared customer receipt
 * template rendered by the API (the same one behind the stay booking receipt),
 * shown in the same document viewer as /account/bookings/[id]/receipt.
 */
export default function TourReceiptPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const tourReference = String(idParam || "");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [receiptHtml, setReceiptHtml] = useState<string>("");
  const viewerFrameRef = useRef<HTMLIFrameElement | null>(null);
  const viewerStageRef = useRef<HTMLDivElement | null>(null);

  const backHref = useMemo(() => `/account/tour-packages/${encodeURIComponent(tourReference)}`, [tourReference]);

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

    const availableWidth = Math.max(280, stage.clientWidth - 32);
    const scale = Math.min(availableWidth / width, 1.12);
    const renderedWidth = Math.ceil(width * scale);
    const renderedHeight = Math.ceil(height * scale);

    doc.documentElement.style.width = `${width}px`;
    doc.documentElement.style.height = `${height}px`;
    doc.documentElement.style.overflow = "hidden";
    Object.assign(doc.body.style, { width: `${width}px`, height: `${height}px`, margin: "0", padding: "0", overflow: "hidden", background: "#ffffff" });

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
  }, [fitReceipt]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const r = await fetch(`/api/customer/tour-bookings/${encodeURIComponent(tourReference)}/receipt.html`, { credentials: "include", cache: "no-store" });
      if (r.status === 409) throw new Error("Your receipt will be available once the payment is confirmed.");
      if (!r.ok) throw new Error(`We could not load this receipt (${r.status}).`);
      setReceiptHtml(await r.text());
    } catch (e: any) {
      setErr(e?.message || "We could not load this receipt.");
      setReceiptHtml("");
    } finally {
      setLoading(false);
    }
  }, [tourReference]);

  const printReceipt = useCallback(() => {
    viewerFrameRef.current?.contentWindow?.focus();
    viewerFrameRef.current?.contentWindow?.print();
  }, []);

  useEffect(() => {
    if (!tourReference) {
      setErr("Invalid trip reference");
      setLoading(false);
      return;
    }
    void load();
  }, [tourReference, load]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="text-center">
          <LogoSpinner size="md" className="mx-auto mb-3" ariaLabel="Loading receipt" />
          <div className="text-sm text-gray-600">Loading receipt…</div>
        </div>
      </div>
    );
  }

  if (err || !receiptHtml) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8">
        <div className="rounded-2xl border border-solid border-gray-200 bg-white p-6">
          <div className="text-sm font-medium text-slate-700">{err || "Receipt not available"}</div>
          <div className="mt-4">
            <Link href={backHref} className="text-[#02665e] underline hover:text-[#014e47]">
              Back to trip
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
            title="Back to trip"
            aria-label="Back to trip"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]">
            <FileText className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="m-0 truncate text-[15px] font-bold text-slate-900 sm:text-[16px]">Tour receipt</h1>
            <p className="m-0 truncate text-[11.5px] text-slate-500">NoLSAF proof of payment</p>
          </div>
        </div>
        <button
          type="button"
          onClick={printReceipt}
          title="Print or save as PDF"
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border-0 bg-[#02665e] px-3.5 text-sm font-semibold text-white transition-colors hover:bg-[#014e47]"
        >
          <Printer className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Print or save PDF</span>
        </button>
      </header>

      <main className="relative min-h-0 flex-1 overflow-auto bg-[#dfe5e4]">
        <div ref={viewerStageRef} className="flex min-h-full w-full items-start justify-center px-3 py-5 sm:px-6 sm:py-7">
          <iframe
            ref={viewerFrameRef}
            title="Tour receipt"
            srcDoc={receiptHtml}
            onLoad={fitReceipt}
            className="block shrink-0 border-0 bg-white shadow-[0_12px_35px_rgba(15,46,43,0.16)]"
          />
        </div>
      </main>
    </div>
  );
}
