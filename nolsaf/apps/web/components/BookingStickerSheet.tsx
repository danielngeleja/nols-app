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
import { createPortal } from "react-dom";
import Link from "next/link";
import { ArrowLeft, Check, Copy, Globe, Loader2, MapPin, Printer } from "lucide-react";
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

/** The call to action, three short lines on the green half. */
const CALL: Record<Sticker["rentalMode"], [string, string, string]> = {
  NIGHTLY: ["Book, Pay", "this property", "via NoLSAF"],
  LONG_STAY: ["Rent, Pay", "this home", "via NoLSAF"],
};

const BRAND = "#02665e";
const BRAND_DARK = "#014d47";

const PRINT_CSS = `
  .bks-sticker-frame { container-type: inline-size; }
  .bks-sticker {
    --bks-mm: calc(100cqw / 95);
    width: 100%; aspect-ratio: 1; box-sizing: border-box;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .bks-print { display: none; }
  @media print {
    @page booking-sticker { size: 105mm 148mm; margin: 0; }
    html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
    body > :not(.bks-print) { display: none !important; }
    .bks-print {
      page: booking-sticker;
      display: grid; justify-items: center;
      width: 105mm; padding-top: 26.5mm;
    }
    /* The shared invoice print styles hide all body descendants. */
    .bks-print, .bks-print * { visibility: visible; }
    .bks-print .bks-sticker {
      --bks-mm: 1mm;
      width: 95mm; height: 95mm;
    }
  }
`;

const stickerMm = (value: number) => `calc(${value} * var(--bks-mm))`;
const stickerPt = (value: number) => stickerMm(value * 25.4 / 72);

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
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

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
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  const actionClass = "inline-flex min-h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-solid px-4 py-2.5 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#02665e] [font-family:inherit]";

  return (
    <div className="mx-auto w-full min-w-0 max-w-6xl px-4 py-5 sm:px-6 sm:py-7">
      <style>{PRINT_CSS}</style>

      <header className="mb-4 sm:mb-5">
        <div className="min-w-0">
          <Link href={backHref} className="mb-1 inline-flex min-h-8 items-center gap-1.5 text-sm font-medium text-[#24665b] no-underline hover:underline">
            <ArrowLeft className="h-4 w-4" aria-hidden /> {backLabel}
          </Link>
          <h1 className="m-0 text-3xl font-semibold tracking-tight text-slate-950">Booking sticker</h1>
        </div>
      </header>

      {state.status === "loading" ? (
        <div className="flex h-[300px] items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-sm text-slate-500" aria-busy="true">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> Preparing the sticker
        </div>
      ) : state.status === "error" ? (
        <p className="m-0 rounded-lg border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">{state.message}</p>
      ) : (
        <>
          <section aria-label="Booking sticker workspace" className="grid min-w-0 overflow-hidden rounded-lg border border-solid border-[#dce5df] bg-white md:grid-cols-[minmax(0,1fr)_minmax(245px,32%)]">
            <figure aria-label="A6 sticker preview" className="m-0 flex min-w-0 flex-col bg-[#edf2ee]">
              <div className="grid place-items-center bg-[radial-gradient(#cbd8cf_1px,transparent_1px)] bg-[size:16px_16px] px-6 py-7 sm:py-9">
                <div className="grid aspect-[105/148] w-full max-w-[245px] place-items-center bg-white shadow-[0_8px_22px_rgba(22,50,37,0.12)] ring-1 ring-[#dbe4dd]">
                  <div className="bks-sticker-frame w-[90.48%]">
                    <StickerFace sticker={state.sticker} />
                  </div>
                </div>
              </div>
              <figcaption className="flex items-center justify-between gap-3 border-0 border-t border-solid border-[#dce5df] px-4 py-2.5 text-xs text-[#506359]">
                <span className="font-semibold text-[#294a3d]">Print preview</span>
                <span>A6 paper · 95 mm sticker</span>
              </figcaption>
            </figure>

            <div className="flex min-w-0 flex-col border-0 border-t border-solid border-[#dce5df] p-5 md:border-l md:border-t-0 lg:p-6">
              <div>
                <h2 className="m-0 break-words text-xl font-semibold tracking-tight text-[#1d3029]">{state.sticker.title}</h2>
                {state.sticker.place && (
                  <p className="m-0 mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed text-[#52655d]">
                    <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">{state.sticker.place}</span>
                  </p>
                )}
                <p className="m-0 mt-3 text-sm leading-relaxed text-[#52655d]">Guests can scan the QR code to open this property’s booking page.</p>
              </div>

              <div className="mt-4 grid gap-2">
                <button type="button" onClick={() => window.print()} className={`${actionClass} border-[#02665e] bg-[#02665e] text-white hover:bg-[#014d47]`}>
                  <Printer className="h-4 w-4" aria-hidden /> Print sticker
                </button>
                <button type="button" onClick={() => void copyLink(state.sticker.url)} className={`${actionClass} border-[#dbe5df] bg-white text-[#254d41] hover:bg-[#edf4ef]`}>
                  {copyStatus === "copied" ? <Check className="h-4 w-4" aria-hidden /> : <Copy className="h-4 w-4" aria-hidden />} {copyStatus === "copied" ? "Link copied" : "Copy booking link"}
                </button>
                {copyStatus === "failed" && <p role="status" className="m-0 break-all text-xs text-slate-600">{state.sticker.url}</p>}
              </div>

              <div className="mt-5 border-0 border-t border-solid border-[#dce5df] pt-4">
                <h3 className="m-0 text-sm font-semibold text-[#294a3d]">Printing tips</h3>
                <p className="m-0 mt-1 text-sm leading-relaxed text-[#52655d]">Choose <strong>Actual size</strong>, trim along the green ring, and test the QR code with your phone.</p>
              </div>
            </div>
          </section>

          {createPortal(<div className="bks-print"><StickerFace sticker={state.sticker} /></div>, document.body)}
        </>
      )}
    </div>
  );
}

