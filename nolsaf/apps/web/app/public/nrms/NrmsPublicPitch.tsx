"use client";

// Public, logged-out version of the owner's NRMS pre-activation screen
// (app/(owner)/owner/nrms/_components/NrmsActivationScreen.tsx). Same pitch,
// same modules, same illustrative workspace preview — sourced from the same
// shared file — so a visitor who isn't an owner yet sees exactly what an
// enrolled owner sees before they activate their first property. The only
// difference is what happens when they act on it: there is no live
// enrollment or property here, so every button leads to account creation
// instead of calling the (owner-only) activation endpoint.
import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Building2, Check, CircleDollarSign, Clock3, Info, ShieldCheck, Sparkles, WalletCards } from "lucide-react";
import { NrmsModuleGrid, NrmsWorkspacePreview } from "@/components/nrms/NrmsShowcase";

type OwnerMode = "CONNECT" | "RUN";

const MODE_COPY: Record<OwnerMode, { eyebrow: string; title: string; description: string; bullets: string[] }> = {
  CONNECT: {
    eyebrow: "For owners with another PMS",
    title: "Keep your existing system",
    description: "Use NoLSAF as your booking channel and continue blocking availability for reservations managed elsewhere.",
    bullets: ["Your current operating workflow stays unchanged", "NoLSAF availability continues preventing duplicate sales"],
  },
  RUN: {
    eyebrow: "For owners who want one workspace",
    title: "Operate your rooms with NRMS",
    description: "Manage external reservations and NoLSAF demand from the same live inventory, guest record and front desk.",
    bullets: ["Record walk-in, phone and OTA stays", "Manage rooms, check-in, checkout, balances and guests"],
  },
};

