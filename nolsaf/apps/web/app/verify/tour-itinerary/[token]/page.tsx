"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, MapPin, ShieldCheck, UserRound, Users, XCircle } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

type Verification = {
  verified: boolean;
  documentStatus?: string;
  documentNumber?: string;
  documentTitle?: string;
  bookingCode?: string;
  title?: string;
  destination?: string | null;
  arrival?: string;
  departure?: string;
  departurePlanned?: boolean;
  duration?: string;
  travelerCount?: number;
  leadTraveller?: string | null;
  nationality?: string | null;
  operatorName?: string;
  travellers?: Array<{ name: string; nationality: string | null }>;
  checkedAt?: string;
  error?: string;
};

// Document surfaces use the house document font.
const DOCUMENT_FONT = "\"Trebuchet MS\", \"Lucida Grande\", \"Lucida Sans Unicode\", Tahoma, sans-serif";

function checkedLabel(value?: string): string {
  const parsed = value ? new Date(value) : new Date();
  return `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Africa/Dar_es_Salaam" }).format(parsed)} EAT`;
}

export default function VerifyTourItineraryPage() {
  const params = useParams<{ token?: string | string[] }>();
  const token = Array.isArray(params?.token) ? params.token[0] : String(params?.token || "");
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<Verification | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const response = await fetch(`/api/public/tour-visa-itineraries/${encodeURIComponent(token)}`, { cache: "no-store" });
        const payload = await response.json().catch(() => ({ verified: false, error: "Document not found" }));
        if (alive) setResult(payload);
      } catch {
        if (alive) setResult({ verified: false, error: "Verification is temporarily unavailable" });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token]);

  if (loading) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7f6] p-6" style={{ fontFamily: DOCUMENT_FONT }}>
        <div className="text-center">
          <LogoSpinner size="md" className="mx-auto mb-3" ariaLabel="Verifying itinerary" />
          <p className="m-0 text-sm text-slate-600">Checking this document with NoLSAF…</p>
        </div>
      </main>
    );
  }

  const verified = Boolean(result?.verified);
  const underReview = verified && result?.documentStatus === "UNDER_REVIEW";
  const cancelled = result?.documentStatus === "CANCELLED";
  const band = underReview
    ? { bg: "bg-amber-500", title: "Booking under review", text: "This paid booking exists, but a change, issue or cancellation request is open on it. Contact the traveller or NoLSAF before relying on the dates.", Icon: AlertTriangle }
    : verified
      ? { bg: "bg-[#02665e]", title: "Verified itinerary", text: "These details match a paid tour booking recorded by NoLSAF.", Icon: ShieldCheck }
      : { bg: "bg-rose-600", title: cancelled ? "Booking cancelled" : "Not verified", text: cancelled ? "This booking was cancelled. The itinerary no longer describes planned travel." : result?.error || "This link is invalid or the booking is not eligible for verification.", Icon: XCircle };

  return (
    <main className="min-h-screen bg-[#f4f7f6] px-4 py-8 sm:py-14" style={{ fontFamily: DOCUMENT_FONT }}>
      <div id="verify-itinerary" className="mx-auto w-full max-w-2xl">
        <style>{"#verify-itinerary, #verify-itinerary * { box-sizing: border-box; }"}</style>

        <div className="mb-4 flex items-center justify-between gap-3 px-1">
          <Link href="/" className="text-[20px] font-black tracking-tight text-[#024d47] no-underline">NoLSAF</Link>
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-slate-400">Document verification</span>
        </div>

        <section className="overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_24px_60px_-40px_rgba(2,102,94,0.55)]">
          {/* Status band */}
          <div className={`flex items-center gap-3.5 px-6 py-5 text-white sm:px-8 ${band.bg}`}>
            <span className="inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-2xl bg-white/15">
              <band.Icon className="h-6 w-6" aria-hidden />
            </span>
            <div className="min-w-0">
              <h1 className="m-0 text-[19px] font-bold leading-tight text-white">{band.title}</h1>
              <p className="m-0 mt-0.5 text-[13px] leading-snug text-white/85">{band.text}</p>
            </div>
          </div>

          {result?.documentNumber ? (
            <div className="p-6 sm:p-8">
              {/* Title and document stamp */}
              <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[#02665e]">{result.documentTitle || "Travel itinerary"}</p>
                  <h2 className="m-0 mt-1 text-[22px] font-bold leading-tight text-slate-900">{result.title || "Tour itinerary"}</h2>
                  <p className="m-0 mt-1 inline-flex items-center gap-1.5 text-[13px] text-slate-500">
                    <MapPin className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                    {result.destination || "Tanzania"}
                  </p>
                </div>
                <div className="flex-shrink-0 rounded-2xl border border-dashed border-[#02665e]/40 bg-[#f7fbfa] px-4 py-2.5 sm:text-right">
                  <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-400">Document number</div>
                  <div className="mt-0.5 break-all font-mono text-[13px] font-bold text-slate-900">{result.documentNumber}</div>
                  {result.bookingCode ? <div className="mt-0.5 font-mono text-[11px] text-slate-400">{result.bookingCode}</div> : null}
                </div>
              </div>

              {/* Dates strip, as printed on the itinerary */}
              <dl className="m-0 mt-6 grid grid-cols-3 overflow-hidden rounded-2xl bg-[#024d47] text-white">
                {[
                  { label: "Arrival", value: result.arrival || "To be confirmed" },
                  { label: result.departurePlanned ? "Departure (planned)" : "Departure", value: result.departure || "To be confirmed" },
                  { label: "Duration", value: result.duration || "To be confirmed" },
                ].map((fact, index) => (
                  <div key={fact.label} className={`min-w-0 px-4 py-3.5 ${index < 2 ? "border-0 border-r border-solid border-white/15" : ""}`}>
                    <dt className="truncate text-[10px] font-bold uppercase tracking-[0.12em] text-white/60">{fact.label}</dt>
                    <dd className="m-0 mt-1 text-[14px] font-bold leading-snug text-white">{fact.value}</dd>
                  </div>
                ))}
              </dl>

              {/* People */}
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="flex items-start gap-3 rounded-2xl bg-[#f7fbfa] p-4">
                  <UserRound className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Lead traveller</div>
                    <div className="mt-1 break-words text-[14px] font-bold text-slate-900">{result.leadTraveller || "Not recorded"}</div>
                    {result.nationality ? <div className="text-[12.5px] text-slate-500">{result.nationality}</div> : null}
                  </div>
                </div>
                <div className="flex items-start gap-3 rounded-2xl bg-[#f7fbfa] p-4">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden />
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">Tour operator</div>
                    <div className="mt-1 break-words text-[14px] font-bold text-slate-900">{result.operatorName || "NoLSAF tour operator"}</div>
                    <div className="text-[12.5px] text-slate-500">Booked and paid through NoLSAF</div>
                  </div>
                </div>
              </div>

              {result.travellers && result.travellers.length > 0 ? (
                <div className="mt-5">
                  <div className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.12em] text-slate-500">
                    <Users className="h-3.5 w-3.5 text-[#02665e]" aria-hidden />
                    Travelling party ({result.travellers.length})
                  </div>
                  <ol className="m-0 list-none divide-y divide-solid divide-slate-100 overflow-hidden rounded-2xl border border-solid border-slate-200 p-0 [&>*]:border-x-0">
                    {result.travellers.map((traveller, index) => (
                      <li key={`${traveller.name}-${index}`} className="flex items-center gap-3 bg-white px-4 py-3 text-[13.5px]">
                        <span className="w-5 flex-shrink-0 text-[12px] font-bold text-slate-300">{index + 1}</span>
                        <span className="min-w-0 flex-1 truncate font-bold text-slate-900">{traveller.name}</span>
                        <span className="flex-shrink-0 text-slate-500">{traveller.nationality || "Not recorded"}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}

              <div className="mt-6 rounded-2xl bg-slate-50 px-4 py-3.5 text-[12.5px] leading-relaxed text-slate-600">
                <strong className="font-bold text-slate-800">How to check:</strong> the names, dates and document number above should match the printed itinerary exactly. Passport numbers are not shown here for privacy; compare them with the passport itself.
              </div>
              <p className="m-0 mt-3 text-[11.5px] leading-relaxed text-slate-400">
                Verification confirms the NoLSAF booking record only. It is not a visa, immigration decision, airline ticket, or guarantee of entry.
              </p>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 border-0 border-t border-solid border-slate-100 bg-[#f7fbfa] px-6 py-3.5 text-[11.5px] text-slate-400 sm:px-8">
            <span>Checked {checkedLabel(result?.checkedAt)}</span>
            <span>nolsaf.com · support@nolsaf.com</span>
          </div>
        </section>
      </div>
    </main>
  );
}
