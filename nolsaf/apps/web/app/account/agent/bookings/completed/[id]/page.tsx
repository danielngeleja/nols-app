"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import { ArrowLeft, CheckCircle2, ChevronRight, Loader2, Mail, Phone, Star } from "lucide-react";

const api = apiClient;

type TourItem = {
  source: "tour";
  id: string | number;
  bookingCode?: string | null;
  title?: string;
  description?: string | null;
  status?: string;
  paymentStatus?: string;
  payoutStatus?: string | null;
  payoutPaidAt?: string | null;
  operatorPayoutAmount?: number | null;
  createdAt?: string;
  tripDate?: string | null;
  endDate?: string | null;
  completedAt?: string | null;
  amountPaid?: number | null;
  currency?: string | null;
  tripType?: string | null;
  metadata?: any;
  requester?: {
    fullName?: string | null;
    email?: string | null;
    phone?: string | null;
    nationality?: string | null;
    travelerCount?: number | null;
  };
};

type CompletedItem = TourItem;

type RatingForm = {
  taskQuality: number;
  punctuality: number;
  attentionToDetail: number;
  communication: number;
  professionalism: number;
  comment: string;
};

const DEFAULT_RATING_FORM: RatingForm = {
  taskQuality: 0,
  punctuality: 0,
  attentionToDetail: 0,
  communication: 0,
  professionalism: 0,
  comment: "",
};

const RATING_ITEMS: Array<{ key: keyof Omit<RatingForm, "comment">; label: string; hint: string }> = [
  { key: "taskQuality", label: "Task quality", hint: "Was every package service delivered well?" },
  { key: "punctuality", label: "Punctuality", hint: "Pickups and activities on time" },
  { key: "attentionToDetail", label: "Attention to detail", hint: "The small things guests notice" },
  { key: "communication", label: "Communication", hint: "Briefings, updates and replies" },
  { key: "professionalism", label: "Professionalism", hint: "Conduct of the team on the ground" },
];

function prettyDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function prettyDateTime(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function ratingStepLabel(score: number): string {
  if (score >= 5) return "Best";
  if (score >= 4) return "Excellent";
  if (score >= 3) return "Good";
  if (score >= 2) return "Fair";
  if (score >= 1) return "Poor";
  return "Unmarked";
}

export default function CompletedBookingDetailPage() {
  const params = useParams();

  const id = String((params as any)?.id || "").trim();

  const [loading, setLoading] = useState(true);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [item, setItem] = useState<CompletedItem | null>(null);
  const [ratingForm, setRatingForm] = useState<RatingForm>(DEFAULT_RATING_FORM);
  const [ratingSaving, setRatingSaving] = useState(false);
  const [ratingMessage, setRatingMessage] = useState<string | null>(null);

  const ratingStorageKey = useMemo(() => {
    if (!item) return "";
    return `agent-completed-rating:${item.source}:${String(item.id)}`;
  }, [item]);

  useEffect(() => {
    let alive = true;

    async function loadTour(targetId: string): Promise<TourItem | null> {
      try {
        const res = await api.get(`/api/agent/tour-bookings/${encodeURIComponent(targetId)}`);
        const data = (res as any)?.data?.item ?? null;
        if (!data) return null;
        return { ...data, source: "tour" as const };
      } catch (e: any) {
        const status = Number(e?.response?.status || 0);
        if (status === 404 || status === 400) return null;
        throw e;
      }
    }

    (async () => {
      try {
        setLoading(true);
        setError(null);
        setAuthRequired(false);
        setItem(null);

        if (!id) {
          setError("This completed record link is not valid.");
          return;
        }

        const session = await fetchAccountSession();
        if (!session.ok) {
          setAuthRequired(true);
          return;
        }

        // Assignments (retired Plan With Us requests) no longer feed this page.
        const tourItem = await loadTour(id);
        if (tourItem) {
          if (alive) setItem(tourItem);
          return;
        }

        if (alive) setError("We could not find this completed trip.");
      } catch (e: any) {
        if (!alive) return;
        if (Number(e?.response?.status || 0) === 401) {
          setAuthRequired(true);
          return;
        }
        setError(String(e?.response?.data?.error || "Could not load completed details."));
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [id]);

  const overallRating = useMemo(() => {
    const scores = RATING_ITEMS.map((r) => ratingForm[r.key]).filter((n) => n > 0);
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [ratingForm]);
  const markedCount = RATING_ITEMS.filter((r) => ratingForm[r.key] > 0).length;

  const completedAtValue = useMemo(() => {
    if (!item) return null;
    if (item.completedAt) return item.completedAt;
    if (item.source !== "tour") return null;

    const md = (item as TourItem).metadata || {};
    const lockedAt = String(md?.activityProgress?.lockedAt || "").trim();
    if (lockedAt) return lockedAt;

    const checks = md?.activityProgress?.checks;
    if (checks && typeof checks === "object") {
      const candidates = Object.values(checks as Record<string, any>)
        .map((val) => {
          if (typeof val === "string") return val.trim();
          if (val && typeof val === "object") return String((val as any).checkedAt || "").trim();
          return "";
        })
        .filter(Boolean)
        .map((iso) => ({ iso, ts: new Date(iso).getTime() }))
        .filter((row) => Number.isFinite(row.ts))
        .sort((a, b) => b.ts - a.ts);

      if (candidates.length > 0) return candidates[0].iso;
    }

    return null;
  }, [item]);

  const tripEndValue = useMemo(() => {
    if (!item || item.source !== "tour") return null;
    return item.endDate || completedAtValue || item.tripDate || null;
  }, [item, completedAtValue]);

  useEffect(() => {
    if (!item) return;

    let seeded = { ...DEFAULT_RATING_FORM };

    try {
      if (item.source === "tour") {
        const md = (item as TourItem).metadata || {};
        const serverRating = md?.agentCompletionRating;
        if (serverRating && typeof serverRating === "object") {
          seeded = {
            taskQuality: Number(serverRating.taskQuality) || 0,
            punctuality: Number(serverRating.punctuality) || 0,
            attentionToDetail: Number(serverRating.attentionToDetail) || 0,
            communication: Number(serverRating.communication) || 0,
            professionalism: Number(serverRating.professionalism) || 0,
            comment: String(serverRating.comment || ""),
          };
        }
      }

      if (ratingStorageKey) {
        const raw = localStorage.getItem(ratingStorageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === "object") {
            seeded = {
              taskQuality: Number(parsed.taskQuality) || seeded.taskQuality,
              punctuality: Number(parsed.punctuality) || seeded.punctuality,
              attentionToDetail: Number(parsed.attentionToDetail) || seeded.attentionToDetail,
              communication: Number(parsed.communication) || seeded.communication,
              professionalism: Number(parsed.professionalism) || seeded.professionalism,
              comment: String(parsed.comment || seeded.comment || ""),
            };
          }
        }
      }
    } catch {
      // ignore local rating parse errors
    }

    setRatingForm(seeded);
  }, [item, ratingStorageKey]);

  async function saveRating() {
    if (!item) return;
    try {
      setRatingSaving(true);
      setRatingMessage(null);

      if (RATING_ITEMS.some((r) => ratingForm[r.key] < 1 || ratingForm[r.key] > 5)) {
        setRatingMessage("Please mark each rating item before saving.");
        return;
      }

      const payload = {
        taskQuality: ratingForm.taskQuality,
        punctuality: ratingForm.punctuality,
        attentionToDetail: ratingForm.attentionToDetail,
        communication: ratingForm.communication,
        professionalism: ratingForm.professionalism,
        comment: ratingForm.comment.trim() || undefined,
      };

      if (item.source === "tour") {
        await api.post(`/api/agent/tour-bookings/${encodeURIComponent(String(item.id))}/completion-rating`, payload);
      }

      if (ratingStorageKey) {
        try { localStorage.setItem(ratingStorageKey, JSON.stringify(payload)); } catch {}
      }

      setRatingMessage("Rating saved successfully.");
    } catch (e: any) {
      setRatingMessage(String(e?.response?.data?.error || "Could not save rating. Please try again."));
    } finally {
      setRatingSaving(false);
    }
  }

  // ── Presentation model ────────────────────────────────────────────────
  const [tourName, destination] = (() => {
    const parts = String(item?.title || "Completed trip").split(" • ");
    return [parts[0], parts[1] || null] as const;
  })();
  const placeCode = (String(destination || tourName).replace(/[^A-Za-z]/g, "").slice(0, 3) || "TRP").toUpperCase();
  const guestName = item?.requester?.fullName || "Guest";
  const travellers = Number(item?.requester?.travelerCount || 0);
  const currency = item?.currency || "TZS";
  const tripDays = (() => {
    if (!item?.tripDate || !item?.endDate) return null;
    const a = new Date(item.tripDate); a.setHours(0, 0, 0, 0);
    const b = new Date(item.endDate); b.setHours(0, 0, 0, 0);
    const d = Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1;
    return d > 0 ? d : null;
  })();
  const payoutTone = String(item?.payoutStatus || "").toUpperCase();
  const guestPhone = item?.requester?.phone || null;
  const guestEmail = item?.requester?.email || null;

  return (
    <div id="completed-booking-page" className="w-full min-w-0 space-y-5 py-2 sm:py-4">
      <style>{"#completed-booking-page, #completed-booking-page * { box-sizing: border-box; }"}</style>

      <div className="flex items-center justify-between gap-3">
        <Link
          href="/account/agent/bookings?stage=completed"
          className="inline-flex h-9 items-center gap-1.5 rounded-full border border-solid border-slate-300 bg-white px-3.5 text-[13px] font-semibold text-slate-700 no-underline shadow-[0_1px_2px_rgba(15,23,42,0.05)] transition-colors hover:border-[#02665e] hover:text-[#02665e]"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Completed trips
        </Link>
        {item?.bookingCode ? <span className="min-w-0 truncate font-mono text-[12px] text-slate-400">{item.bookingCode}</span> : null}
      </div>

      {loading ? (
        <div className="space-y-5" aria-busy="true">
          <span role="status" className="sr-only">Loading completed trip</span>
          <div className="h-56 animate-pulse rounded-3xl bg-slate-200" />
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
            <div className="h-96 animate-pulse rounded-3xl border border-solid border-slate-200 bg-white" />
            <div className="h-72 animate-pulse rounded-3xl border border-solid border-slate-200 bg-white" />
          </div>
        </div>
      ) : authRequired ? (
        <div className="rounded-3xl border border-solid border-slate-200 bg-white p-6">
          <p className="m-0 text-sm font-bold text-slate-900">Sign in required</p>
          <p className="m-0 mt-1 text-sm text-slate-600">Please sign in to view completed details.</p>
          <Link href="/account/login" className="mt-4 inline-flex h-10 items-center rounded-full bg-[#02665e] px-5 text-[13px] font-bold text-white no-underline">Sign in</Link>
        </div>
      ) : error ? (
        <div role="alert" className="rounded-2xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <div className="font-bold">Could not open this trip</div>
          <div className="mt-1">{error}</div>
        </div>
      ) : item ? (
        <>
          {/* ── Archived ticket, stamped completed ── */}
          <section aria-label="Completed trip" className="relative overflow-hidden rounded-3xl border border-solid border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_18px_40px_-32px_rgba(15,23,42,0.45)]">
            <div className="grid md:grid-cols-[minmax(0,1fr)_16rem] lg:grid-cols-[minmax(0,1fr)_19rem]">
              <div className="min-w-0 p-5 sm:p-7">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11.5px] font-bold text-emerald-700">
                  <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                  Trip completed
                </span>
                <div className="mt-4 flex items-end gap-3 sm:gap-4">
                  <span className="text-[40px] font-black leading-none tracking-[0.08em] text-slate-300 sm:text-[56px]">{placeCode}</span>
                  <div className="min-w-0 pb-1">
                    <h1 className="m-0 break-words text-[20px] font-bold leading-tight text-slate-900 sm:text-[24px]">{tourName}</h1>
                    <p className="m-0 mt-0.5 truncate text-[13px] text-slate-500">
                      {[destination, item.tripType, `for ${guestName}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                </div>
                <dl className="m-0 mt-6 grid grid-cols-2 gap-x-4 gap-y-4 border-0 border-t border-solid border-slate-100 pt-5 sm:grid-cols-4">
                  {[
                    { label: "Started", value: prettyDate(item.tripDate) },
                    { label: "Ended", value: prettyDate(tripEndValue) },
                    { label: tripDays ? "Duration" : "Travellers", value: tripDays ? `${tripDays} ${tripDays === 1 ? "day" : "days"} · ${travellers || "-"} pax` : travellers ? String(travellers) : "-" },
                    { label: "Value", value: item.amountPaid != null ? `${currency} ${Number(item.amountPaid).toLocaleString("en-US")}` : "-" },
                  ].map((fact) => (
                    <div key={fact.label} className="min-w-0">
                      <dt className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{fact.label}</dt>
                      <dd className="m-0 mt-1 truncate text-[15px] font-bold tabular-nums text-slate-900" title={fact.value}>{fact.value}</dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* The stamp: a record that is closed, not a live pass. */}
              <div className="flex items-center justify-center border-0 border-t-2 border-dashed border-slate-200 bg-slate-50/60 px-5 py-7 md:border-l-2 md:border-t-0">
                <div className="-rotate-[7deg] select-none rounded-[20px] border-[3px] border-solid border-emerald-600/80 p-1 text-emerald-700" aria-label={`Completed on ${prettyDate(completedAtValue)}`}>
                  <div className="rounded-2xl border border-solid border-emerald-600/60 px-6 py-3 text-center">
                    <div className="text-[10px] font-bold uppercase tracking-[0.3em] text-emerald-700/80">NoLSAF operator record</div>
                    <div className="mt-1 text-[30px] font-black uppercase leading-none tracking-[0.12em]">Completed</div>
                    <div className="mt-1.5 text-[12px] font-bold uppercase tracking-[0.18em] tabular-nums">{prettyDate(completedAtValue)}</div>
                    <div className="mt-2 border-0 border-t border-dashed border-emerald-600/40 pt-1.5 text-[11px] font-semibold text-emerald-700/80">
                      {overallRating > 0 ? `Self rating ${overallRating.toFixed(1)} · ${ratingStepLabel(overallRating)}` : "Awaiting your rating"}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
            <div className="min-w-0 space-y-5">
              {/* ── Rate this trip ── */}
              <Panel
                title="Rate how this trip went"
                subtitle="Your honest review of the delivery. It builds your operator record."
                action={
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <div className={`text-[22px] font-black leading-none tabular-nums ${overallRating > 0 ? "text-slate-900" : "text-slate-300"}`}>{overallRating > 0 ? overallRating.toFixed(1) : "0.0"}</div>
                      <div className="mt-0.5 text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{markedCount}/{RATING_ITEMS.length} marked</div>
                    </div>
                  </div>
                }
              >
                <div className="mb-4 flex gap-1" aria-hidden>
                  {RATING_ITEMS.map((row) => (
                    <span key={row.key} className={`h-1.5 flex-1 rounded-full ${ratingForm[row.key] > 0 ? "bg-amber-400" : "bg-slate-100"}`} />
                  ))}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {RATING_ITEMS.map((row) => {
                    const value = ratingForm[row.key];
                    return (
                      <div key={row.key} className={`min-w-0 rounded-2xl border border-solid p-3.5 transition-colors ${value ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="text-[13.5px] font-bold text-slate-900">{row.label}</div>
                            <div className="truncate text-[12px] text-slate-500">{row.hint}</div>
                          </div>
                          <span className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${value ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-400"}`}>
                            {value ? `${value}/5 · ${ratingStepLabel(value)}` : "Not rated"}
                          </span>
                        </div>
                        <div className="mt-2.5 flex items-center gap-0.5" role="radiogroup" aria-label={row.label}>
                          {[1, 2, 3, 4, 5].map((score) => (
                            <button
                              key={score}
                              type="button"
                              role="radio"
                              aria-checked={value === score}
                              onClick={() => setRatingForm((prev) => ({ ...prev, [row.key]: prev[row.key] === score ? 0 : score }))}
                              className={`inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg border-0 bg-transparent p-0 transition-colors ${score <= value ? "text-amber-400" : "text-slate-200 hover:text-amber-200"}`}
                              aria-label={`${row.label}: ${score} of 5`}
                              title={`${score}/5 · ${ratingStepLabel(score)}`}
                            >
                              <Star className="h-6 w-6" fill="currentColor" aria-hidden />
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                <label htmlFor="completed-rating-comment" className="flex min-w-0 flex-col rounded-2xl border border-dashed border-slate-300 p-3.5">
                  <span className="mb-1.5 block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-500">Notes for the record</span>
                  <textarea
                    id="completed-rating-comment"
                    value={ratingForm.comment}
                    onChange={(e) => setRatingForm((prev) => ({ ...prev, comment: e.target.value }))}
                    rows={4}
                    maxLength={1000}
                    placeholder="What went well, what slowed you down, what you would change next time."
                    className="block min-h-[84px] w-full flex-1 resize-y rounded-xl border border-solid border-slate-300 bg-white px-3.5 py-3 text-[13.5px] leading-relaxed text-slate-900 shadow-[0_1px_2px_rgba(15,23,42,0.05)] placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(2,102,94,0.14)]"
                    style={{ fontFamily: "inherit" }}
                  />
                  <span className="mt-1 block text-right text-[11px] text-slate-400">{ratingForm.comment.length}/1000</span>
                </label>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <button
                    type="button"
                    onClick={saveRating}
                    disabled={ratingSaving}
                    style={{ fontFamily: "inherit" }}
                    className="inline-flex h-10 cursor-pointer items-center justify-center gap-1.5 rounded-full border-0 bg-[#02665e] px-5 text-[13px] font-bold text-white transition-colors hover:bg-[#014d47] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {ratingSaving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                    {ratingSaving ? "Saving..." : "Save rating"}
                  </button>
                  {ratingMessage ? (
                    <p className={`m-0 text-[12.5px] font-semibold ${ratingMessage.includes("success") ? "text-emerald-700" : "text-rose-700"}`}>{ratingMessage}</p>
                  ) : null}
                </div>
              </Panel>

              {item.description ? (
                <Panel title="Booking notes">
                  <p className="m-0 whitespace-pre-wrap text-[13.5px] leading-relaxed text-slate-700">{item.description}</p>
                </Panel>
              ) : null}
            </div>

            <aside className="min-w-0 space-y-5">
              <Panel title="Guest">
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-[16px] font-black text-white">
                    {initials(guestName)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-[15px] font-bold text-slate-900">{guestName}</div>
                    <div className="truncate text-[12.5px] text-slate-500">
                      {[item.requester?.nationality, travellers ? `${travellers} ${travellers === 1 ? "traveller" : "travellers"}` : null].filter(Boolean).join(" · ") || "Lead traveller"}
                    </div>
                  </div>
                </div>
                <div className="mt-4 divide-y divide-solid divide-slate-200 overflow-hidden rounded-2xl border border-solid border-slate-200 [&>*]:border-x-0">
                  <ContactRow href={guestPhone ? `tel:${guestPhone}` : undefined} icon={Phone} label="Phone" value={guestPhone} />
                  <ContactRow href={guestEmail ? `mailto:${guestEmail}` : undefined} icon={Mail} label="Email" value={guestEmail} />
                </div>
              </Panel>

              <Panel title="Record">
                <dl className="m-0 divide-y divide-solid divide-slate-200 [&>*]:border-x-0">
                  <SummaryRow label="Tour code" value={<span className="font-mono">{item.bookingCode || "-"}</span>} />
                  <SummaryRow label="Booked on" value={prettyDate(item.createdAt)} />
                  <SummaryRow label="Trip dates" value={tripEndValue && prettyDate(tripEndValue) !== prettyDate(item.tripDate) ? `${prettyDate(item.tripDate)} to ${prettyDate(tripEndValue)}` : prettyDate(item.tripDate)} />
                  <SummaryRow label="Completed" value={prettyDateTime(completedAtValue)} />
                  <SummaryRow label="Guest payment" value={<Chip tone="emerald">{String(item.paymentStatus || "-").replace(/_/g, " ").toLowerCase()}</Chip>} />
                  <SummaryRow
                    label="Your payout"
                    value={
                      <Chip tone={payoutTone === "PAID" ? "emerald" : payoutTone.includes("RECOVER") || payoutTone.includes("HOLD") ? "rose" : "amber"}>
                        {payoutTone ? payoutTone.replace(/_/g, " ").toLowerCase() : "not started"}
                      </Chip>
                    }
                  />
                  {typeof item.operatorPayoutAmount === "number" ? (
                    <SummaryRow label="Payout amount" value={<span className="font-bold text-slate-900">{currency} {item.operatorPayoutAmount.toLocaleString("en-US")}</span>} />
                  ) : null}
                </dl>
                <Link
                  href="/account/agent/revenues"
                  className="group mt-4 flex items-center justify-between rounded-2xl bg-slate-50 px-3.5 py-3 text-[13px] font-semibold text-slate-700 no-underline transition-colors hover:bg-[#02665e]/5 hover:text-[#02665e]"
                >
                  View all revenues
                  <ChevronRight className="h-4 w-4 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden />
                </Link>
              </Panel>
            </aside>
          </div>
        </>
      ) : null}
    </div>
  );
}

// ── Presentation pieces ─────────────────────────────────────────────────

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] || "G") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function Panel({ title, subtitle, action, children }: { title: string; subtitle?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="min-w-0 rounded-3xl border border-solid border-slate-200 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="m-0 text-[15.5px] font-bold text-slate-900">{title}</h2>
          {subtitle ? <p className="m-0 mt-0.5 text-[12.5px] text-slate-500">{subtitle}</p> : null}
        </div>
        {action ? <div className="flex-shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Chip({ tone, children }: { tone: "emerald" | "amber" | "rose"; children: ReactNode }) {
  const style = { emerald: "bg-emerald-50 text-emerald-700", amber: "bg-amber-50 text-amber-800", rose: "bg-rose-50 text-rose-700" }[tone];
  const dot = { emerald: "bg-emerald-500", amber: "bg-amber-500", rose: "bg-rose-500" }[tone];
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${style}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden />
      {children}
    </span>
  );
}

function SummaryRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="flex-shrink-0 text-[12.5px] text-slate-500">{label}</dt>
      <dd className="m-0 min-w-0 text-right text-[13px] font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function ContactRow({ href, icon: Icon, label, value }: { href?: string; icon: typeof Phone; label: string; value: string | null }) {
  const body = (
    <>
      <span className="inline-flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-[#02665e]/10 text-[#02665e]">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[10.5px] font-bold uppercase tracking-[0.12em] text-slate-400">{label}</span>
        <span className={`block truncate text-[13.5px] font-semibold ${value ? "text-slate-900" : "text-slate-400"}`}>{value || "Not shared"}</span>
      </span>
      {href ? <ChevronRight className="h-4 w-4 flex-shrink-0 text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-[#02665e]" aria-hidden /> : null}
    </>
  );
  const rowClass = "group flex w-full items-center gap-3 bg-white px-3.5 py-3";
  return href ? <a href={href} className={`${rowClass} no-underline transition-colors hover:bg-slate-50`}>{body}</a> : <div className={rowClass}>{body}</div>;
}