export default function NrmsPublicPitch() {
  const [mode, setMode] = useState<OwnerMode>("RUN");
  const activeCopy = MODE_COPY[mode];

  return (
    <main className="min-h-screen bg-slate-50">
      <div className="public-container py-6 sm:py-10">
        <div className="relative isolate overflow-hidden rounded-[28px] border border-emerald-100 bg-[#f7fbf9] text-neutral-950 shadow-[0_24px_80px_-48px_rgba(6,78,59,0.45)]">
          <div className="pointer-events-none absolute -right-24 -top-32 h-80 w-80 rounded-full bg-emerald-200/40 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-40 left-1/3 h-96 w-96 rounded-full bg-teal-100/60 blur-3xl" />

          <div className="relative mx-auto max-w-7xl px-5 py-6 sm:px-8 sm:py-9 lg:px-12 lg:py-12">
            <header className="mb-8 border-b border-emerald-900/10 pb-7 text-center">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.28em] text-emerald-700">Welcome to</p>
              <h1 className="mx-auto mt-2 max-w-3xl text-2xl font-bold tracking-[-0.035em] text-neutral-950 sm:text-3xl">
                NoLSAF Rooms Management System <span className="whitespace-nowrap text-emerald-700">(NRMS)</span>
              </h1>
              <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-neutral-500">
                Manage bookings, rooms and guests from one live inventory.
              </p>
              <div className="mx-auto mt-5 flex max-w-3xl items-center" aria-hidden="true">
                <span className="h-px flex-1 bg-gradient-to-r from-transparent via-emerald-300 to-emerald-500" />
                <span className="mx-3 h-1.5 w-1.5 rounded-full bg-emerald-600 shadow-[0_0_0_4px_rgba(16,185,129,0.12)]" />
                <span className="h-px flex-1 bg-gradient-to-l from-transparent via-emerald-300 to-emerald-500" />
              </div>
            </header>

            <div className="grid items-center gap-10 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
              <div>
                <h2 className="max-w-xl text-3xl font-bold leading-[1.12] tracking-[-0.035em] text-neutral-950 sm:text-4xl lg:text-[2.7rem]">
                  <span className="block">Your bookings and room operations</span>
                  <span className="relative mt-1.5 inline-block pb-2 text-emerald-700">
                    finally in one place.
                    <span className="absolute bottom-0 left-0 h-1 w-24 rounded-full bg-gradient-to-r from-emerald-600 via-emerald-400 to-transparent" aria-hidden="true" />
                  </span>
                </h2>
                <p className="mt-5 max-w-xl text-base leading-7 text-neutral-600 sm:text-lg">
                  Connect every stay to live availability, run a clearer front desk and keep your existing NoLSAF marketplace flow exactly as it is.
                </p>

                <div className="mt-7 grid gap-3 sm:grid-cols-2" role="group" aria-label="Choose how you want to use NRMS">
                  {(["RUN", "CONNECT"] as OwnerMode[]).map((item) => {
                    const selected = mode === item;
                    const Icon = item === "RUN" ? Building2 : ShieldCheck;
                    return (
                      <button
                        key={item}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setMode(item)}
                        className={`group rounded-2xl border p-4 text-left transition-all ${selected ? "border-emerald-500 bg-white shadow-[0_12px_30px_-18px_rgba(5,150,105,0.7)] ring-2 ring-emerald-500/10" : "border-neutral-200/80 bg-white/55 hover:border-emerald-300 hover:bg-white"}`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${selected ? "bg-emerald-600 text-white" : "bg-neutral-100 text-neutral-600 group-hover:bg-emerald-50 group-hover:text-emerald-700"}`}><Icon className="h-4 w-4" /></span>
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full border ${selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-neutral-300 text-transparent"}`}><Check className="h-3 w-3" /></span>
                        </div>
                        <p className="mt-3 text-sm font-bold text-neutral-900">{item === "RUN" ? "Run rooms with NRMS" : "Connect my existing PMS"}</p>
                        <p className="mt-1 text-xs leading-5 text-neutral-500">{item === "RUN" ? "One system for your full room operation" : "NoLSAF bookings and availability only"}</p>
                      </button>
                    );
                  })}
                </div>

                <div className="mt-4 rounded-2xl border border-emerald-100 bg-white/75 p-4">
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-700">{activeCopy.eyebrow}</p>
                  <p className="mt-1 text-base font-bold text-neutral-900">{activeCopy.title}</p>
                  <p className="mt-1 text-sm leading-6 text-neutral-600">{activeCopy.description}</p>
                  <div className="mt-3 grid gap-2 text-xs text-neutral-700 sm:grid-cols-2">
                    {activeCopy.bullets.map((bullet) => <span key={bullet} className="flex gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />{bullet}</span>)}
                  </div>
                </div>

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Link href="/account/register?role=owner" className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-bold text-white no-underline shadow-lg shadow-neutral-900/15 transition hover:-translate-y-0.5 hover:bg-emerald-700">
                    <Sparkles className="h-4 w-4" />
                    Create your owner account
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                  <p className="text-xs leading-5 text-neutral-500">No card required<br className="hidden sm:block" /> Activate properties when ready</p>
                </div>

                <p className="mt-4 text-xs text-neutral-500">
                  Already have a NoLSAF owner account? <Link href="/account/login" className="font-bold text-emerald-700 no-underline hover:underline">Sign in</Link> and open NRMS from your dashboard.
                </p>
              </div>

              <NrmsWorkspacePreview />
            </div>

            <div className="mt-12 grid overflow-hidden rounded-2xl border border-emerald-100 bg-white/80 shadow-sm sm:grid-cols-3">
              <PricingFact icon={Clock3} label="Free trial" value="Included" detail="length confirmed when you activate a property" />
              <PricingFact icon={CircleDollarSign} label="After trial" value="Per room-night" detail="rate confirmed at activation, external stays only" />
              <PricingFact icon={WalletCards} label="Marketplace bookings" value="No NRMS fee" detail="your normal commission remains" />
            </div>
            <div className="mt-4 rounded-2xl border border-emerald-100 bg-white/85 p-4 sm:p-5">
              <div className="flex items-start gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Info className="h-4 w-4" /></span>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-emerald-700">Pay As You Go, in plain terms</p>
                  <p className="mt-1.5 text-sm leading-6 text-neutral-600">NRMS itself has no subscription fee. After your trial, you&apos;re only billed for stays NRMS actually completed outside the NoLSAF marketplace, walk-ins, phone bookings and other OTAs, each at a small per-room-night rate. A guest who books you through the NoLSAF marketplace never adds an NRMS fee.</p>
                </div>
              </div>
            </div>

            <section className="mt-14">
              <div className="max-w-2xl">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">A complete owner workspace</p>
                <h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">Everything arranged around the stay</h2>
                <p className="mt-2 text-sm leading-6 text-neutral-600">Start with the essentials today and keep every operational record connected as NRMS grows.</p>
              </div>
              <div className="mt-6">
                <NrmsModuleGrid />
              </div>
            </section>

            <section className="mt-12 rounded-[24px] bg-[#082f2a] px-5 py-6 text-white sm:px-7 sm:py-7">
              <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">What happens next</p>
                  <h2 className="mt-2 text-2xl font-bold tracking-tight">Go live at your own pace.</h2>
                  <p className="mt-2 text-sm leading-6 text-emerald-50/70">Create your account and enroll. Your trial only starts when you activate a property.</p>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <SetupStep number="01" title="Create an account" text="Register as a NoLSAF property owner." />
                  <SetupStep number="02" title="Add a property" text="Import or arrange your room inventory." />
                  <SetupStep number="03" title="Activate property" text="Start the trial and operations." />
                </div>
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
                <p className="text-xs text-emerald-50/75">Already listed on NoLSAF? Your properties are ready to connect once you enroll.</p>
                <Link href="/account/register?role=owner" className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-emerald-950 no-underline transition hover:bg-emerald-300">
                  <ArrowRight className="h-4 w-4" /> Get started
                </Link>
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}

function PricingFact({ icon: Icon, label, value, detail }: { icon: typeof Clock3; label: string; value: string; detail: string }) {
  return <div className="flex items-center gap-3 border-b border-emerald-100 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></span><div><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</p><p className="text-base font-bold text-neutral-900">{value}</p><p className="text-[10px] text-neutral-500">{detail}</p></div></div>;
}

function SetupStep({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4"><span className="text-[10px] font-bold tracking-widest text-emerald-300">{number}</span><p className="mt-2 text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-emerald-50/60">{text}</p></div>;
}
