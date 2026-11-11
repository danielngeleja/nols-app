"use client";

/**
 * Guest reviews: every review guests can see on the owner's properties, and
 * the owner's public reply to each. A reply shows under the review on the
 * property page. Reviews NoLSAF has hidden are not listed here.
 */
import { useCallback, useEffect, useState } from "react";
import {
  BadgeCheck, Building2, CheckCircle2, Clock, Inbox, Loader2, MessageSquare,
  MessageSquareReply, Pencil, Send, Star, Trash2, X,
} from "lucide-react";
import apiClient from "@/lib/apiClient";

const REPLY_MAX = 2000;
const CLAMP_AT = 320;

type Review = {
  id: number;
  rating: number;
  title: string | null;
  comment: string | null;
  categoryRatings: Record<string, number> | null;
  isVerified: boolean;
  createdAt: string;
  ownerResponse: string | null;
  ownerResponseAt: string | null;
  guest: { name: string };
  property: { id: number; title: string };
};

type PropertyStat = { id: number; title: string; total: number; averageRating: number | null; unanswered: number };

type Summary = { total: number; unanswered: number; averageRating: number | null; distribution: Record<string, number> };

type ListResponse = {
  reviews: Review[];
  page: number;
  pageSize: number;
  matching: number;
  summary: Summary;
  properties: PropertyStat[];
};

type Filter = "all" | "unanswered" | "answered";

const EMPTY_SUMMARY: Summary = { total: 0, unanswered: 0, averageRating: null, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } };

/** Same keys as the API's review category registry (nrmsReviewCategories.ts), plus older keys some reviews still carry. */
const CATEGORY_LABEL: Record<string, string> = {
  customerCare: "Customer care",
  security: "Security",
  reality: "As described",
  comfort: "Comfort",
  cleanliness: "Cleanliness",
  value: "Value",
  restaurant: "Food",
  location: "Location",
  service: "Service",
  communication: "Communication",
};

const STYLES = `
  #owner-reviews, #owner-reviews * { box-sizing: border-box; }
  @keyframes or-shimmer { 0% { background-position: -400px 0 } 100% { background-position: 400px 0 } }
  #owner-reviews .or-sk { background: linear-gradient(90deg, #eef2f1 0%, #f8faf9 40%, #eef2f1 80%); background-size: 800px 100%; animation: or-shimmer 1.3s linear infinite; }
`;

const CARD = "rounded-2xl border border-solid border-slate-300/80 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_32px_-26px_rgba(15,23,42,0.4)]";

function eat(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) + " EAT";
}

function ago(value: string | null) {
  if (!value) return "";
  const seconds = Math.round((Date.now() - new Date(value).getTime()) / 1000);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const steps: Array<[number, Intl.RelativeTimeFormatUnit]> = [[60, "second"], [60, "minute"], [24, "hour"], [7, "day"], [4.345, "week"], [12, "month"], [Infinity, "year"]];
  let amount = seconds;
  for (const [size, unit] of steps) {
    if (Math.abs(amount) < size) return rtf.format(-Math.round(amount), unit);
    amount /= size;
  }
  return "";
}

function initials(name: string) {
  return name.replace(/\./g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "G";
}

function errorText(cause: any, fallback: string) {
  return cause?.response?.data?.error || fallback;
}

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${size} ${n <= Math.round(value) ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200"}`} aria-hidden />
      ))}
    </span>
  );
}

/** Openers an owner can start from, then make their own. */
function starters(firstName: string, rating: number) {
  return rating >= 4
    ? [
        `Thank you, ${firstName}. We are glad you enjoyed your stay and hope to welcome you back soon.`,
        `Thank you for the kind words, ${firstName}. Our team will be happy to read this.`,
      ]
    : [
        `Thank you for your feedback, ${firstName}. We are sorry your stay fell short, and we are looking into what you raised.`,
        `Thank you, ${firstName}. We take this seriously and have shared it with our team so it does not happen again.`,
      ];
}

