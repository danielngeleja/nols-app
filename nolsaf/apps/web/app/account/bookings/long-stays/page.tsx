"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, CalendarClock, ChevronDown, MessageCircleQuestion, Search, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import TenancyList, { HowItWorks } from "@/components/longStay/TenancyList";
import BookingTypeNav from "@/components/longStay/BookingTypeNav";

type Enquiry = {
  ref: string;
  kind: "QUESTION" | "VISIT";
  text: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  answer: string | null;
  visitAt: string | null;
  createdAt: string;
  home: { title: string | null; key: string | null } | null;
};

function eat(iso: string | null) {
  return iso ? `${new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" })} EAT` : "";
}

export default function AccountLongStaysPage() {
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  useEffect(() => {
    apiClient.get<{ items: Enquiry[] }>("/api/customer/long-stay/enquiries").then((r) => setEnquiries(r.data.items)).catch(() => setEnquiries([]));
  }, []);

  return (
    <div className="w-full min-w-0 space-y-4">
      <BookingTypeNav current="long" />
      <header className="flex flex-wrap items-end justify-between gap-4 rounded-lg border border-solid border-[#cfe2da] bg-[#eaf4ef] px-4 py-4 sm:px-6 sm:py-5">
        <div className="min-w-0">
          <p className="m-0 text-xs font-semibold uppercase tracking-wider text-[#215b50]">My bookings</p>
          <h1 className="m-0 mt-0.5 text-[clamp(1.5rem,4vw,2rem)] font-bold leading-tight tracking-tight text-[#102822]">Long stays</h1>
          <p className="m-0 mt-1 text-sm text-slate-700">Check reservation updates, sign your lease and prepare to move in.</p>
        </div>
        <Link href="/public/properties" className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md bg-[#02665e] px-3 text-sm font-semibold text-white no-underline hover:bg-[#014e47] hover:text-white hover:no-underline"><Search className="size-4" aria-hidden />Find a home</Link>
      </header>
      <div className="grid min-w-0 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(17rem,30%)]">
        <TenancyList side="TENANT" detailBase="/account/bookings/long-stays" hideHeading />
        <aside className="min-w-0 space-y-3">
          <Link href="/account/long-stay-id" className="flex items-center gap-3 rounded-lg border border-solid border-[#d9e7e2] bg-white p-3.5 text-slate-900 no-underline hover:bg-[#f1f8f4] hover:no-underline">
            <span className="grid size-9 shrink-0 place-items-center rounded-md bg-[#e8f3ed] text-[#02665e]"><ShieldCheck className="size-4.5" aria-hidden /></span>
            <span className="min-w-0 flex-1"><span className="block text-sm font-bold">Long-stay ID</span><span className="mt-0.5 block text-xs text-slate-600">Check or submit the ID you need to sign a lease.</span></span>
            <ArrowRight className="size-4 shrink-0 text-[#02665e]" aria-hidden />
          </Link>
          {enquiries.length ? (
            <section className="overflow-hidden rounded-lg border border-solid border-[#d9e7e2] bg-white" aria-label="Questions and visits">
              <h2 className="m-0 flex items-center gap-2 bg-[#f8fbfa] px-3.5 py-3 text-sm font-bold text-slate-950"><MessageCircleQuestion className="size-4 text-[#02665e]" aria-hidden />Questions and visits</h2>
              <ul className="m-0 list-none divide-y divide-[#e5efeb] p-0">
                {enquiries.map((e) => (
                  <li key={e.ref}>
                    <details className="group">
                      <summary className="flex cursor-pointer list-none items-start gap-2 px-3.5 py-3 hover:bg-[#f8fbfa] [&::-webkit-details-marker]:hidden">
                        {e.kind === "VISIT" ? <CalendarClock className="mt-0.5 size-4 shrink-0 text-[#02665e]" aria-hidden /> : <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-[#02665e]" aria-hidden />}
                        <span className="min-w-0 flex-1">
                          <span className="block break-words text-xs font-semibold text-slate-900">{e.home?.title || "Long-stay home"}</span>
                          <span className="mt-0.5 block text-xs text-slate-600">{e.status === "OPEN" ? "Waiting for NoLSAF" : e.status === "ANSWERED" ? "NoLSAF replied" : "Closed"}{e.visitAt && ` · Visit ${eat(e.visitAt)}`}</span>
                        </span>
                        <ChevronDown className="mt-0.5 size-4 shrink-0 text-[#02665e] group-open:rotate-180" aria-hidden />
                      </summary>
                      <div className="space-y-2 px-3.5 pb-3">
                        <p className="m-0 whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-700">{e.text}</p>
                        {e.answer && <p className="m-0 whitespace-pre-wrap break-words rounded-md bg-[#edf6f2] px-2.5 py-2 text-xs leading-relaxed text-slate-800"><strong className="block text-[#215b50]">NoLSAF reply</strong>{e.answer}</p>}
                        {e.visitAt && <p className="m-0 text-xs font-semibold text-[#02665e]">Visit with a NoLSAF Sales Partner</p>}
                        {e.home?.key && e.status !== "OPEN" && <Link href={`/public/properties/${encodeURIComponent(e.home.key)}`} className="inline-flex items-center gap-1 rounded border border-solid border-[#cfe2da] px-2 py-1 text-xs font-semibold text-[#02665e] no-underline hover:bg-[#edf6f2] hover:no-underline">View property <ArrowUpRight className="size-3.5" aria-hidden /></Link>}
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          <details className="group rounded-lg border border-solid border-[#d9e7e2] bg-white">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-3.5 py-3 text-sm font-semibold text-slate-900 hover:bg-[#f8fbfa] [&::-webkit-details-marker]:hidden">How long stays work <ChevronDown className="size-4 text-[#02665e] group-open:rotate-180" aria-hidden /></summary>
            <HowItWorks side="TENANT" compact />
          </details>
        </aside>
      </div>
    </div>
  );
}
