"use client";

import { useState, type ComponentType } from "react";
import {
  ArrowRight,
  BarChart3,
  BedDouble,
  Building2,
  CalendarDays,
  Check,
  CheckCircle2,
  CircleDollarSign,
  Clock3,
  Hotel,
  Loader2,
  ReceiptText,
  ShieldCheck,
  Sparkles,
  Users,
  WalletCards,
} from "lucide-react";
import { useNrms } from "./NrmsProvider";

type OwnerMode = "CONNECT" | "RUN";

const MODULES: Array<{
  title: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  tone: string;
}> = [
  {
    title: "Unified room calendar",
    description: "See NoLSAF bookings, external stays and room blocks together without double-selling inventory.",
    icon: CalendarDays,
    tone: "bg-blue-50 text-blue-700",
  },
  {
    title: "Front desk operations",
    description: "Record arrivals, assign rooms, check guests in and complete checkout from one workspace.",
    icon: Hotel,
    tone: "bg-emerald-50 text-emerald-700",
  },
  {
    title: "Guest and stay records",
    description: "Keep guest details, reservation history, payments and balances organized for your team.",
    icon: Users,
    tone: "bg-violet-50 text-violet-700",
  },
  {
    title: "Transparent PAYG billing",
    description: "Track every chargeable external room-night, statement and payment token in a clear ledger.",
    icon: ReceiptText,
    tone: "bg-amber-50 text-amber-700",
  },
];

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

