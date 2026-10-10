"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ChevronLeft, Download, Loader2, Printer } from "lucide-react";
import apiClient from "@/lib/apiClient";

/**
 * Owner payout receipt. Shows the one PDF NoLSAF issues for a payout, in the
 * NRMS receipt layout (generateOwnerDisbursementPdf), so the screen, the
 * printout, the download and the emailed copy are the same document.
 */
export default function OwnerPayoutReceiptPage() {
  const params = useParams<{ id?: string | string[] }>();
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (!id) return;
    let objectUrl: string | null = null;
    setUrl(null);
    setError(null);
    apiClient
      .get(`/api/owner/revenue/invoices/${encodeURIComponent(id)}/receipt.pdf`, { responseType: "blob" })
      .then((res) => {
        objectUrl = URL.createObjectURL(new Blob([res.data as BlobPart], { type: "application/pdf" }));
        setUrl(objectUrl);
      })
      .catch((err) => {
        setError(
          err?.response?.status === 404
            ? "This receipt is not available. A receipt is issued once a payout is paid."
            : "The receipt could not be opened. Refresh to try again."
        );
      });
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  const print = () => {
    if (!url) return;
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      if (url) window.open(url, "_blank", "noopener");
    }
  };

  return (
    <div id="owner-payout-receipt" className="w-full min-w-0 space-y-4 px-3 pb-12 sm:px-5 lg:px-6 xl:px-8">
      <style>{`#owner-payout-receipt, #owner-payout-receipt * { box-sizing: border-box; }`}</style>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link href="/owner/payouts/history" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 no-underline hover:text-[#02665e]">
          <ChevronLeft className="h-4 w-4" aria-hidden /> Payout history
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={url ?? undefined}
            download={url ? "nolsaf-payout-receipt.pdf" : undefined}
            aria-disabled={!url}
            className={`inline-flex h-10 items-center gap-2 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50 hover:no-underline ${url ? "" : "pointer-events-none opacity-50"}`}
          >
            <Download className="h-4 w-4" aria-hidden /> Download
          </a>
          {/* aria-disabled, not disabled: the attribute mismatched between the
              server HTML and hydration. print() returns early until ready. */}
          <button
            type="button"
            onClick={print}
            aria-disabled={!url}
            className={`inline-flex h-10 items-center gap-2 rounded-xl border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] ${url ? "" : "cursor-not-allowed opacity-50"}`}
          >
            <Printer className="h-4 w-4" aria-hidden /> Print
          </button>
        </div>
      </div>

      <div className="overflow-hidden rounded-2xl border border-solid border-slate-200 bg-slate-100">
        {error ? (
          <p className="m-0 px-6 py-16 text-center text-sm text-slate-600">{error}</p>
        ) : !url ? (
          <div className="flex items-center justify-center px-6 py-24 text-sm text-slate-500">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Preparing your receipt...
          </div>
        ) : (
          <iframe ref={frame} src={url} title="Payout receipt" className="block h-[80vh] min-h-[640px] w-full border-0 bg-white" />
        )}
      </div>
    </div>
  );
}