/**
 * The NoLSAF mark from /assets/NoLS2025-04.png, unchanged. The file has wide
 * white margins (the mark is about 44% of its height, centred), so it is drawn
 * larger inside a clipping box instead of being shrunk with its margins.
 */
function BrandMark({ width, height, markHeight }: { width: number; height: number; markHeight: number }) {
  const size = stickerMm(markHeight / 0.445);
  return (
    <span className="relative block flex-none overflow-hidden" style={{ width: stickerMm(width), height: stickerMm(height) }} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/assets/NoLS2025-04.png"
        alt=""
        className="absolute block"
        style={{ width: size, height: size, maxWidth: "none", left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
      />
    </span>
  );
}

/**
 * The round sticker: white top with the wordmark and "Available via NoLSAF"
 * beside the mark, a brand-green bottom with the call to action and the QR in
 * a white disc, the NoLSAF mark at its centre (the QR uses high error
 * correction so the covered modules still scan).
 */
function StickerFace({ sticker }: { sticker: Sticker }) {
  const [l1, l2, l3] = CALL[sticker.rentalMode] ?? CALL.NIGHTLY;
  const qrSrc = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sticker.qrSvg)}`;
  return (
    <div
      className="bks-sticker relative overflow-hidden rounded-full bg-white [font-family:inherit]"
      style={{ border: `${stickerMm(2.2)} solid ${BRAND}` }}
      role="img"
      aria-label={`NoLSAF sticker for ${sticker.title}: scan to book and pay this property via NoLSAF`}
    >
      {/* Top, white */}
      <div className="absolute inset-x-0 top-0 flex flex-col items-center" style={{ height: stickerMm(46), paddingTop: stickerMm(8) }}>
        <p className="m-0 leading-none" style={{ color: BRAND, fontSize: stickerPt(21), fontWeight: 500, letterSpacing: stickerMm(0.6) }}>NoLSAF</p>
        <div className="flex items-center" style={{ marginTop: stickerMm(2.2), gap: stickerMm(1) }} aria-hidden>
          <span style={{ width: stickerMm(18), height: stickerMm(0.35), background: BRAND }} />
          <span style={{ width: stickerMm(2.5), height: stickerMm(0.35), background: BRAND }} />
          <span style={{ width: stickerMm(18), height: stickerMm(0.35), background: BRAND }} />
        </div>
        <div className="flex items-center" style={{ marginTop: stickerMm(3.5), gap: stickerMm(3.5) }}>
          <BrandMark width={17.5} height={20} markHeight={20} />
          <span aria-hidden style={{ width: stickerMm(0.35), height: stickerMm(17), background: BRAND }} />
          <div className="flex flex-col">
            <span style={{ color: BRAND_DARK, fontSize: stickerPt(10.5), fontWeight: 700, lineHeight: 1.1 }}>Available via</span>
            <span style={{ color: BRAND, fontSize: stickerPt(19), fontWeight: 500, letterSpacing: stickerMm(0.4), lineHeight: 1.1 }}>NoLSAF</span>
          </div>
        </div>
      </div>

      {/* Bottom, brand green */}
      <div className="absolute inset-x-0 bottom-0" style={{ top: stickerMm(46), background: BRAND }}>
        <div className="flex items-center justify-between" style={{ padding: `${stickerMm(4.5)} ${stickerMm(7)} 0 ${stickerMm(9)}` }}>
          <p className="m-0 text-white" style={{ fontSize: stickerPt(14), fontWeight: 700, lineHeight: 1.12 }}>
            {l1}<br />{l2}<br />{l3}<span style={{ color: "#5eead4" }}>.</span>
          </p>
          <div className="relative grid flex-none place-items-center rounded-full bg-white" style={{ width: stickerMm(30), height: stickerMm(30), border: `${stickerMm(0.9)} solid #3f9a92` }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={qrSrc} alt="" style={{ width: stickerMm(20.5), height: stickerMm(20.5) }} className="block" />
            <span className="absolute grid place-items-center bg-white" style={{ borderRadius: stickerMm(1), width: stickerMm(5.6), height: stickerMm(5.6), left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}>
              <BrandMark width={4} height={4.6} markHeight={4.6} />
            </span>
          </div>
        </div>
        <div className="flex items-center justify-center text-white" style={{ marginTop: stickerMm(3), gap: stickerMm(2.5) }}>
          <Globe style={{ width: stickerMm(5), height: stickerMm(5) }} aria-hidden />
          <span aria-hidden style={{ width: stickerMm(0.3), height: stickerMm(5), background: "rgba(255,255,255,0.7)" }} />
          <span style={{ fontSize: stickerPt(11), fontWeight: 500 }}>nolsaf.com</span>
        </div>
      </div>
    </div>
  );
}
