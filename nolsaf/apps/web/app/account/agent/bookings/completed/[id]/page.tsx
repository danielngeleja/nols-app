"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import apiClient from "@/lib/apiClient";
import { fetchAccountSession } from "@/lib/accountSession";
import LogoSpinner from "@/components/LogoSpinner";
import { ArrowLeft, Calendar, CheckCircle2, ClipboardList, User, Mail, Phone, Wallet2, Flag, Info, Star } from "lucide-react";

const api = apiClient;

type TourItem = {
  source: "tour";
  id: string | number;
  bookingCode?: string | null;
  title?: string;
  description?: string | null;
  status?: string;
  paymentStatus?: string;
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

function prettyDate(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

function prettyDateTime(value?: string | null): string {
  if (!value) return "-";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function ratingStepLabel(score: number): string {
  if (score >= 5) return "Best";
  if (score >= 4) return "Excellent";
  if (score >= 3) return "Good";
  if (score >= 2) return "Fair";
  if (score >= 1) return "Poor";
  return "Unmarked";
}

function InfoRow({ icon, label, value }: { icon: React.ReactNode; label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 text-[#02665e]">{icon}</div>
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-slate-600">{label}</p>
          <p className="mt-0.5 text-sm font-bold text-slate-900">{value}</p>
        </div>
      </div>
    </div>
  );
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
          setError("Invalid completed record id.");
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

        if (alive) setError("Completed record not found for this id.");
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

  const title = useMemo(() => {
    if (!item) return "Completed Record";
    return item.title || `Completed #${String(item.id)}`;
  }, [item]);

  const overallRating = useMemo(() => {
    const scores = [
      ratingForm.taskQuality,
      ratingForm.punctuality,
      ratingForm.attentionToDetail,
      ratingForm.communication,
      ratingForm.professionalism,
    ].filter((n) => n > 0);
    if (scores.length === 0) return 0;
    return scores.reduce((a, b) => a + b, 0) / scores.length;
  }, [ratingForm]);

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

      const requiredScores = [
        ratingForm.taskQuality,
        ratingForm.punctuality,
        ratingForm.attentionToDetail,
        ratingForm.communication,
        ratingForm.professionalism,
      ];
      if (requiredScores.some((score) => score < 1 || score > 5)) {
        setRatingMessage("Please mark each rating item independently before saving.");
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
        localStorage.setItem(ratingStorageKey, JSON.stringify(payload));
      }

      setRatingMessage("Rating saved successfully.");
    } catch (e: any) {
      setRatingMessage(String(e?.response?.data?.error || "Could not save rating. Please try again."));
    } finally {
      setRatingSaving(false);
    }
  }

  function RatingRow({ label, keyName }: { label: string; keyName: keyof Omit<RatingForm, "comment"> }) {
    const value = ratingForm[keyName];
    const isMarked = value > 0;
    const level = ratingStepLabel(value);
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-2 py-2 sm:rounded-xl sm:px-3 sm:py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="min-w-0 text-sm font-semibold leading-5 text-slate-800">{label}</p>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-bold ${isMarked ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-300 bg-slate-100 text-slate-500"}`}>
            {isMarked ? `${value}/5 • ${level}` : "Unmarked"}
          </span>
        </div>
        <div className="mt-2 inline-flex flex-nowrap items-center gap-1 rounded-md border border-slate-200 bg-white/90 px-1 py-1 shadow-sm sm:mt-0 sm:rounded-lg sm:px-1.5">
          {[1, 2, 3, 4, 5].map((score) => (
            <button
              key={`${String(keyName)}-${score}`}
              type="button"
              onClick={() => setRatingForm((prev) => ({ ...prev, [keyName]: prev[keyName] === score ? 0 : score }))}
              className={`inline-flex h-7 w-7 items-center justify-center rounded-md border transition sm:h-8 sm:w-8 ${score === value ? "border-emerald-500 bg-emerald-600 text-white" : "border-slate-300 bg-white text-slate-300 hover:border-slate-400 hover:text-slate-400"}`}
              aria-label={`Set ${label} to ${score}`}
              title={`${score}/5`}
            >
              <Star className="h-3.5 w-3.5 sm:h-4 sm:w-4" fill="currentColor" />
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="w-full py-2 sm:py-4">
      <div className="mb-5 rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-sm overflow-hidden">
        <div className="p-5 sm:p-7">
          <Link
            href="/account/agent/bookings?tab=completed"
            className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-[#02665e] transition-colors mb-4 no-underline"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Completed
          </Link>

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="inline-flex items-center rounded-full bg-white/80 px-2.5 py-0.5 text-[11px] font-extrabold uppercase tracking-wide text-emerald-700 border border-emerald-200">
                Completed Details
              </p>
              <h1 className="mt-2 text-2xl sm:text-3xl font-black text-slate-900">{title}</h1>
              <p className="mt-1 text-sm text-slate-600">ID: {id}</p>
            </div>
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-bold text-emerald-700">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Completed
            </span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex flex-col items-center justify-center py-16">
          <LogoSpinner size="lg" className="mb-4" ariaLabel="Loading completed details" />
          <p className="text-sm text-slate-600">Loading completed details...</p>
        </div>
      ) : authRequired ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-6">
          <p className="text-sm font-bold text-slate-900">Sign in required</p>
          <p className="mt-1 text-sm text-slate-600">Please sign in to view completed details.</p>
          <div className="mt-4">
            <Link
              href="/account/login"
              className="inline-flex items-center gap-2 rounded-xl bg-[#02665e] px-4 py-2 text-sm font-bold text-white no-underline"
            >
              Sign in
            </Link>
          </div>
        </div>
      ) : error ? (
        <div className="rounded-2xl border border-rose-200 bg-rose-50 p-6">
          <p className="text-sm font-bold text-rose-900">Could not open completed details</p>
          <p className="mt-1 text-sm text-rose-700">{error}</p>
        </div>
      ) : item ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-3">
            <InfoRow icon={<Flag className="h-4 w-4" />} label="Status" value={item.status || "COMPLETED"} />
            <InfoRow icon={<Calendar className="h-4 w-4" />} label="Completed At" value={prettyDateTime(completedAtValue)} />
            <InfoRow icon={<ClipboardList className="h-4 w-4" />} label="Created" value={prettyDate(item.createdAt)} />
            {item.source === "tour" ? (
              <InfoRow
                icon={<Wallet2 className="h-4 w-4" />}
                label="Amount Paid"
                value={item.amountPaid != null ? `${item.currency || "USD"} ${Number(item.amountPaid).toLocaleString()}` : "-"}
              />
            ) : null}
            <InfoRow icon={<User className="h-4 w-4" />} label="Guest" value={item.requester?.fullName || "-"} />
            <InfoRow icon={<Mail className="h-4 w-4" />} label="Email" value={item.requester?.email || "-"} />
            <InfoRow icon={<Phone className="h-4 w-4" />} label="Phone" value={item.requester?.phone || "-"} />
            {item.source === "tour" ? (
              <>
                <InfoRow icon={<Info className="h-4 w-4" />} label="Trip Date" value={prettyDate(item.tripDate)} />
                <InfoRow icon={<Info className="h-4 w-4" />} label="Trip End" value={prettyDateTime(tripEndValue)} />
                <InfoRow icon={<Info className="h-4 w-4" />} label="Booking Code" value={item.bookingCode || "-"} />
              </>
            ) : null}
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5">
            <p className="text-sm font-bold text-slate-900">Description / Notes</p>
            <p className="mt-2 text-sm leading-6 text-slate-700">{item.description || "No additional notes were provided for this completed record."}</p>
          </div>

          <div className="overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50/60 p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <p className="text-sm font-extrabold uppercase tracking-wide text-amber-800">Rate This Task</p>
                <p className="mt-1 text-sm text-slate-700">Score task quality, punctuality, attention to detail, communication, and professionalism.</p>
              </div>
              <div className="rounded-full border border-amber-200 bg-white px-3 py-1 text-xs font-bold text-amber-800">
                Overall: {overallRating > 0 ? `${overallRating.toFixed(1)}/5 • ${ratingStepLabel(overallRating)}` : "Unmarked"}
              </div>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-2">
              <RatingRow label="Task Quality" keyName="taskQuality" />
              <RatingRow label="Punctuality" keyName="punctuality" />
              <RatingRow label="Attention To Detail" keyName="attentionToDetail" />
              <RatingRow label="Communication" keyName="communication" />
              <div className="col-span-2 sm:col-span-1">
                <RatingRow label="Professionalism" keyName="professionalism" />
              </div>
            </div>

            <div className="mt-4 mx-auto w-full max-w-5xl px-1 sm:px-0">
              <label htmlFor="completed-rating-comment" className="block text-center text-xs font-bold uppercase tracking-wide text-slate-700">Additional Comment</label>
              <textarea
                id="completed-rating-comment"
                value={ratingForm.comment}
                onChange={(e) => setRatingForm((prev) => ({ ...prev, comment: e.target.value }))}
                rows={4}
                maxLength={1000}
                placeholder="Share punctuality, attention, customer handling, and any improvements."
                className="mx-auto mt-1 block min-h-[120px] w-[94%] max-w-full resize-y overflow-x-hidden rounded-xl border border-slate-200 bg-white px-3 py-2 text-center text-sm text-slate-800 outline-none focus:border-amber-300 focus:ring-2 focus:ring-amber-100 sm:w-full"
              />
            </div>

            <div className="mt-3 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              <button
                type="button"
                onClick={saveRating}
                disabled={ratingSaving}
                className="inline-flex items-center gap-2 rounded-xl bg-[#02665e] px-4 py-2 text-sm font-bold text-white transition hover:bg-[#01514b] disabled:cursor-not-allowed disabled:opacity-60"
              >
                <CheckCircle2 className="h-4 w-4" />
                {ratingSaving ? "Saving..." : "Save Rating"}
              </button>
              {ratingMessage ? (
                <p className="text-xs font-semibold text-slate-700">{ratingMessage}</p>
              ) : null}
            </div>
          </div>

        </div>
      ) : null}
    </div>
  );
}
