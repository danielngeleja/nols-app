"use client";
import { useEffect, useState } from "react";
import apiClient from "@/lib/apiClient";
import GuestCodeRequestDialog from "@/components/owner-bookings/GuestCodeRequestDialog";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowRight, BedDouble, CalendarCheck2, CalendarClock, CalendarX2, CircleDollarSign,
  Clock, FileText, Globe2, Lock, LogOut, Phone, ScanLine, ShieldAlert, UserRound, Wallet,
  KeyRound,
} from "lucide-react";

// Use same-origin calls + secure httpOnly cookie session.
const api = apiClient;
const TZ = "Africa/Dar_es_Salaam";
const DAY = 86_400_000;

type Tone = {
  key: string;
  title: string;
  stamp: string;
  Icon: typeof Clock;
  stub: string;
  label: string;
  ink: string;
  wash: string;
  bar: string;
  today: string;
};

/** One look per booking status, so the headline can never disagree with the status. */
function toneFor(status: string): Tone {
  switch (String(status || "").toUpperCase()) {
    case "CHECKED_IN":
      return {
        key: "in", title: "In house", stamp: "IN HOUSE", Icon: CalendarCheck2,
        stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#0f8a7e_0%,#02665e_42%,#013c37_100%)]",
        label: "text-[#9fd8cc]", ink: "text-[#02665e] border-[#02665e]", wash: "from-emerald-50/70",
        bar: "bg-[#02665e]", today: "text-[#02665e]",
      };
    case "CHECKED_OUT":
      return {
        key: "out", title: "Checked out", stamp: "COMPLETED", Icon: LogOut,
        stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#0b4b44_0%,#012a26_55%,#00140f_100%)]",
        label: "text-[#9fd8cc]", ink: "text-slate-700 border-slate-600", wash: "from-slate-50",
        bar: "bg-slate-700", today: "text-slate-600",
      };
    case "CANCELED":
    case "CANCELLED":
      return {
        key: "cancel", title: "Cancelled", stamp: "CANCELLED", Icon: CalendarX2,
        stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#c0262d_0%,#8a1c22_40%,#3d0a0e_100%)]",
        label: "text-rose-200/90", ink: "text-rose-700 border-rose-600", wash: "from-rose-50/80",
        bar: "bg-[repeating-linear-gradient(135deg,#fda4af_0_6px,#fecdd3_6px_12px)]", today: "text-rose-700",
      };
    case "NEW":
    case "PENDING":
      return {
        key: "unpaid", title: "Awaiting payment", stamp: "UNPAID", Icon: CircleDollarSign,
        stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#475569_0%,#1e293b_45%,#0b1120_100%)]",
        label: "text-slate-300", ink: "text-slate-600 border-slate-500", wash: "from-slate-50",
        bar: "bg-slate-400", today: "text-slate-600",
      };
    default:
      return {
        key: "await", title: "Awaiting arrival", stamp: "CONFIRMED", Icon: CalendarClock,
        stub: "bg-[radial-gradient(130%_90%_at_0%_0%,#d97706_0%,#92400e_45%,#451a03_100%)]",
        label: "text-amber-200/90", ink: "text-amber-700 border-amber-600", wash: "from-amber-50/80",
        bar: "bg-[repeating-linear-gradient(135deg,#f59e0b_0_6px,#fbbf24_6px_12px)]", today: "text-amber-700",
      };
  }
}

