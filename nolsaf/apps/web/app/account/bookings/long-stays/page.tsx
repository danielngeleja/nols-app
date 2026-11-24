"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CalendarClock, MessageCircleQuestion } from "lucide-react";
import apiClient from "@/lib/apiClient";
import TenancyList from "@/components/longStay/TenancyList";
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
    <div className="w-full space-y-4">
      <BookingTypeNav current="long" />
      <header className="relative isolate overflow-hidden rounded-xl bg-[#0a1110] px-5 py-5 text-white sm:px-6">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-28 -z-10 h-72 w-72 rounded-full" style={{ background: "radial-gradient(closest-side, rgba(2,102,94,0.6), rgba(2,102,94,0))" }} />
        <p className="m-0 text-xs font-semibold uppercase tracking-wider text-[#5ec8bb]">My bookings</p>
        <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-white">Long stays</h1>
        <p className="m-0 mt-1 text-sm text-white/70">Track reservations, lease signing and move-in for your monthly stays.</p>
      </header>
      <TenancyList
        side="TENANT"
        detailBase="/account/bookings/long-stays"
        hideHeading
        extra={<p className="m-0 mt-2 text-[13px] text-slate-500">Before you can sign a lease, NoLSAF checks your ID once. <Link href="/account/long-stay-id" className="font-semibold text-[#02665e] no-underline hover:underline">Long-stay ID</Link></p>}
      />

      {enquiries.length ? (
        <section className="mt-6 max-w-3xl" aria-label="Questions to NoLSAF">
          <h2 className="m-0 text-base font-bold text-slate-900">Questions to NoLSAF</h2>
          <ul className="m-0 mt-2 list-none overflow-hidden rounded-lg border border-solid border-slate-200 bg-white p-0">
            {enquiries.map((e) => (
              <li key={e.ref} className="border-0 border-t border-solid border-slate-100 px-4 py-3 first:border-t-0">
                <p className="m-0 flex items-center gap-2 text-[13px] font-semibold text-slate-900">
                  {e.kind === "VISIT" ? <CalendarClock className="h-4 w-4 text-[#02665e]" /> : <MessageCircleQuestion className="h-4 w-4 text-[#02665e]" />}
                  {e.home?.title || "Long-stay home"}
                  <span className={`ml-auto rounded px-1.5 py-0.5 text-[11px] font-semibold ${e.status === "OPEN" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>{e.status === "OPEN" ? "Waiting for NoLSAF" : e.status === "ANSWERED" ? "Answered" : "Closed"}</span>
                </p>
                <p className="m-0 mt-1 text-[13px] text-slate-600">{e.text}</p>
                {e.answer ? <p className="m-0 mt-2 rounded-md bg-slate-50 px-3 py-2 text-[13px] text-slate-800"><b>NoLSAF:</b> {e.answer}</p> : null}
                {e.visitAt ? <p className="m-0 mt-1.5 text-[12.5px] font-semibold text-[#02665e]">Visit with a NoLSAF Sales Partner: {eat(e.visitAt)}</p> : null}
                {e.home?.key && e.status !== "OPEN" ? (
                  <Link href={`/public/properties/${e.home.key}`} className="mt-1.5 inline-block text-[12.5px] font-semibold text-[#02665e] no-underline hover:underline">Open the home to reserve</Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
