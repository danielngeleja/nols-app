"use client";

import React from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, CreditCard, KeyRound, MapPinned, Search, ShieldCheck } from "lucide-react";

/**
 * Homepage "How booking works": a dark band with the booking journey as a connected
 * path (across on desktop, down on phones) and the accepted payment methods beneath.
 */

const STEPS = [
  { title: "Book", text: "Search by place, price or type.", Icon: Search },
  { title: "Pay", text: "Mobile money, bank or card.", Icon: CreditCard },
  { title: "Get your code", text: "Your booking code arrives instantly.", Icon: KeyRound, highlight: "BK-7Q2KX9" },
  { title: "Ride", text: "Driver and vehicle matched first.", Icon: ShieldCheck },
  { title: "Arrive", text: "Show your code and check in.", Icon: MapPinned },
] as const;

const PAYMENT_GROUPS = [
  {
    label: "Mobile money",
    logos: [
      { src: "/assets/M-pesa.png", alt: "M-Pesa" },
      { src: "/assets/airtel_money.png", alt: "Airtel Money" },
      { src: "/assets/mix%20by%20yas.png", alt: "Mixx by Yas" },
      { src: "/assets/halopesa.png", alt: "Halopesa" },
    ],
  },
  {
    label: "Bank",
    logos: [
      { src: "/assets/NoLSAF_CRDB.png", alt: "CRDB Bank" },
      { src: "/assets/NoLSAF_NMB.png", alt: "NMB Bank" },
    ],
  },
  {
    label: "Card",
    logos: [
      { src: "/assets/visa_card.png", alt: "Visa" },
      { src: "/assets/Mastercard_Logo.png", alt: "Mastercard" },
    ],
  },
] as const;

export default function BookingFlowCard() {
  return (
    <section
      aria-labelledby="how-booking-works-heading"
      className="relative box-border w-full max-w-full overflow-hidden rounded-2xl text-white ring-1 ring-inset ring-white/[0.06] shadow-[0_18px_44px_-22px_rgba(0,0,0,0.7)] lg:rounded-[20px]"
      style={{ background: "linear-gradient(135deg, #07090c 0%, #0b1211 60%, #0d1714 100%)" }}
    >
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0" style={{ background: "radial-gradient(520px circle at 100% 0%, rgba(2,102,94,0.3), transparent 60%)" }} />
        <div className="absolute inset-x-0 top-0 h-px" style={{ background: "linear-gradient(90deg, transparent, rgba(52,211,153,0.45), transparent)" }} />
      </div>

      <div className="relative box-border p-4 sm:p-6 lg:p-8">
        {/* Header */}
        <div className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="m-0 inline-flex items-center rounded-md bg-emerald-300/10 px-2 py-1 text-[11px] font-semibold text-emerald-200 ring-1 ring-inset ring-emerald-300/20">
              How it works
            </p>
            <h2 id="how-booking-works-heading" className="m-0 mt-3 text-[21px] font-bold leading-snug tracking-tight sm:text-[24px] lg:text-[26px]">
              From search to check-in in five steps
            </h2>
          </div>
          <Link
            href="/public/properties"
            className="group hidden h-10 shrink-0 items-center gap-1.5 rounded-lg bg-white px-4 text-[13.5px] font-semibold text-[#02665e] no-underline transition hover:bg-emerald-50 hover:no-underline sm:inline-flex"
          >
            Start booking
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>

        {/* Journey: a zigzag down a centre spine on phones, a horizontal path on desktop */}
        <ol className="relative m-0 mt-6 grid list-none grid-cols-[minmax(0,1fr)] gap-0 p-0 lg:mt-8 lg:grid-cols-5 lg:gap-4">
          {/* Phone spine through the node centres */}
          <span aria-hidden className="pointer-events-none absolute bottom-5 left-1/2 top-5 w-px -translate-x-1/2 bg-gradient-to-b from-emerald-300/50 via-emerald-300/25 to-emerald-300/10 lg:hidden" />
          {/* Desktop connector through the node centres (10% to 90% of the row) */}
          <span aria-hidden className="pointer-events-none absolute left-[10%] right-[10%] top-5 hidden h-px lg:block" style={{ background: "linear-gradient(90deg, rgba(52,211,153,0.55), rgba(52,211,153,0.15))" }} />

          {STEPS.map((step, index) => {
            const { title, text, Icon } = step;
            // Even steps read on the right of the spine, odd steps on the left
            const onLeft = index % 2 === 1;
            return (
              <li key={title} className="relative grid min-w-0 grid-cols-[minmax(0,1fr)_40px_minmax(0,1fr)] items-start gap-x-3 pb-4 last:pb-0 lg:flex lg:flex-col lg:items-center lg:gap-0 lg:pb-0 lg:text-center">
                <span className="relative z-10 col-start-2 row-start-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#0b1211] text-emerald-300 ring-1 ring-inset ring-emerald-300/35 shadow-[0_0_0_4px_#0b1211]">
                  <Icon className="h-[18px] w-[18px]" aria-hidden />
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-emerald-400 px-1 text-[9.5px] font-bold text-[#012e29]" aria-hidden>
                    {index + 1}
                  </span>
                </span>

                <div className={`row-start-1 min-w-0 pt-1 lg:mt-3 lg:pt-0 lg:text-center ${onLeft ? "col-start-1 text-right" : "col-start-3 text-left"}`}>
                  <h3 className="m-0 text-[14.5px] font-semibold text-white">
                    <span className="sr-only">Step {index + 1}: </span>
                    {title}
                  </h3>
                  <p className="m-0 mt-0.5 text-[12.5px] leading-snug text-white/55">{text}</p>
                  {"highlight" in step && step.highlight && (
                    <span className="mt-1.5 inline-flex items-center rounded-md border border-dashed border-emerald-300/40 bg-emerald-300/[0.06] px-1.5 py-0.5 font-mono text-[11.5px] font-bold tracking-[0.08em] text-emerald-200">
                      {step.highlight}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ol>

        {/* Payments */}
        <div className="mt-6 flex flex-col gap-3 border-0 border-t border-solid border-white/[0.08] pt-5 lg:mt-8 lg:flex-row lg:items-center lg:gap-6">
          <span className="text-[12px] font-semibold text-white/70">Pay with</span>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            {PAYMENT_GROUPS.map((group) => (
              <div key={group.label} className="flex items-center gap-2">
                <span className="text-[11.5px] text-white/40">{group.label}</span>
                <div className="flex items-center gap-1.5">
                  {group.logos.map((logo) => (
                    <span key={logo.alt} title={logo.alt} className="flex h-8 w-10 items-center justify-center rounded-md bg-white">
                      {/* Fixed box + fill: logos of any shape fit without next/image aspect warnings */}
                      <span className="relative block h-5 w-7">
                        <Image src={logo.src} alt={logo.alt} fill sizes="28px" className="object-contain" />
                      </span>
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Phone CTA */}
        <Link
          href="/public/properties"
          className="mt-5 flex h-11 items-center justify-center gap-1.5 rounded-xl bg-white text-[14px] font-semibold text-[#02665e] no-underline sm:hidden"
        >
          Start booking
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>
    </section>
  );
}