export default function BookingDetail() {
  const routeParams = useParams<{ id?: string | string[] }>();
  const idParam = Array.isArray(routeParams?.id) ? routeParams?.id?.[0] : routeParams?.id;
  const router = useRouter();
  const [b, setB] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadedAt, setLoadedAt] = useState(0);
  const [lostCodeOpen, setLostCodeOpen] = useState(false);
  const [invMeta, setInvMeta] = useState<{
    exists: boolean; invoiceId: number | null; invoiceReference?: string | null; status?: string | null;
  } | null>(null);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      api.get(`/api/owner/bookings/${idParam}`),
      api.get(`/api/owner/invoices/for-booking/${idParam}`),
    ])
      .then(([br, ir]) => {
        if (!mounted) return;
        setB(br.data);
        setLoadedAt(Date.now());
        if (/^\d+$/.test(String(idParam)) && br.data?.bookingReference) {
          router.replace(`/owner/bookings/checked-in/${encodeURIComponent(br.data.bookingReference)}`);
        }
        setInvMeta({
          exists: Boolean(ir.data?.exists),
          invoiceId: ir.data?.invoiceId ? Number(ir.data.invoiceId) : null,
          invoiceReference: ir.data?.invoiceReference ?? null,
          status: ir.data?.status ?? null,
        });
        setLoading(false);
      })
      .catch((err: any) => {
        if (!mounted) return;
        console.warn("Failed to load booking or invoice meta", err);
        setLoading(false);
      });

    return () => { mounted = false; };
  }, [idParam, router]);

  if (loading) {
    return (
      <div className="w-full space-y-5 pb-12">
        <div className="h-5 w-32 animate-pulse rounded-full bg-slate-200" />
        <div className="h-[340px] animate-pulse rounded-3xl bg-slate-200" />
      </div>
    );
  }

  if (!b) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center px-4">
        <div className="max-w-sm text-center">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-rose-50 text-rose-600">
            <ShieldAlert className="h-7 w-7" aria-hidden />
          </span>
          <h2 className="m-0 mt-4 text-xl font-bold text-slate-900">Booking not found</h2>
          <p className="m-0 mt-2 text-sm leading-relaxed text-slate-500">This booking does not exist or you do not have access to it.</p>
          <Link
            href="/owner/bookings"
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-xl bg-[#012a26] px-5 text-sm font-semibold text-white no-underline hover:bg-[#02665e]"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden /> Back to bookings
          </Link>
        </div>
      </div>
    );
  }

  const status = String(b.status || "").toUpperCase();
  const tone = toneFor(status);
  const isCheckedIn = status === "CHECKED_IN";
  const guestName: string = b.guestName ?? b.user?.name ?? "Guest";
  const initials = guestName.trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "G";

  const fmtDay = (d: string | Date) =>
    new Date(d).toLocaleDateString("en-GB", { timeZone: TZ, weekday: "short", day: "2-digit", month: "short", year: "numeric" });
  const formatCurrency = (amount: number) => `TZS ${Math.round(Number(amount)).toLocaleString("en-US")}`;
  const titleCase = (v: string) => (v ? v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, " ") : v);
  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

  const baseAmount = (() => {
    const oba = Number(b?.ownerBaseAmount ?? 0);
    if (Number.isFinite(oba) && oba > 0) return oba;
    const total = Number(b?.totalAmount ?? 0);
    const transport = Number(b?.transportFare ?? 0);
    if (!Number.isFinite(total) || !Number.isFinite(transport)) return 0;
    return Math.max(0, total - transport);
  })();

  const start = new Date(b.checkIn).getTime();
  const end = new Date(b.checkOut).getTime();
  const nights = Number.isFinite(end - start) && end > start ? Math.max(1, Math.round((end - start) / DAY)) : 1;
  const pos = loadedAt && end > start ? (loadedAt - start) / (end - start) : null;
  const daysTo = loadedAt ? Math.ceil((start - loadedAt) / DAY) : 0;
  const daysSince = loadedAt ? Math.floor((loadedAt - end) / DAY) : 0;
  const todayLabel =
    pos === null ? null
      : pos < 0 ? (daysTo > 0 ? `Today, ${plural(daysTo, "day")} before check-in` : "Today, before check-in")
        : pos > 1 ? (daysSince > 0 ? `Today, ${plural(daysSince, "day")} after check-out` : "Today, after check-out")
          : `Today, night ${Math.min(nights, Math.max(1, Math.ceil(pos * nights)))} of ${nights}`;

  // The one line under the headline, specific to where this stay is.
  const summary =
    tone.key === "cancel" ? "This booking was cancelled. No check-in or payout will happen for it."
      : tone.key === "in" ? "The guest has arrived and the stay is in progress."
        : tone.key === "out" ? "The stay is finished."
          : tone.key === "unpaid" ? "The guest has not paid yet. It is not a confirmed booking."
            : pos !== null && pos > 1 ? "The check-out date has passed without a check-in."
              : "Paid and confirmed. Validate the guest's code when they arrive.";
  const canValidate = tone.key === "await" && pos !== null && pos >= 0 && pos <= 1;

  const facts = [
    { Icon: Phone, value: b.guestPhone ?? b.user?.phone },
    { Icon: Globe2, value: b.nationality },
    { Icon: UserRound, value: [b.sex, b.ageGroup].filter(Boolean).join(" · ") },
  ].filter((f) => f.value);

  return (
    <div id="owner-booking" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <style>{`
        #owner-booking, #owner-booking * { box-sizing: border-box; }
        @keyframes ob-rise { from { opacity: 0; transform: translateY(10px) } to { opacity: 1; transform: none } }
        #owner-booking .ob-rise { animation: ob-rise .35s cubic-bezier(.2,.7,.2,1) both; }
      `}</style>

      <Link href="/owner/bookings" className="inline-flex items-center gap-1.5 text-sm font-semibold text-slate-500 no-underline hover:text-[#02665e]">
        <ArrowLeft className="h-4 w-4" aria-hidden /> All bookings
      </Link>

      <article className="ob-rise relative flex flex-col overflow-hidden rounded-3xl bg-white shadow-[0_30px_70px_-42px_rgba(1,42,38,0.6)] ring-1 ring-slate-200 md:flex-row">
        {/* Stub */}
        <div className={`relative isolate flex flex-col justify-between gap-6 overflow-hidden p-6 text-white md:w-[300px] md:shrink-0 ${tone.stub}`}>
          <div
            className="pointer-events-none absolute inset-0 -z-10 opacity-[0.09]"
            style={{ backgroundImage: "radial-gradient(circle, #fff 1px, transparent 1px)", backgroundSize: "14px 14px" }}
            aria-hidden
          />
          <span className="pointer-events-none absolute -left-16 -top-16 -z-10 h-48 w-48 rounded-full bg-white/10 blur-2xl" aria-hidden />
          <tone.Icon className="pointer-events-none absolute -bottom-8 -right-8 -z-10 h-44 w-44 rotate-[-12deg] text-white/[0.07]" strokeWidth={1.25} aria-hidden />

          <div>
            <p className={`m-0 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] ${tone.label}`}>
              <span className="h-px w-5 bg-current opacity-60" aria-hidden />
              Guest stay
            </p>
            <span className="mt-5 grid h-14 w-14 place-items-center rounded-2xl bg-white/10 text-white shadow-[0_10px_30px_-12px_rgba(0,0,0,0.6)] ring-1 ring-inset ring-white/20 backdrop-blur-sm">
              <tone.Icon className="h-7 w-7" aria-hidden />
            </span>
            <h1 className="m-0 mt-5 text-[26px] font-bold leading-[1.1] tracking-tight text-white drop-shadow-sm">{tone.title}</h1>
            {tone.key === "await" && daysTo > 0 ? (
              <p className="m-0 mt-3 flex items-baseline gap-2">
                <span className="text-4xl font-bold tabular-nums leading-none text-white">{daysTo}</span>
                <span className={`text-xs font-semibold ${tone.label}`}>{daysTo === 1 ? "day to check-in" : "days to check-in"}</span>
              </p>
            ) : null}
            <p className="m-0 mt-3 text-[13px] leading-relaxed text-white/75">{summary}</p>
          </div>

          <div className="rounded-xl bg-black/15 px-3 py-2.5 ring-1 ring-inset ring-white/10">
            <p className={`m-0 text-[9px] font-semibold uppercase tracking-[0.18em] ${tone.label}`}>Reference</p>
            <p className="m-0 mt-1 break-all font-mono text-[11px] text-white/90">{b.bookingReference ?? "Not available"}</p>
          </div>
        </div>

        {/* Perforation */}
        <div className="relative hidden w-0 md:block" aria-hidden>
          <span className="absolute -left-3.5 -top-3.5 z-10 h-7 w-7 rounded-full bg-[#f4f5f4] shadow-[inset_0_-1px_0_rgba(15,23,42,0.08)]" />
          <span className="absolute -bottom-3.5 -left-3.5 z-10 h-7 w-7 rounded-full bg-[#f4f5f4] shadow-[inset_0_1px_0_rgba(15,23,42,0.08)]" />
          <span className="absolute inset-y-5 left-0 border-0 border-l-2 border-dashed border-slate-200" />
        </div>

        {/* Body */}
        <div className={`relative min-w-0 flex-1 bg-gradient-to-br ${tone.wash} via-white to-white p-6`}>
          <div
            className={`pointer-events-none absolute right-6 top-5 hidden rotate-[-9deg] select-none rounded-lg border-[3px] border-double px-3 py-1.5 text-center opacity-80 mix-blend-multiply sm:block ${tone.ink}`}
            aria-hidden
          >
            <p className="m-0 text-[15px] font-black uppercase leading-none tracking-[0.18em]">{tone.stamp}</p>
            <p className="m-0 mt-1 text-[8px] font-bold uppercase tracking-[0.3em] opacity-80">NoLSAF booking</p>
          </div>

          <div className="flex min-w-0 items-center gap-3.5 sm:pr-44">
            <span className="grid h-14 w-14 shrink-0 select-none place-items-center rounded-2xl bg-gradient-to-br from-slate-800 to-slate-950 text-lg font-bold text-white shadow-[0_10px_24px_-14px_rgba(15,23,42,0.9)]">
              {initials}
            </span>
            <div className="min-w-0">
              <p className="m-0 truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">{guestName}</p>
              <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-sm text-slate-500">
                <BedDouble className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                {b.property?.title ?? "Your property"}{b.property?.type ? ` · ${titleCase(b.property.type)}` : ""}
              </p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2">
            {facts.map((f) => (
              <span key={String(f.value)} className="inline-flex items-center gap-1.5 rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-700 ring-1 ring-slate-200">
                <f.Icon className="h-3.5 w-3.5 text-slate-400" aria-hidden />
                {f.value}
              </span>
            ))}
            <span className="ml-auto text-right">
              <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Your amount</span>
              <span className={`block text-lg font-bold tabular-nums ${tone.key === "cancel" ? "text-slate-400 line-through decoration-rose-400" : "text-[#02665e]"}`}>
                {baseAmount > 0 ? formatCurrency(baseAmount) : "Not set"}
              </span>
            </span>
          </div>

          {/* Stay timeline */}
          <div className="mt-5 rounded-2xl bg-white/80 p-4 ring-1 ring-slate-200/80 backdrop-blur-sm">
            <div className="flex items-end justify-between gap-3">
              <div>
                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Check-in</p>
                <p className="m-0 mt-0.5 text-sm font-bold text-slate-900">{fmtDay(b.checkIn)}</p>
              </div>
              <p className="m-0 hidden pb-0.5 text-xs font-semibold text-slate-500 sm:block">{plural(nights, "night")}</p>
              <div className="text-right">
                <p className="m-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Check-out</p>
                <p className="m-0 mt-0.5 text-sm font-bold text-slate-900">{fmtDay(b.checkOut)}</p>
              </div>
            </div>
            <div className="relative mt-4 h-2.5 rounded-full bg-slate-100 ring-1 ring-inset ring-slate-200">
              <div
                className={`absolute inset-y-0 left-0 rounded-full ${tone.bar}`}
                style={{ width: `${Math.round(Math.max(0, Math.min(1, pos ?? 0)) * 100)}%` }}
              />
              {pos !== null && (
                <span className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${Math.max(0, Math.min(1, pos)) * 100}%` }}>
                  <span className="block h-5 w-5 rounded-full border-[3px] border-solid border-white bg-slate-900 shadow-md" />
                </span>
              )}
            </div>
            {todayLabel ? <p className={`m-0 mt-2.5 text-[11px] font-semibold ${tone.today}`}>{todayLabel}</p> : null}
          </div>

          {/* Actions that fit this status */}
          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {canValidate && (
              <Link
                href="/owner/bookings/validate"
                className="group inline-flex h-12 flex-1 items-center justify-between gap-2 rounded-xl bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white no-underline shadow-[0_14px_30px_-18px_rgba(1,42,38,0.9)] transition hover:bg-[#02665e]"
              >
                Validate the guest&apos;s code
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26] transition group-hover:translate-x-0.5">
                  <ScanLine className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            )}

            {isCheckedIn && (invMeta?.exists ? (
              invMeta.invoiceReference ? (
                <Link
                  href={`/owner/invoices/${encodeURIComponent(invMeta.invoiceReference)}`}
                  className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50"
                >
                  <FileText className="h-4 w-4" aria-hidden /> View statement
                </Link>
              ) : (
                <span className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-slate-50 px-5 text-sm font-semibold text-slate-400 ring-1 ring-inset ring-slate-200">
                  <Lock className="h-4 w-4" aria-hidden /> Statement generated
                </span>
              )
            ) : (
              <Link
                href={`/owner/invoices/new?booking=${encodeURIComponent(b.bookingReference)}`}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50"
              >
                <FileText className="h-4 w-4" aria-hidden /> Generate invoice
              </Link>
            ))}

            {tone.key === "await" && b.bookingReference && (
              <button
                type="button"
                onClick={() => setLostCodeOpen(true)}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <KeyRound className="h-4 w-4" aria-hidden /> Guest lost their code?
              </button>
            )}

            {(isCheckedIn || tone.key === "out") && (
              <Link
                href="/owner/payouts/in-progress"
                className="group inline-flex h-12 flex-1 items-center justify-between gap-2 rounded-xl bg-[#012a26] pl-5 pr-2 text-sm font-bold text-white no-underline shadow-[0_14px_30px_-18px_rgba(1,42,38,0.9)] transition hover:bg-[#02665e]"
              >
                Follow the payout for this stay
                <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#5eead4] text-[#012a26] transition group-hover:translate-x-0.5">
                  <Wallet className="h-4 w-4" aria-hidden />
                </span>
              </Link>
            )}

            {tone.key === "cancel" && (
              <p className="m-0 flex flex-1 items-center gap-2.5 rounded-xl bg-rose-50 px-4 py-3 text-xs text-rose-900 ring-1 ring-inset ring-rose-200">
                <Lock className="h-4 w-4 shrink-0 opacity-70" aria-hidden />
                Nothing to do here. A cancelled booking cannot be checked in.
              </p>
            )}

            {!canValidate && !isCheckedIn && tone.key === "await" && (
              <Link
                href="/owner/bookings/validate"
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-solid border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50"
              >
                Open check-in validation <ArrowRight className="h-4 w-4" aria-hidden />
              </Link>
            )}
          </div>
        </div>
      </article>
      <GuestCodeRequestDialog
        open={lostCodeOpen}
        onClose={() => setLostCodeOpen(false)}
        preset={b.bookingReference ? { bookingReference: b.bookingReference, guestName, property: b.property?.title ?? null, checkIn: b.checkIn } : null}
      />
    </div>
  );
}
