"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarDays, CheckCircle2, MapPin, ShieldCheck, Users, XCircle } from "lucide-react";
import LogoSpinner from "@/components/LogoSpinner";

type Verification = {
  verified: boolean;
  documentStatus?: string;
  documentNumber?: string;
  bookingCode?: string;
  title?: string;
  destination?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  travelerCount?: number;
  leadTraveller?: string | null;
  nationality?: string | null;
  operatorName?: string;
  travellers?: Array<{ name: string; nationality: string | null }>;
  error?: string;
};

// Document surfaces use the house document font.
const DOCUMENT_FONT = "\"Trebuchet MS\", \"Lucida Grande\", \"Lucida Sans Unicode\", Tahoma, sans-serif";

function date(value?: string | null): string {
  if (!value) return "To be confirmed";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "To be confirmed";
  return parsed.toLocaleDateString("en-GB", { day: "2-digit", month: "long", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
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

  if (loading) return <main className="grid min-h-screen place-items-center bg-slate-50 p-6"><div className="text-center"><LogoSpinner size="md" className="mx-auto mb-3" ariaLabel="Verifying itinerary" /><p className="text-sm text-slate-600">Verifying document…</p></div></main>;

  const verified = Boolean(result?.verified);
  const underReview = verified && result?.documentStatus === "UNDER_REVIEW";
  return (
    <main className="min-h-screen bg-gradient-to-b from-[#edf8f6] to-slate-50 px-4 py-10 sm:py-16" style={{ fontFamily: DOCUMENT_FONT }}>
      <section className="mx-auto max-w-2xl overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_24px_70px_-35px_rgba(2,102,94,0.45)]">
        <header className="border-0 border-b border-solid border-slate-100 p-6 sm:p-8">
          <Link href="/" className="text-xl font-black tracking-tight text-[#024d47] no-underline">NoLSAF</Link>
          <div className={`mt-6 flex items-start gap-3 rounded-2xl border border-solid p-4 ${underReview ? "border-amber-200 bg-amber-50" : verified ? "border-emerald-200 bg-emerald-50" : "border-rose-200 bg-rose-50"}`}>
            <span className={`inline-flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl text-white ${underReview ? "bg-amber-500" : verified ? "bg-[#02665e]" : "bg-rose-600"}`}>
              {verified ? <ShieldCheck className="h-6 w-6" aria-hidden /> : <XCircle className="h-6 w-6" aria-hidden />}
            </span>
            <div><h1 className={`m-0 text-xl font-extrabold ${underReview ? "text-amber-950" : verified ? "text-emerald-950" : "text-rose-950"}`}>{underReview ? "Booking under review" : verified ? "Verified NoLSAF itinerary" : result?.documentStatus === "CANCELLED" ? "Booking cancelled" : "Document not verified"}</h1><p className={`m-0 mt-1 text-sm ${underReview ? "text-amber-900" : verified ? "text-emerald-800" : "text-rose-800"}`}>{underReview ? "This paid booking exists, but a change, issue or cancellation request is open on it. Contact the traveller or NoLSAF before relying on the dates." : verified ? "The booking details below match a paid tour booking recorded by NoLSAF." : result?.error || "This link is invalid or the booking is not eligible for verification."}</p></div>
          </div>
        </header>

        {result?.documentNumber ? (
          <div className="p-6 sm:p-8">
            <div className="flex flex-col gap-1 border-0 border-b border-solid border-slate-100 pb-5"><span className="text-[11px] font-bold uppercase tracking-[0.14em] text-slate-500">Document number</span><span className="break-all font-mono text-sm font-bold text-slate-900">{result.documentNumber}</span></div>
            <h2 className="m-0 mt-6 text-2xl font-extrabold tracking-tight text-slate-950">{result.title || "Tour itinerary"}</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {[
                { Icon: MapPin, label: "Destination", value: result.destination || "Tanzania" },
                { Icon: CalendarDays, label: "Travel dates", value: `${date(result.startDate)} to ${date(result.endDate)}` },
                { Icon: Users, label: "Lead traveller", value: [result.leadTraveller, result.nationality].filter(Boolean).join(" · ") || "Not recorded" },
                { Icon: CheckCircle2, label: "Tour operator", value: result.operatorName || "NoLSAF tour operator" },
              ].map(({ Icon, label, value }) => <div key={label} className="flex items-start gap-3 rounded-2xl bg-slate-50 p-4"><Icon className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#02665e]" aria-hidden /><div className="min-w-0"><div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">{label}</div><div className="mt-1 break-words text-sm font-semibold text-slate-900">{value}</div></div></div>)}
            </div>
            {result.travellers && result.travellers.length > 0 ? (
              <div className="mt-5">
                <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Travelling party ({result.travellers.length})</div>
                <ul className="m-0 mt-2 list-none divide-y divide-solid divide-slate-100 overflow-hidden rounded-2xl border border-solid border-slate-200 p-0 [&>*]:border-x-0">
                  {result.travellers.map((traveller, index) => (
                    <li key={`${traveller.name}-${index}`} className="flex items-center justify-between gap-3 bg-white px-4 py-2.5 text-sm">
                      <span className="font-semibold text-slate-900">{traveller.name}</span>
                      <span className="text-slate-500">{traveller.nationality || "Not recorded"}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <p className="m-0 mt-6 rounded-2xl border border-solid border-amber-200 bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900">Verification confirms the NoLSAF booking record only. It is not a visa, immigration decision, airline ticket, or guarantee of entry.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
