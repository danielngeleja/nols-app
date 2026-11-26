"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Ban, CalendarCheck, Check, Clock, Download, FileCheck2, FileLock2, Lock, MapPinned, Printer, ReceiptText, RotateCw, ShieldCheck } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

export default function TourVisaItineraryPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const tourReference = String(idParam || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  // The API's reason when the document cannot be issued (visa_itinerary_not_available, _cancelled, ...).
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // Unpaid: the trip and its open payment link, so the notice can say what is due and pay straight away.
  const [trip, setTrip] = useState<{ title: string; dates: string; travelers: number; amount: string; payUrl: string | null; payExpiresAt: number | null } | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (errorCode !== "visa_itinerary_not_available" || !tourReference) return;
    let alive = true;
    fetch(`/api/customer/tour-bookings/${encodeURIComponent(tourReference)}`, { credentials: "include", cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((item) => {
        if (!alive || !item) return;
        const fmt = (iso?: string) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" }) : "");
        const expires = new Date(item?.paymentResume?.paymentAccessTokenExpiresAt || "").getTime();
        const status = String(item?.paymentResume?.paymentAccessTokenStatus || "").toUpperCase();
        const url = typeof item?.paymentResume?.paymentUrl === "string" ? item.paymentResume.paymentUrl : null;
        setTrip({
          title: String(item.title || item.destination || "Your trip"),
          dates: [fmt(item.startDate), fmt(item.endDate)].filter(Boolean).join(" to "),
          travelers: Number(item.travelerCount || 0),
          amount: item.grossAmount ? `${item.currency || ""} ${Number(item.grossAmount).toLocaleString("en-US")}`.trim() : "",
          payUrl: url && status !== "EXPIRED" && Number.isFinite(expires) && expires > Date.now() ? url : null,
          payExpiresAt: Number.isFinite(expires) ? expires : null,
        });
      })
      .catch(() => undefined);
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [errorCode, tourReference]);
  const [checks, setChecks] = useState<Array<{ key: string; label: string; ok: boolean; detail: string }>>([]);
  const [pdfUrl, setPdfUrl] = useState("");
  const [fileName, setFileName] = useState("Visa Itinerary.pdf");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  // Phones (Android Chrome and others) cannot show a PDF inside a page.
  const [inlineViewer, setInlineViewer] = useState(true);
  useEffect(() => {
    const flag = (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled;
    if (flag === false) setInlineViewer(false);
  }, []);

  const backHref = useMemo(() => `/account/tour-packages/${encodeURIComponent(tourReference)}`, [tourReference]);

  // Release the in-memory PDF when leaving the page.
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tourReference) {
        setError("Invalid trip reference");
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/customer/tour-bookings/${encodeURIComponent(tourReference)}/visa-itinerary.pdf`, {
          credentials: "include",
          cache: "no-store",
        });
        if (response.status === 409) {
          const payload = await response.json().catch(() => null);
          if (alive && Array.isArray(payload?.missing)) setMissing(payload.missing.map(String));
          if (alive && Array.isArray(payload?.checks)) setChecks(payload.checks);
          if (alive && typeof payload?.error === "string") setErrorCode(payload.error);
          throw new Error(payload?.message || "This visa-support itinerary is not currently available.");
        }
        if (!response.ok) throw new Error(`We could not generate this itinerary (${response.status}).`);
        const blob = await response.blob();
        const name = response.headers.get("X-NoLSAF-Filename");
        if (alive) {
          if (name) setFileName(name);
          setPdfUrl(URL.createObjectURL(new Blob([blob], { type: "application/pdf" })));
        }
      } catch (err: any) {
        if (alive) setError(err?.message || "We could not generate this itinerary.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tourReference]);

  if (loading) {
    return <div className="flex min-h-[60vh] items-center justify-center"><div className="text-center"><LogoSpinner size="md" className="mx-auto mb-3" ariaLabel="Preparing visa itinerary" /><div className="text-sm text-gray-600">Preparing visa itinerary…</div></div></div>;
  }

  if (error || !pdfUrl) {
    if (missing.length > 0) {
      const done = checks.filter((c) => c.ok).length;
      const closed = checks.some((c) => c.key === "upcoming" && !c.ok);
      // The trip already happened: no checklist to work through, just say so
      // and point to the documents that still matter after travel.
      if (closed) {
        const endCheck = checks.find((c) => c.key === "end" || /end/i.test(c.label));
        // "Start date has passed": under way, not over yet.
        const underWay = checks.some((c) => c.key === "upcoming" && /start date has passed/i.test(c.detail));
        return (
          <div id="visa-closed" className="flex min-h-[60vh] w-full items-center justify-center px-4 py-10">
            <style>{"#visa-closed, #visa-closed * { box-sizing: border-box; }"}</style>
            <section role="status" className="w-full max-w-[380px] rounded-[20px] border border-solid border-slate-200 bg-white px-6 py-10 text-center shadow-[0_18px_40px_-30px_rgba(15,23,42,0.45)]">
              <div className="flex justify-center">
                <span className="flex h-[76px] w-[76px] items-center justify-center rounded-full bg-[#02665e]/[0.06] text-[#02665e]" style={{ boxShadow: "inset 0 0 0 2.5px #02665e" }}>
                  <CalendarCheck className="h-8 w-8" aria-hidden />
                </span>
              </div>
              <p className="m-0 mt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Visa-support itinerary</p>
              <h1 className="m-0 mt-1 text-[20px] font-bold tracking-[-0.01em] text-slate-900">{underWay ? "This trip is under way" : "This trip has ended"}</h1>
              <p className="m-0 mt-1.5 text-[14px] leading-relaxed text-slate-600">
                {underWay
                  ? "Visa itineraries are issued before travel starts, for your visa application."
                  : `Visa itineraries are only issued for upcoming travel${endCheck?.ok && endCheck.detail ? `, and this one finished on ${endCheck.detail.replace(/\s*\(.*\)\s*$/, "")}` : ""}.`}{" "}
                Your receipt and voucher stay available for your records.
              </p>
              <div className="mt-6 flex flex-col items-center gap-3">
                <Link href={`${backHref}/receipt`} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#02665e] px-[18px] text-[14px] font-semibold text-white no-underline hover:bg-[#014e47]">
                  <ReceiptText className="h-4 w-4" aria-hidden /> View receipt
                </Link>
                <div className="flex items-center justify-center gap-4 text-[14px]">
                  <Link href={`${backHref}/voucher`} className="text-slate-600 no-underline hover:text-[#02665e]">Voucher</Link>
                  <span className="text-slate-300" aria-hidden>·</span>
                  <Link href={backHref} className="text-slate-600 no-underline hover:text-[#02665e]">Back to trip</Link>
                </div>
              </div>
              <p className="m-0 mt-5 text-[12px] text-slate-400">Travelling again? Book a new trip and its itinerary is issued once paid.</p>
            </section>
          </div>
        );
      }
      return (
        <div id="visa-not-ready" className="w-full py-2 sm:py-4">
          <style>{"#visa-not-ready, #visa-not-ready * { box-sizing: border-box; }"}</style>
          <Link href={backHref} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline transition-colors hover:border-[#02665e] hover:text-[#02665e]">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back to trip
          </Link>
          <section className="mt-4 overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-start sm:justify-between sm:p-6">
              <div className="flex min-w-0 items-start gap-3">
                <span className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl ${closed ? "bg-slate-100 text-slate-500" : "bg-[#02665e]/10 text-[#02665e]"}`}>
                  <FileCheck2 className="h-5 w-5" aria-hidden />
                </span>
                <div className="min-w-0">
                  <h1 className="m-0 text-[17px] font-bold text-slate-900">{closed ? "Itinerary no longer available" : "Your itinerary is almost ready"}</h1>
                  <p className="m-0 mt-1 text-[13px] leading-relaxed text-slate-500">
                    {closed
                      ? missing[0]
                      : "Consulates check your travel dates against a day-by-day plan, so the document is issued once every item below is in place."}
                  </p>
                </div>
              </div>
              {checks.length > 0 && !closed ? (
                <div className="flex-shrink-0 text-left sm:text-right">
                  <div className="text-[22px] font-black leading-none tabular-nums text-slate-900">{done}<span className="text-[14px] font-bold text-slate-300">/{checks.length}</span></div>
                  <div className="mt-1 text-[11px] font-semibold text-slate-400">requirements met</div>
                </div>
              ) : null}
            </div>

            {checks.length > 0 ? (
              <ul className="m-0 list-none divide-y divide-solid divide-slate-100 border-0 border-t border-solid border-slate-100 p-0 [&>*]:border-x-0">
                {checks.map((check) => (
                  <li key={check.key} className="flex items-center gap-3 px-5 py-3.5 sm:px-6">
                    <span className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${check.ok ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-600"}`}>
                      {check.ok ? <Check className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] font-semibold text-slate-800">{check.label}</span>
                    <span className={`flex-shrink-0 text-right text-[12.5px] ${check.ok ? "text-slate-500" : "font-semibold text-amber-700"}`}>{check.detail}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <ul className="m-0 list-none space-y-2 border-0 border-t border-solid border-slate-100 p-5 sm:px-6">
                {missing.map((item) => <li key={item} className="text-[13px] text-slate-700">{item}</li>)}
              </ul>
            )}

            {!closed ? (
              <p className="m-0 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-5 py-3.5 text-[12.5px] text-slate-500 sm:px-6">
                Missing details come from your tour operator. Ask them from the trip page, then come back here to download.
              </p>
            ) : null}
          </section>
        </div>
      );
    }
    const awaitingPayment = errorCode === "visa_itinerary_not_available";
    const cancelled = errorCode === "visa_itinerary_cancelled";
    // A centered notice, like the global error screen: icon in a ring, one
    // title, one line, then the action to take.
    const payOpen = Boolean(trip?.payUrl && trip.payExpiresAt && trip.payExpiresAt > now);
    const minutesLeft = payOpen && trip?.payExpiresAt ? Math.max(1, Math.round((trip.payExpiresAt - now) / 60_000)) : 0;
    const view = awaitingPayment
      ? { ring: "#f59e0b", tint: "#fffbeb", ink: "#b45309", Icon: FileLock2, title: "Unlocks after payment", body: "Embassies only accept a visa itinerary for a paid trip. Pay, and it is ready here instantly." }
      : cancelled
        ? { ring: "#94a3b8", tint: "#f1f5f9", ink: "#475569", Icon: Ban, title: "Trip cancelled", body: "A visa-support itinerary is only issued for an active booking." }
        : { ring: "#ef4444", tint: "#fef2f2", ink: "#b91c1c", Icon: AlertTriangle, title: "Itinerary unavailable", body: error || "We could not prepare it right now. Please try again." };
    return (
      <div id="visa-unavailable" className="flex min-h-[60vh] w-full items-center justify-center px-4 py-10">
        <style>{"#visa-unavailable, #visa-unavailable * { box-sizing: border-box; }"}</style>
        <section role="alert" className="w-full max-w-[380px] rounded-[20px] border border-solid border-slate-200 bg-white px-6 py-10 text-center shadow-[0_18px_40px_-30px_rgba(15,23,42,0.45)]">
          <div className="flex justify-center">
            <span
              className="flex h-[76px] w-[76px] items-center justify-center rounded-full"
              style={{ boxShadow: `inset 0 0 0 2.5px ${view.ring}`, background: view.tint, color: view.ink }}
            >
              <view.Icon className="h-8 w-8" aria-hidden />
            </span>
          </div>
          <p className="m-0 mt-5 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Visa-support itinerary</p>
          <h1 className="m-0 mt-1 text-[20px] font-bold tracking-[-0.01em] text-slate-900">{view.title}</h1>
          <p className="m-0 mt-1.5 text-[14px] leading-relaxed text-slate-600">{view.body}</p>

          {/* The trip this is for, and what is due */}
          {awaitingPayment && trip ? (
            <div className="mt-5 overflow-hidden rounded-xl border border-solid border-slate-200 text-left">
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><MapPinned className="h-4 w-4" aria-hidden /></span>
                <div className="min-w-0">
                  <p className="m-0 truncate text-[13.5px] font-semibold text-slate-900">{trip.title}</p>
                  <p className="m-0 truncate text-[12px] text-slate-500">{[trip.dates, trip.travelers ? `${trip.travelers} traveller${trip.travelers === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ")}</p>
                </div>
              </div>
              {trip.amount ? (
                <div className="flex items-center justify-between gap-3 border-0 border-t border-solid border-slate-100 bg-slate-50/70 px-4 py-2.5">
                  <span className="text-[12px] font-medium text-slate-500">Amount due</span>
                  <span className="text-[15px] font-bold tabular-nums text-slate-900">{trip.amount}</span>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4">
            {awaitingPayment ? (
              payOpen && trip?.payUrl ? (
                <a href={trip.payUrl} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#02665e] px-[18px] text-[14px] font-semibold text-white no-underline hover:bg-[#014e47]">
                  <Lock className="h-4 w-4" aria-hidden /> Pay {trip.amount || "now"} <ArrowRight className="h-4 w-4" aria-hidden />
                </a>
              ) : (
                <Link href={backHref} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-[#02665e] px-[18px] text-[14px] font-semibold text-white no-underline hover:bg-[#014e47]">
                  Complete payment <ArrowRight className="h-4 w-4" aria-hidden />
                </Link>
              )
            ) : !cancelled ? (
              <button type="button" onClick={() => window.location.reload()} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-[10px] border border-solid border-slate-300 bg-white px-[18px] text-[14px] font-semibold text-slate-900 hover:bg-slate-50">
                <RotateCw className="h-4 w-4" aria-hidden /> Try again
              </button>
            ) : null}
            <Link href={backHref} className={cancelled ? "inline-flex h-10 items-center justify-center rounded-[10px] border border-solid border-slate-300 bg-white px-[18px] text-[14px] font-semibold text-slate-900 no-underline hover:bg-slate-50" : "text-[14px] text-slate-600 no-underline hover:text-[#02665e]"}>
              Back to trip
            </Link>
          </div>

          {awaitingPayment ? (
            <p className="m-0 mt-5 flex items-center justify-center gap-1.5 text-[12px] text-slate-400">
              <ShieldCheck className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
              {payOpen ? `Secure payment · link valid ${minutesLeft} min` : "Secure payment · mobile money or card"}
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#eef2f1]">
      <header className="flex h-16 flex-shrink-0 items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 bg-white px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={backHref} aria-label="Back to trip" title="Back to trip" className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-700 no-underline hover:bg-slate-50"><ArrowLeft className="h-4 w-4" aria-hidden /></Link>
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#02665e]/10 text-[#02665e]"><FileCheck2 className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0"><h1 className="m-0 truncate text-[15px] font-bold text-slate-900 sm:text-[16px]">Travel itinerary</h1><p className="m-0 truncate text-[11.5px] text-slate-500">A4 PDF for visa and travel applications</p></div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <button type="button" onClick={() => { frameRef.current?.contentWindow?.focus(); frameRef.current?.contentWindow?.print(); }} className="hidden h-10 cursor-pointer items-center gap-2 rounded-lg border border-solid border-slate-300 bg-white px-3.5 text-sm font-semibold text-slate-700 hover:border-[#02665e] hover:text-[#02665e] sm:inline-flex"><Printer className="h-4 w-4" aria-hidden />Print</button>
          <a href={pdfUrl} download={fileName} className="inline-flex h-10 items-center gap-2 rounded-lg bg-[#02665e] px-3.5 text-sm font-semibold text-white no-underline hover:bg-[#014e47]"><Download className="h-4 w-4" aria-hidden /><span className="hidden min-[380px]:inline">Download PDF</span></a>
        </div>
      </header>
      <main className="relative min-h-0 flex-1 bg-[#dfe5e4]">
        {inlineViewer ? (
          <iframe ref={frameRef} title="Travel itinerary PDF" src={`${pdfUrl}#view=FitH`} className="block h-full w-full border-0" />
        ) : (
          <div className="flex h-full items-center justify-center p-5">
            <div className="w-full max-w-sm rounded-3xl border border-solid border-slate-200 bg-white p-6 text-center">
              <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[#02665e]/10 text-[#02665e]"><FileCheck2 className="h-6 w-6" aria-hidden /></span>
              <h2 className="m-0 mt-4 text-[16px] font-bold text-slate-900">Your itinerary is ready</h2>
              <p className="m-0 mt-1 text-[13px] text-slate-500">This browser opens PDFs in its own viewer. Download it, or open it to view and share.</p>
              <a href={pdfUrl} download={fileName} className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-full bg-[#02665e] text-sm font-bold text-white no-underline"><Download className="h-4 w-4" aria-hidden />Download PDF</a>
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex h-11 w-full items-center justify-center rounded-full border border-solid border-slate-300 text-sm font-semibold text-slate-700 no-underline">Open PDF</a>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
