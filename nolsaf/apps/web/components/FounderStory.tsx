"use client";

import React from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, Globe2, Quote, ShieldCheck, Smartphone } from "lucide-react";

type Props = {
  imageSrc?: string;
};

/**
 * Homepage "Our story" block. One heading, one short statement, one quote, one link.
 * It sits inside the page container already, so it adds no container of its own
 * (a nested public-container used to push it out of line with the sections above).
 */
export default function FounderStory({ imageSrc = "/assets/Founder.jpg" }: Props) {
  return (
    <section aria-labelledby="our-story-heading" className="mt-10">
      <div className="box-border grid w-full grid-cols-[minmax(0,1fr)] overflow-hidden rounded-2xl bg-white ring-1 ring-inset ring-slate-200/80 shadow-[0_18px_44px_-24px_rgba(2,40,36,0.35)] md:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:rounded-[20px]">
        {/* Photo: fills its column, caption on the image */}
        <div className="group relative min-h-[220px] overflow-hidden md:min-h-[380px] md:rounded-r-xl">
          <Image
            src={imageSrc}
            alt="The NoLSAF founder speaking with partners"
            fill
            sizes="(min-width: 768px) 40vw, 100vw"
            className="object-cover transition-transform duration-700 ease-out group-hover:scale-[1.03]"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[#011a18]/85 via-[#011a18]/15 to-transparent" aria-hidden />
          {/* Honest about scope: the mission is Africa-wide, live operations are Tanzania today */}
          <div className="absolute bottom-3 left-4 right-4 flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-md bg-white/15 px-2 py-1 text-[11px] font-semibold text-white ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              <span className="relative flex h-1.5 w-1.5" aria-hidden>
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-300 opacity-60" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-300" />
              </span>
              Launched in Tanzania
            </span>
            <span className="text-[11.5px] font-medium text-white/75">Expanding across Africa</span>
          </div>
        </div>

        {/* Statement */}
        <div className="box-border flex min-w-0 flex-col p-5 sm:p-7 lg:p-9">
          <p className="m-0 inline-flex w-fit items-center rounded-md bg-[#02665e]/[0.08] px-2 py-1 text-[11px] font-semibold text-[#02665e]">
            Our story
          </p>
          <h2 id="our-story-heading" className="m-0 mt-3 text-[21px] font-bold leading-snug tracking-tight text-slate-900 sm:text-[24px] lg:text-[26px]">
            Travel across Africa should feel safe and simple
          </h2>
          <p className="m-0 mt-3 max-w-[60ch] text-[14px] leading-relaxed text-slate-600">
            We are building one trusted way to book stays, transport and tours across the continent, starting in Tanzania with
            local partners we know.
          </p>

          {/* What the mission means in practice */}
          <ul className="m-0 mt-5 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
            {[
              { Icon: ShieldCheck, title: "Verified first", text: "Every listing checked" },
              { Icon: Smartphone, title: "Pay locally", text: "Mobile money, bank or card" },
              { Icon: Globe2, title: "One platform", text: "Stays, rides and tours" },
            ].map(({ Icon, title, text }) => (
              <li key={title} className="flex min-w-0 items-center gap-2.5 rounded-xl bg-slate-50 px-3 py-2.5 ring-1 ring-inset ring-slate-200/70">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: "linear-gradient(135deg, #014e47, #02665e)" }}>
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-semibold leading-tight text-slate-900">{title}</span>
                  <span className="block truncate text-[11.5px] text-slate-500">{text}</span>
                </span>
              </li>
            ))}
          </ul>

          <figure className="m-0 mt-4 rounded-xl border-0 border-l-[3px] border-solid border-[#02665e] bg-[#02665e]/[0.04] py-3.5 pl-4 pr-4">
            <Quote className="h-4 w-4 text-[#02665e]/50" aria-hidden />
            <blockquote className="m-0 mt-1.5 text-[14.5px] font-medium leading-relaxed text-slate-800">
              Everyone deserves an easy, friendly way to travel, explore and connect with new cultures, all in one platform.
            </blockquote>
            <figcaption className="mt-2 text-[12px] font-semibold text-slate-500">Founder, NoLSAF</figcaption>
          </figure>

          <Link
            href="/about/story"
            className="group mt-5 inline-flex w-fit items-center gap-1.5 text-[13.5px] font-semibold text-[#02665e] no-underline hover:no-underline"
          >
            Read our full story
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}