export default function NrmsActivationScreen() {
  const { activate, enrollment, properties, usagePolicy } = useNrms();
  const [mode, setMode] = useState<OwnerMode>("RUN");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const activeCopy = MODE_COPY[mode];
  const policyCurrency = usagePolicy?.currency || "";
  const roomNightPrice = usagePolicy ? Number(usagePolicy.roomNightPrice).toLocaleString() : "Configured at activation";
  const trialDays = usagePolicy?.trialDays;

  const onActivate = async () => {
    setBusy(true);
    setMessage(null);
    const result = await activate();
    if (!result.ok) setMessage(result.message || "Activation failed");
    setBusy(false);
  };

  return (
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

            {message && <div role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{message}</div>}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <button type="button" onClick={onActivate} disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-neutral-950 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-neutral-900/15 transition hover:-translate-y-0.5 hover:bg-emerald-700 disabled:pointer-events-none disabled:opacity-60">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {busy ? "Activating workspace…" : trialDays ? `Start ${trialDays}-day free trial` : "Activate workspace"}
                {!busy && <ArrowRight className="h-4 w-4" />}
              </button>
              <p className="text-xs leading-5 text-neutral-500">No card required<br className="hidden sm:block" /> Activate properties when ready</p>
            </div>

            {enrollment && enrollment.status !== "TRIAL" && enrollment.status !== "ACTIVE" && (
              <p className="mt-4 text-xs text-neutral-500">Your previous enrollment is {enrollment.status.toLowerCase()}. Contact NoLSAF support to reactivate it.</p>
            )}
          </div>

          <WorkspacePreview />
        </div>

        <div className="mt-12 grid overflow-hidden rounded-2xl border border-emerald-100 bg-white/80 shadow-sm sm:grid-cols-3">
          <PricingFact icon={Clock3} label="Free trial" value={trialDays ? `${trialDays} days` : "Policy controlled"} detail="for every activated property" />
          <PricingFact icon={CircleDollarSign} label="After trial" value={usagePolicy ? `${policyCurrency} ${roomNightPrice}` : roomNightPrice} detail="per completed external room-night" />
          <PricingFact icon={WalletCards} label="NoLSAF bookings" value={usagePolicy ? `${policyCurrency} 0 NRMS fee` : "No NRMS usage fee"} detail="your normal commission remains" />
        </div>

        <section className="mt-14">
          <div className="max-w-2xl">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">A complete owner workspace</p>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-neutral-950 sm:text-3xl">Everything arranged around the stay</h2>
            <p className="mt-2 text-sm leading-6 text-neutral-600">Start with the essentials today and keep every operational record connected as NRMS grows.</p>
          </div>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map(({ title, description, icon: Icon, tone }) => (
              <article key={title} className="rounded-2xl border border-neutral-200/80 bg-white p-5 transition hover:-translate-y-1 hover:border-emerald-200 hover:shadow-[0_16px_35px_-24px_rgba(6,78,59,0.5)]">
                <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${tone}`}><Icon className="h-5 w-5" /></span>
                <h3 className="mt-4 text-sm font-bold text-neutral-900">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-neutral-500">{description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-12 rounded-[24px] bg-[#082f2a] px-5 py-6 text-white sm:px-7 sm:py-7">
          <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-emerald-300">What happens next</p>
              <h2 className="mt-2 text-2xl font-bold tracking-tight">Go live at your own pace.</h2>
              <p className="mt-2 text-sm leading-6 text-emerald-50/70">Enrollment opens the workspace. Your 45-day trial only starts when you activate a property.</p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <SetupStep number="01" title="Open NRMS" text="Activate your owner workspace." />
              <SetupStep number="02" title="Confirm rooms" text="Import or arrange room inventory." />
              <SetupStep number="03" title="Activate property" text="Start the trial and operations." />
            </div>
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-white/10 pt-5">
            <p className="flex items-center gap-2 text-xs text-emerald-50/75"><BarChart3 className="h-4 w-4 text-emerald-300" /> {properties.length ? `${properties.length} ${properties.length === 1 ? "property" : "properties"} ready to connect` : "You can add a property before or after enrollment"}</p>
            <button type="button" onClick={onActivate} disabled={busy} className="inline-flex items-center gap-2 rounded-xl bg-emerald-400 px-4 py-2.5 text-sm font-bold text-emerald-950 transition hover:bg-emerald-300 disabled:opacity-60">{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Activate NRMS</button>
          </div>
        </section>
      </div>
    </div>
  );
}

function WorkspacePreview() {
  const days = ["Mon 14", "Tue 15", "Wed 16", "Thu 17", "Fri 18"];
  return (
    <div className="relative mx-auto w-full max-w-[580px] lg:mr-0">
      <div className="absolute -inset-4 rounded-[32px] bg-gradient-to-br from-emerald-300/30 via-white/20 to-teal-200/30 blur-2xl" />
      <div className="relative overflow-hidden rounded-[26px] border border-white/70 bg-[#0b2926] p-2 shadow-[0_35px_80px_-35px_rgba(4,47,46,0.8)]">
        <div className="rounded-[20px] bg-[#f8faf9] p-3 sm:p-4">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-200 pb-3">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-600 text-white"><BedDouble className="h-4 w-4" /></span>
              <div><p className="text-xs font-bold text-neutral-900">NRMS workspace</p><p className="text-[10px] text-neutral-400">Workspace preview · illustrative data</p></div>
            </div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live inventory</span>
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <PreviewMetric label="Arrivals" value="06" accent="text-blue-700" />
            <PreviewMetric label="In house" value="18" accent="text-emerald-700" />
            <PreviewMetric label="Departures" value="04" accent="text-violet-700" />
          </div>

          <div className="mt-3 overflow-hidden rounded-xl border border-neutral-200 bg-white">
            <div className="grid grid-cols-[72px_repeat(5,minmax(42px,1fr))] border-b border-neutral-100 bg-neutral-50 text-[8px] font-semibold text-neutral-400">
              <div className="px-2 py-2">ROOM</div>{days.map((day) => <div key={day} className="border-l border-neutral-100 px-1 py-2 text-center">{day}</div>)}
            </div>
            <PreviewRow room="A-101" cells={[null, "nolsaf", "nolsaf", null, "block"]} />
            <PreviewRow room="A-102" cells={["external", "external", null, "nolsaf", "nolsaf"]} />
            <PreviewRow room="B-201" cells={[null, "block", null, "external", "external"]} />
            <PreviewRow room="B-202" cells={["nolsaf", "nolsaf", "nolsaf", null, null]} />
          </div>

          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <div className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between"><p className="text-[10px] font-bold text-neutral-800">Today&apos;s front desk</p><span className="text-[9px] text-emerald-700">View all</span></div>
              <div className="mt-2 space-y-2">
                <GuestLine initials="AM" name="Amina M." detail="Arriving · A-101" color="bg-blue-100 text-blue-700" />
                <GuestLine initials="JK" name="Joseph K." detail="In house · B-202" color="bg-emerald-100 text-emerald-700" />
              </div>
            </div>
            <div className="rounded-xl bg-emerald-600 p-3 text-white">
              <div className="flex items-start justify-between"><div><p className="text-[9px] font-semibold text-emerald-100">Availability health</p><p className="mt-1 text-xl font-bold">Synced</p></div><ShieldCheck className="h-5 w-5 text-emerald-200" /></div>
              <p className="mt-3 text-[9px] leading-4 text-emerald-50/80">NoLSAF bookings and external stays are sharing one inventory view.</p>
            </div>
          </div>
        </div>
      </div>
      <div className="absolute -bottom-4 -left-3 hidden items-center gap-2 rounded-xl border border-emerald-100 bg-white px-3 py-2 shadow-xl sm:flex"><span className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-50"><CheckCircle2 className="h-4 w-4 text-emerald-600" /></span><div><p className="text-[9px] text-neutral-400">Inventory update</p><p className="text-[10px] font-bold text-neutral-800">Duplicate booking prevented</p></div></div>
    </div>
  );
}

function PreviewMetric({ label, value, accent }: { label: string; value: string; accent: string }) {
  return <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5"><p className="text-[9px] text-neutral-400">{label}</p><p className={`mt-1 text-lg font-bold ${accent}`}>{value}</p></div>;
}

function PreviewRow({ room, cells }: { room: string; cells: Array<"nolsaf" | "external" | "block" | null> }) {
  const colors = { nolsaf: "bg-blue-100 border-blue-200", external: "bg-emerald-100 border-emerald-200", block: "bg-neutral-200 border-neutral-300" };
  return <div className="grid grid-cols-[72px_repeat(5,minmax(42px,1fr))] border-b border-neutral-100 last:border-b-0"><div className="px-2 py-2 text-[9px] font-bold text-neutral-600">{room}</div>{cells.map((cell, index) => <div key={index} className="border-l border-neutral-100 p-1.5">{cell && <span className={`block h-4 rounded border ${colors[cell]}`} />}</div>)}</div>;
}

function GuestLine({ initials, name, detail, color }: { initials: string; name: string; detail: string; color: string }) {
  return <div className="flex items-center gap-2"><span className={`flex h-6 w-6 items-center justify-center rounded-full text-[8px] font-bold ${color}`}>{initials}</span><div><p className="text-[9px] font-bold text-neutral-800">{name}</p><p className="text-[8px] text-neutral-400">{detail}</p></div></div>;
}

function PricingFact({ icon: Icon, label, value, detail }: { icon: ComponentType<{ className?: string }>; label: string; value: string; detail: string }) {
  return <div className="flex items-center gap-3 border-b border-emerald-100 p-4 last:border-b-0 sm:border-b-0 sm:border-r sm:last:border-r-0 sm:p-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700"><Icon className="h-5 w-5" /></span><div><p className="text-[10px] font-bold uppercase tracking-wider text-neutral-400">{label}</p><p className="text-base font-bold text-neutral-900">{value}</p><p className="text-[10px] text-neutral-500">{detail}</p></div></div>;
}

function SetupStep({ number, title, text }: { number: string; title: string; text: string }) {
  return <div className="rounded-xl border border-white/10 bg-white/[0.06] p-4"><span className="text-[10px] font-bold tracking-widest text-emerald-300">{number}</span><p className="mt-2 text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-emerald-50/60">{text}</p></div>;
}
