"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowLeft, Check, Clock, FileCheck2, Printer } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

export default function TourVisaItineraryPage() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams.id[0] : routeParams?.id;
  const tourReference = String(idParam || "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [checks, setChecks] = useState<Array<{ key: string; label: string; ok: boolean; detail: string }>>([]);
  const [documentHtml, setDocumentHtml] = useState("");
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);

  const backHref = useMemo(() => `/account/tour-packages/${encodeURIComponent(tourReference)}`, [tourReference]);

  const fitDocument = useCallback(() => {
    const frame = frameRef.current;
    const stage = stageRef.current;
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
    const height = sheet.scrollHeight;
    if (!width || !height) return;
    const availableWidth = Math.max(280, stage.clientWidth - 32);
    const scale = Math.min(availableWidth / width, 1);

    Object.assign(doc.documentElement.style, { width: `${width}px`, minHeight: `${height}px`, overflow: "hidden" });
    Object.assign(doc.body.style, { width: `${width}px`, minHeight: `${height}px`, margin: "0", overflow: "hidden", background: "#fff" });
    sheet.style.transform = `scale(${scale})`;
    frame.style.width = `${Math.ceil(width * scale)}px`;
    frame.style.height = `${Math.ceil(height * scale)}px`;
  }, []);

  useEffect(() => {
    const observer = stageRef.current ? new ResizeObserver(fitDocument) : null;
    if (stageRef.current) observer?.observe(stageRef.current);
    window.addEventListener("resize", fitDocument);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", fitDocument);
    };
  }, [fitDocument]);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tourReference) {
        setError("Invalid trip reference");
        setLoading(false);
        return;
      }
      try {
        const response = await fetch(`/api/customer/tour-bookings/${encodeURIComponent(tourReference)}/visa-itinerary.html`, {
          credentials: "include",
          cache: "no-store",
        });
        if (response.status === 409) {
          const payload = await response.json().catch(() => null);
          if (alive && Array.isArray(payload?.missing)) setMissing(payload.missing.map(String));
          if (alive && Array.isArray(payload?.checks)) setChecks(payload.checks);
          throw new Error(payload?.message || "This visa-support itinerary is not currently available.");
        }
        if (!response.ok) throw new Error(`We could not generate this itinerary (${response.status}).`);
        const rendered = await response.text();
        if (alive) setDocumentHtml(rendered);
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

  if (error || !documentHtml) {
    if (missing.length > 0) {
      const done = checks.filter((c) => c.ok).length;
      const closed = checks.some((c) => c.key === "upcoming" && !c.ok);
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
    return <div className="mx-auto max-w-4xl px-4 py-8"><div className="rounded-2xl border border-solid border-gray-200 bg-white p-6"><div className="text-sm font-medium text-slate-700">{error || "Visa itinerary unavailable"}</div><Link href={backHref} className="mt-4 inline-block text-[#02665e] underline">Back to trip</Link></div></div>;
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col overflow-hidden bg-[#eef2f1]">
      <header className="flex h-16 flex-shrink-0 items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 bg-white px-3 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={backHref} aria-label="Back to trip" title="Back to trip" className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg border border-solid border-slate-200 bg-white text-slate-700 no-underline hover:bg-slate-50"><ArrowLeft className="h-4 w-4" aria-hidden /></Link>
          <span className="inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700"><FileCheck2 className="h-5 w-5" aria-hidden /></span>
          <div className="min-w-0"><h1 className="m-0 truncate text-[15px] font-bold text-slate-900 sm:text-[16px]">Visa-support itinerary</h1><p className="m-0 truncate text-[11.5px] text-slate-500">Confirmed travel plan for applications</p></div>
        </div>
        <button type="button" onClick={() => { frameRef.current?.contentWindow?.focus(); frameRef.current?.contentWindow?.print(); }} className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border-0 bg-[#02665e] px-3.5 text-sm font-semibold text-white hover:bg-[#014e47]"><Printer className="h-4 w-4" aria-hidden /><span className="hidden sm:inline">Print or save PDF</span></button>
      </header>
      <main className="relative min-h-0 flex-1 overflow-auto bg-[#dfe5e4]"><div ref={stageRef} className="flex min-h-full w-full items-start justify-center px-3 py-5 sm:px-6 sm:py-7"><iframe ref={frameRef} title="Visa-support tour itinerary" srcDoc={documentHtml} onLoad={fitDocument} className="block shrink-0 border-0 bg-white shadow-[0_12px_35px_rgba(15,46,43,0.16)]" /></div></main>
    </div>
  );
}
