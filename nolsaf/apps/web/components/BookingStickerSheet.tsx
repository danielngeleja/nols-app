"use client";

/**
 * Printable "Book this place on NoLSAF" sticker (A6 portrait), shared by the
 * owner portal and the Sales Partner portal. The API builds the QR as SVG
 * (lib/propertyBookingSticker.ts), pointing at the public property page with
 * ?src=qr&qr=sticker so the channel report counts walk-in bookings.
 *
 * Printing hides everything on the page except the sticker, whichever portal
 * shell it sits in.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Loader2, Printer } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Sticker = {
  title: string;
  place: string | null;
  rentalMode: "NIGHTLY" | "LONG_STAY";
  url: string;
  qrSvg: string;
};

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; sticker: Sticker };

const COPY = {
  NIGHTLY: { en: "Book your stay here on NoLSAF", sw: "Weka nafasi ya kukaa hapa kupitia NoLSAF" },
  LONG_STAY: { en: "Rent this home on NoLSAF", sw: "Panga nyumba hii kupitia NoLSAF" },
} as const;

const PRINT_CSS = `
  .bks-sheet, .bks-sheet * { box-sizing: border-box; }
  .bks-sticker { width: 105mm; height: 148mm; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  @media print {
    @page { size: A6 portrait; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body * { visibility: hidden !important; }
    .bks-sticker, .bks-sticker * { visibility: visible !important; }
    .bks-sticker { position: fixed; left: 0; top: 0; margin: 0 !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }
  }
`;

export default function BookingStickerSheet({
  endpoint,
  backHref,
  backLabel,
}: {
  /** API path returning { sticker }. Null while the caller is still resolving the property. */
  endpoint: string | null;
  backHref: string;
  backLabel: string;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!endpoint) return;
    let cancelled = false;
    setState({ status: "loading" });
    apiClient
      .get<{ sticker?: Sticker }>(endpoint)
      .then((res) => {
        if (cancelled) return;
        const sticker = res.data?.sticker;
        setState(sticker ? { status: "ready", sticker } : { status: "error", message: "Could not prepare the sticker." });
      })
      .catch((cause: any) => {
        if (cancelled) return;
        setState({ status: "error", message: cause?.response?.data?.error || "Could not prepare the sticker. Please try again." });
      });
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  const copyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked: the link is visible on the page to copy by hand.
    }
  };

  const button =
    "inline-flex h-10 items-center gap-2 rounded-md border border-solid px-4 text-sm font-bold transition [font-family:inherit] cursor-pointer";

  return (
    <div className="bks-sheet w-full min-w-0 space-y-5">
      <style>{PRINT_CSS}</style>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="m-0 text-xl font-bold text-slate-950">Booking sticker</h1>
          <p className="m-0 mt-1 max-w-xl text-sm text-slate-600">
            Print it and place it at the reception or entrance. Guests scan it with their phone camera and book on NoLSAF straight away.
          </p>
        </div>
        <Link
          href={backHref}
          className={`${button} border-slate-200 bg-white text-slate-700 no-underline hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800`}
        >
          <ArrowLeft className="h-4 w-4" aria-hidden /> {backLabel}
        </Link>
      </div>

      {state.status === "loading" ? (
        <div className="flex h-[300px] items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-sm text-slate-500" aria-busy="true">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Preparing the sticker
        </div>
      ) : state.status === "error" ? (
        <p className="m-0 rounded-lg border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-5 lg:grid-cols-[auto_minmax(0,1fr)]">
          <div className="overflow-x-auto">
            <StickerFace sticker={state.sticker} />
          </div>

          <div className="min-w-0 space-y-4 rounded-lg border border-solid border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => window.print()} className={`${button} border-[#02665e] bg-[#02665e] text-white hover:bg-[#014d47]`}>
                <Printer className="h-4 w-4" aria-hidden /> Print sticker
              </button>
              <button
                type="button"
                onClick={() => copyLink(state.sticker.url)}
                className={`${button} border-slate-200 bg-white text-slate-700 hover:border-emerald-300 hover:text-emerald-800`}
              >
                {copied ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copied ? "Copied" : "Copy link"}
              </button>
            </div>
            <div>
              <p className="m-0 text-xs font-semibold text-slate-500">The QR opens</p>
              <p className="m-0 mt-1 break-all text-sm text-slate-800">{state.sticker.url}</p>
            </div>
            <ul className="m-0 space-y-1.5 pl-4 text-sm text-slate-600">
              <li>Prints at A6 (105 x 148 mm). Choose &quot;Actual size&quot; in the print window so the code stays sharp.</li>
              <li>Glossy or laminated sticker paper lasts longest at an entrance.</li>
              <li>Test it once with a phone camera before you stick it up.</li>
              <li>Bookings from this code show as QR in NoLSAF reports.</li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

function StickerFace({ sticker }: { sticker: Sticker }) {
  const copy = COPY[sticker.rentalMode] ?? COPY.NIGHTLY;
  return (
    <div className="bks-sticker flex flex-col overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-sm [font-family:inherit]">
      <div className="flex items-center gap-[3mm] bg-[#0b2420] px-[7mm] py-[5mm]">
        <span className="grid h-[11mm] w-[11mm] flex-none place-items-center rounded-[2mm] bg-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/assets/NoLS2025-04.png" alt="" className="h-[8.5mm] w-[8.5mm] object-contain" />
        </span>
        <div className="min-w-0">
          <p className="m-0 text-[15pt] font-bold leading-none text-white">NoLSAF</p>
          <p className="m-0 mt-[1mm] text-[7.5pt] leading-tight text-[#9fd8cc]">Verified stays across Tanzania</p>
        </div>
      </div>

      <div className="flex flex-1 flex-col items-center px-[7mm] pt-[5mm] text-center">
        <p className="m-0 text-[13pt] font-bold leading-tight text-[#0b2420]">{copy.en}</p>
        <p className="m-0 mt-[1mm] text-[9pt] leading-tight text-slate-600">{copy.sw}</p>

        <div className="mt-[5mm] h-[56mm] w-[56mm] rounded-[2mm] border border-solid border-[#d6dfdc] bg-white p-[3mm]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(sticker.qrSvg)}`} alt={`QR code for ${sticker.title} on NoLSAF`} className="block h-full w-full" />
        </div>

        <p className="m-0 mt-[3mm] text-[8.5pt] font-semibold text-[#02665e]">Scan with your phone camera</p>
        <p className="m-0 text-[7.5pt] text-slate-500">Changanua kwa kamera ya simu yako</p>

        <div className="mt-auto w-full border-0 border-t border-solid border-slate-200 py-[4mm]">
          <p className="m-0 truncate text-[10pt] font-bold text-slate-900">{sticker.title}</p>
          {sticker.place ? <p className="m-0 mt-[0.5mm] truncate text-[8pt] text-slate-500">{sticker.place}</p> : null}
          <p className="m-0 mt-[1.5mm] text-[7.5pt] text-slate-500">Pay safely with mobile money or card · nolsaf.com</p>
        </div>
      </div>
    </div>
  );
}