function ReviewCard({ review, onSaved }: { review: Review; onSaved: (next: Review, notice: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(review.ownerResponse ?? "");
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const firstName = review.guest.name.split(" ")[0] || "there";
  const long = (review.comment?.length ?? 0) > CLAMP_AT;

  const startEdit = () => {
    setDraft(review.ownerResponse ?? "");
    setError(null);
    setConfirmRemove(false);
    setEditing(true);
  };

  const save = async () => {
    const text = draft.trim();
    if (text.length < 2) {
      setError("Write a reply first.");
      return;
    }
    setBusy("save");
    setError(null);
    try {
      const { data } = await apiClient.put<{ review: Review }>(`/api/owner/reviews/${review.id}/response`, { response: text });
      setEditing(false);
      onSaved(data.review, review.ownerResponse ? "Your reply was updated." : `Reply posted. ${firstName} and future guests will see it under the review.`);
    } catch (cause) {
      setError(errorText(cause, "Your reply was not saved. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    setBusy("remove");
    setError(null);
    try {
      const { data } = await apiClient.delete<{ review: Review }>(`/api/owner/reviews/${review.id}/response`);
      setConfirmRemove(false);
      onSaved(data.review, "Your reply was removed from the property page.");
    } catch (cause) {
      setError(errorText(cause, "Your reply was not removed. Please try again."));
    } finally {
      setBusy(null);
    }
  };

  const categories = review.categoryRatings
    ? Object.entries(review.categoryRatings).filter(([key, value]) => CATEGORY_LABEL[key] && typeof value === "number")
    : [];

  return (
    <li className={`${CARD} min-w-0 p-4 sm:p-5`}>
      {/* Who, where, when */}
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-[#02665e]/10 text-sm font-bold text-[#02665e]" aria-hidden>
          {initials(review.guest.name)}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[15px] font-bold text-slate-900">{review.guest.name}</span>
              {review.isVerified ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  <BadgeCheck className="h-3 w-3" aria-hidden /> Verified stay
                </span>
              ) : null}
            </div>
            {review.ownerResponse ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#02665e]/[0.07] px-2.5 py-1 text-[11px] font-bold text-[#02665e]">
                <CheckCircle2 className="h-3 w-3" aria-hidden /> Replied
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                <Clock className="h-3 w-3" aria-hidden /> Awaiting reply
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-slate-500">
            <Stars value={review.rating} size="h-3.5 w-3.5" />
            <span className="inline-flex min-w-0 items-center gap-1">
              <Building2 className="h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
              <span className="truncate">{review.property.title}</span>
            </span>
            <span title={eat(review.createdAt)}>{ago(review.createdAt)}</span>
          </div>
        </div>
      </div>

      {/* What the guest said */}
      <div className="mt-4 sm:pl-[52px]">
        {review.title ? <p className="m-0 text-base font-bold text-slate-900">{review.title}</p> : null}
        {review.comment ? (
          <>
            <p className={`m-0 whitespace-pre-line text-sm leading-relaxed text-slate-700 ${review.title ? "mt-1.5" : ""} ${long && !expanded ? "line-clamp-4" : ""}`}>
              {review.comment}
            </p>
            {long ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-1 appearance-none border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] [font-family:inherit] hover:underline"
              >
                {expanded ? "Show less" : "Read more"}
              </button>
            ) : null}
          </>
        ) : !review.title ? (
          <p className="m-0 text-sm italic text-slate-500">The guest left a rating without a written comment.</p>
        ) : null}

        {categories.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {categories.map(([key, value]) => (
              <span key={key} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                {CATEGORY_LABEL[key]}
                <span className="inline-flex items-center gap-0.5 font-bold text-slate-900">
                  <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden /> {value}
                </span>
              </span>
            ))}
          </div>
        ) : null}

        {error ? <p className="m-0 mt-3 rounded-xl border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p> : null}

        {/* The owner's side */}
        <div className="mt-4 border-0 border-t border-dashed border-slate-200 pt-4">
          {editing ? (
            <div>
              <label className="flex items-center justify-between gap-2 text-sm font-bold text-slate-900" htmlFor={`reply-${review.id}`}>
                <span>{review.ownerResponse ? "Edit your reply" : `Reply to ${firstName}`}</span>
                <span className="text-[11px] font-medium tabular-nums text-slate-400">{draft.length}/{REPLY_MAX}</span>
              </label>
              {!draft.trim() ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {starters(firstName, review.rating).map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => setDraft(text)}
                      className="max-w-full truncate rounded-full border border-solid border-slate-300 bg-white px-3 py-1 text-left text-[12px] font-medium text-slate-600 [font-family:inherit] transition hover:border-[#02665e] hover:text-[#02665e]"
                    >
                      {text.length > 60 ? `${text.slice(0, 58)}...` : text}
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                id={`reply-${review.id}`}
                value={draft}
                onChange={(e) => setDraft(e.target.value.slice(0, REPLY_MAX))}
                rows={4}
                autoFocus
                placeholder={`Thank ${firstName} for staying with you, and answer anything they raised.`}
                className="mt-2 w-full resize-y rounded-xl border border-solid border-slate-300 bg-white px-3.5 py-2.5 text-sm leading-relaxed text-slate-900 [font-family:inherit] outline-none placeholder:text-slate-400 focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/10"
              />
              <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-[12px] text-slate-500">Shown in public under this review. Keep it polite and leave out private booking details.</p>
                <div className="flex shrink-0 gap-2">
                  <button
                    type="button"
                    onClick={() => { setEditing(false); setError(null); }}
                    disabled={Boolean(busy)}
                    className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 [font-family:inherit] transition hover:bg-slate-50 disabled:opacity-50 sm:flex-none"
                  >
                    <X className="h-4 w-4" aria-hidden /> Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={Boolean(busy) || draft.trim().length < 2}
                    className="group/btn inline-flex h-10 flex-1 items-center justify-between gap-3 rounded-xl border border-solid border-[#012a26] bg-[#012a26] pl-4 pr-1.5 text-sm font-bold text-white [font-family:inherit] transition hover:bg-[#02665e] disabled:opacity-50 sm:flex-none"
                  >
                    {review.ownerResponse ? "Save changes" : "Post reply"}
                    <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#5eead4] text-[#012a26]">
                      {busy === "save" ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Send className="h-3.5 w-3.5" aria-hidden />}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          ) : review.ownerResponse ? (
            <div className="rounded-xl bg-[#f3f8f7] p-3.5 sm:p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="m-0 flex items-center gap-2 text-[13px] font-bold text-slate-900">
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-[#012a26] text-[#5eead4]" aria-hidden>
                    <MessageSquareReply className="h-3.5 w-3.5" />
                  </span>
                  Your reply
                  <span className="font-normal text-slate-500" title={eat(review.ownerResponseAt)}>· {ago(review.ownerResponseAt)}</span>
                </p>
                {!confirmRemove ? (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={startEdit}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border-0 bg-transparent px-2.5 text-[12px] font-semibold text-slate-600 [font-family:inherit] transition hover:bg-white hover:text-[#02665e]"
                    >
                      <Pencil className="h-3.5 w-3.5" aria-hidden /> Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => { setConfirmRemove(true); setError(null); }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg border-0 bg-transparent px-2.5 text-[12px] font-semibold text-slate-600 [font-family:inherit] transition hover:bg-white hover:text-rose-700"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden /> Remove
                    </button>
                  </div>
                ) : null}
              </div>
              <p className="m-0 mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-700">{review.ownerResponse}</p>
              {confirmRemove ? (
                <div className="mt-3 flex flex-col gap-2 rounded-lg bg-white p-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="text-[13px] text-slate-700">Remove this reply from the property page?</span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmRemove(false)}
                      disabled={Boolean(busy)}
                      className="inline-flex h-9 flex-1 items-center justify-center rounded-lg border border-solid border-slate-300 bg-white px-3 text-[13px] font-semibold text-slate-700 [font-family:inherit] transition hover:bg-slate-50 disabled:opacity-50 sm:flex-none"
                    >
                      Keep it
                    </button>
                    <button
                      type="button"
                      onClick={() => void remove()}
                      disabled={Boolean(busy)}
                      className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg border-0 bg-rose-600 px-3 text-[13px] font-semibold text-white [font-family:inherit] transition hover:bg-rose-700 disabled:opacity-50 sm:flex-none"
                    >
                      {busy === "remove" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Trash2 className="h-4 w-4" aria-hidden />} Remove
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="m-0 text-[13px] text-slate-500">Guests read replies before they book. A short thank you goes a long way.</p>
              <button
                type="button"
                onClick={startEdit}
                className="group/btn inline-flex h-10 shrink-0 items-center justify-between gap-3 rounded-xl border border-solid border-[#012a26] bg-[#012a26] pl-4 pr-1.5 text-sm font-bold text-white [font-family:inherit] transition hover:bg-[#02665e]"
              >
                Reply to {firstName}
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#5eead4] text-[#012a26] transition group-hover/btn:translate-x-0.5">
                  <MessageSquareReply className="h-3.5 w-3.5" aria-hidden />
                </span>
              </button>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

function SkeletonCard() {
  return (
    <li className={`${CARD} p-5`}>
      <div className="flex items-start gap-3">
        <span className="or-sk h-10 w-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <span className="or-sk block h-4 w-40 rounded" />
          <span className="or-sk block h-3 w-64 rounded" />
        </div>
      </div>
      <div className="mt-4 space-y-2 sm:pl-[52px]">
        <span className="or-sk block h-3 w-full rounded" />
        <span className="or-sk block h-3 w-11/12 rounded" />
        <span className="or-sk block h-3 w-2/3 rounded" />
      </div>
    </li>
  );
}

export default function OwnerReviewsPage() {
  const [filter, setFilter] = useState<Filter>("all");
  const [property, setProperty] = useState<number | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [page, setPage] = useState(1);
  const [matching, setMatching] = useState(0);
  const [summary, setSummary] = useState<Summary>(EMPTY_SUMMARY);
  const [properties, setProperties] = useState<PropertyStat[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const fetchPage = useCallback(async (nextPage: number) => {
    const params: Record<string, string | number> = { filter, page: nextPage };
    if (property) params.property = property;
    if (rating) params.rating = rating;
    const { data } = await apiClient.get<ListResponse>("/api/owner/reviews", { params });
    return data;
  }, [filter, property, rating]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPage(1);
      setReviews(data.reviews ?? []);
      setPage(1);
      setMatching(data.matching ?? 0);
      setSummary({ ...EMPTY_SUMMARY, ...data.summary });
      setProperties(data.properties ?? []);
    } catch (cause) {
      setError(errorText(cause, "Could not load your guest reviews."));
    } finally {
      setLoading(false);
    }
  }, [fetchPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      const data = await fetchPage(page + 1);
      setReviews((current) => [...current, ...(data.reviews ?? [])]);
      setPage(page + 1);
      setMatching(data.matching ?? 0);
    } catch (cause) {
      setError(errorText(cause, "Could not load more reviews."));
    } finally {
      setLoadingMore(false);
    }
  };

  const onSaved = (next: Review, message: string) => {
    const before = reviews.find((r) => r.id === next.id);
    const delta = Boolean(before?.ownerResponse) === Boolean(next.ownerResponse) ? 0 : next.ownerResponse ? -1 : 1;
    setReviews((current) => current.map((r) => (r.id === next.id ? next : r)));
    if (delta) {
      setSummary((s) => ({ ...s, unanswered: Math.max(0, s.unanswered + delta) }));
      setProperties((list) => list.map((p) => (p.id === next.property.id ? { ...p, unanswered: Math.max(0, p.unanswered + delta) } : p)));
    }
    setNotice(message);
    window.dispatchEvent(new Event("nols:owner-reviews-changed"));
  };

  const pick = (fn: () => void) => {
    setNotice(null);
    fn();
  };

  const answered = summary.total - summary.unanswered;
  const replyRate = summary.total > 0 ? Math.round((answered / summary.total) * 100) : null;
  const maxBar = Math.max(1, ...Object.values(summary.distribution));
  const filtersOn = Boolean(property || rating || filter !== "all");
  // Tab counts follow the property picked on the side, so they never disagree with the feed.
  const scope = property ? properties.find((p) => p.id === property) : null;
  const scopeTotal = scope ? scope.total : summary.total;
  const scopeOpen = scope ? scope.unanswered : summary.unanswered;
  const tabs: Array<{ key: Filter; label: string; count?: number }> = [
    { key: "all", label: "All", count: scopeTotal },
    { key: "unanswered", label: "Awaiting reply", count: scopeOpen },
    { key: "answered", label: "Replied", count: scopeTotal - scopeOpen },
  ];

  return (
    <div id="owner-reviews" className="w-full min-w-0 space-y-5 px-3 pb-12 sm:px-5 lg:px-6">
      <style>{STYLES}</style>

      {/* Header band */}
      <header className="relative overflow-hidden rounded-3xl bg-[#012a26] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.07]"
          style={{ backgroundImage: "linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)", backgroundSize: "28px 28px", maskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)", WebkitMaskImage: "radial-gradient(ellipse at 85% 20%, #000 0%, transparent 65%)" }}
          aria-hidden
        />
        <div className="relative px-5 pb-6 pt-6 sm:px-8 sm:pt-7">
          <p className="m-0 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#9fd8cc]">Property owner</p>
          <h1 className="m-0 mt-1 text-[28px] font-bold leading-tight tracking-tight text-white sm:text-[32px]">Guest reviews</h1>
          <p className="m-0 mt-1.5 max-w-xl text-sm text-white/60">What guests say about your stays. Reply in public; your reply shows under the review on the property page.</p>

          <div className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-4">
            <div className="min-w-0 rounded-2xl border border-solid border-white/10 bg-white/[0.04] px-4 py-3">
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                <Star className="h-3.5 w-3.5 text-[#5eead4]" aria-hidden /> Guest rating
              </span>
              {summary.averageRating ? (
                <span className="mt-1 flex items-center gap-2">
                  <span className="text-2xl font-bold tabular-nums text-white">{summary.averageRating.toFixed(1)}</span>
                  <Stars value={summary.averageRating} size="h-3.5 w-3.5" />
                </span>
              ) : (
                <span className="mt-1 block text-base font-bold text-white/40">No reviews</span>
              )}
            </div>
            {[
              { label: "Reviews", value: String(summary.total), Icon: MessageSquare },
              { label: "Awaiting reply", value: String(summary.unanswered), Icon: Clock, alert: summary.unanswered > 0 },
              { label: "Reply rate", value: replyRate === null ? "None yet" : `${replyRate}%`, Icon: MessageSquareReply },
            ].map((s) => (
              <div key={s.label} className="min-w-0 rounded-2xl border border-solid border-white/10 bg-white/[0.04] px-4 py-3">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-white/55">
                  <s.Icon className="h-3.5 w-3.5 text-[#5eead4]" aria-hidden />
                  <span className="truncate">{s.label}</span>
                </span>
                <span className={`mt-1 block truncate font-bold tabular-nums ${s.value === "None yet" ? "text-base text-white/40" : s.alert ? "text-2xl text-amber-300" : "text-2xl text-white"}`}>{s.value}</span>
              </div>
            ))}
          </div>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[280px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)]">
        {/* Side panel: breakdown and properties */}
        <aside className="min-w-0 space-y-4 lg:sticky lg:top-4 lg:self-start">
          <section className={`${CARD} p-4`}>
            <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">Rating breakdown</h2>
            <ul className="m-0 mt-3 list-none space-y-1 p-0">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = summary.distribution[String(n)] ?? 0;
                const active = rating === n;
                return (
                  <li key={n}>
                    <button
                      type="button"
                      onClick={() => pick(() => setRating(active ? null : n))}
                      disabled={count === 0 && !active}
                      aria-pressed={active}
                      className={`flex w-full appearance-none items-center gap-2.5 rounded-lg border-0 px-2 py-1.5 text-left [font-family:inherit] transition disabled:cursor-default disabled:opacity-50 ${active ? "bg-[#02665e]/[0.08]" : "bg-transparent hover:bg-slate-50"}`}
                    >
                      <span className={`inline-flex w-7 shrink-0 items-center gap-0.5 text-[13px] font-bold tabular-nums ${active ? "text-[#02665e]" : "text-slate-700"}`}>
                        {n}<Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden />
                      </span>
                      <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <span className="block h-full rounded-full bg-amber-400 transition-[width] duration-500" style={{ width: `${(count / maxBar) * 100}%` }} />
                      </span>
                      <span className="w-6 shrink-0 text-right text-[12px] tabular-nums text-slate-500">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>

          {properties.length > 0 ? (
            <section className={`${CARD} p-4`}>
              <h2 className="m-0 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">By property</h2>
              <ul className="m-0 mt-3 list-none space-y-1 p-0">
                {[{ id: 0, title: "All properties", total: summary.total, averageRating: summary.averageRating, unanswered: summary.unanswered }, ...properties].map((p) => {
                  const active = (property ?? 0) === p.id;
                  return (
                    <li key={p.id}>
                      <button
                        type="button"
                        onClick={() => pick(() => setProperty(p.id || null))}
                        aria-pressed={active}
                        className={`flex w-full appearance-none items-center gap-2.5 rounded-xl border-0 px-2.5 py-2 text-left [font-family:inherit] transition ${active ? "bg-[#012a26] text-white" : "bg-transparent text-slate-800 hover:bg-slate-50"}`}
                      >
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${active ? "bg-white/10 text-[#5eead4]" : "bg-[#02665e]/[0.07] text-[#02665e]"}`}>
                          <Building2 className="h-4 w-4" aria-hidden />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">{p.title}</span>
                          <span className={`flex items-center gap-1 text-[11px] ${active ? "text-white/60" : "text-slate-500"}`}>
                            {p.averageRating ? (
                              <>
                                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden /> {p.averageRating.toFixed(1)} ·
                              </>
                            ) : null}
                            {p.total} {p.total === 1 ? "review" : "reviews"}
                          </span>
                        </span>
                        {p.unanswered > 0 ? (
                          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${active ? "bg-amber-300 text-[#012a26]" : "bg-amber-100 text-amber-800"}`} title={`${p.unanswered} awaiting reply`}>
                            {p.unanswered}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </aside>

        {/* Feed */}
        <div className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex max-w-full overflow-x-auto rounded-xl border border-solid border-slate-300/80 bg-white p-1" role="tablist">
              {tabs.map((tab) => {
                const active = filter === tab.key;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => pick(() => setFilter(tab.key))}
                    className={`inline-flex h-9 shrink-0 appearance-none items-center gap-1.5 rounded-lg border-0 px-3.5 text-[13px] font-bold [font-family:inherit] transition ${active ? "bg-[#012a26] text-white" : "bg-transparent text-slate-600 hover:text-slate-900"}`}
                  >
                    {tab.label}
                    <span className={`rounded-full px-1.5 py-px text-[10px] tabular-nums ${active ? "bg-white/15 text-[#5eead4]" : tab.key === "unanswered" && (tab.count ?? 0) > 0 ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-500"}`}>
                      {tab.count ?? 0}
                    </span>
                  </button>
                );
              })}
            </div>
            {filtersOn ? (
              <button
                type="button"
                onClick={() => pick(() => { setFilter("all"); setProperty(null); setRating(null); })}
                className="inline-flex h-9 items-center gap-1 rounded-lg border-0 bg-transparent px-2 text-[13px] font-semibold text-[#02665e] [font-family:inherit] hover:underline"
              >
                <X className="h-3.5 w-3.5" aria-hidden /> Clear filters
              </button>
            ) : null}
          </div>

          {error && <p className="m-0 rounded-xl border border-solid border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
          {notice && (
            <p className="m-0 flex items-center gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden /> {notice}
            </p>
          )}

          {loading ? (
            <ul className="m-0 list-none space-y-4 p-0">
              <SkeletonCard />
              <SkeletonCard />
            </ul>
          ) : reviews.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-[#02665e]/[0.07] text-[#02665e]">
                {filter === "unanswered" ? <CheckCircle2 className="h-6 w-6" aria-hidden /> : <Inbox className="h-6 w-6" aria-hidden />}
              </span>
              <p className="m-0 mt-3 text-base font-bold text-slate-900">
                {filter === "unanswered" ? "All caught up" : summary.total === 0 ? "No guest reviews yet" : "Nothing matches these filters"}
              </p>
              <p className="m-0 mt-1 text-sm text-slate-500">
                {filter === "unanswered"
                  ? "Every review here has your reply."
                  : summary.total === 0
                    ? "Reviews appear here as soon as guests post them, and we let you know in your inbox."
                    : "Try another property, rating or tab."}
              </p>
            </div>
          ) : (
            <>
              <ul className="m-0 list-none space-y-4 p-0">
                {reviews.map((review) => (
                  <ReviewCard key={review.id} review={review} onSaved={onSaved} />
                ))}
              </ul>
              {reviews.length < matching ? (
                <div className="flex justify-center">
                  <button
                    type="button"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                    className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 [font-family:inherit] transition hover:bg-slate-50 disabled:opacity-50"
                  >
                    {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null} Show more reviews
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
