"use client";

/**
 * "How was your stay?" on a finished booking. Rating is sent with the booking
 * reference, so the review shows as a verified stay on the property page.
 * Once posted, the card shows the guest's review and the host's reply.
 */
import { useEffect, useRef, useState } from "react";
import { BadgeCheck, CheckCircle2, Loader2, MessageSquare, Send, Star } from "lucide-react";
import apiClient from "@/lib/apiClient";

export type GuestReview = {
  rating: number;
  title: string | null;
  comment: string | null;
  categoryRatings: Record<string, number> | null;
  createdAt: string;
  ownerResponse: string | null;
  ownerResponseAt: string | null;
  hidden: boolean;
};

export type StayReviewInfo = {
  state: "CAN_REVIEW" | "REVIEWED" | null;
  mine: GuestReview | null;
};

/** Same keys as the API's review category registry. */
const CATEGORIES: Array<{ key: string; label: string }> = [
  { key: "customerCare", label: "Customer care" },
  { key: "security", label: "Security" },
  { key: "reality", label: "As described" },
  { key: "comfort", label: "Comfort" },
];
const CATEGORY_LABEL: Record<string, string> = {
  ...Object.fromEntries(CATEGORIES.map((c) => [c.key, c.label])),
  cleanliness: "Cleanliness",
  value: "Value",
  restaurant: "Food",
};
const VERDICT = ["", "Poor", "Fair", "Good", "Very good", "Excellent"];
const COMMENT_MAX = 2000;

function dateLabel(value: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

function Stars({ value, size = "h-4 w-4" }: { value: number; size?: string }) {
  return (
    <span className="inline-flex items-center gap-0.5" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`${size} ${n <= value ? "fill-amber-400 text-amber-400" : "fill-slate-200 text-slate-200"}`} aria-hidden />
      ))}
    </span>
  );
}

export default function RateStayCard({
  bookingReference,
  propertyTitle,
  info,
}: {
  bookingReference: string;
  propertyTitle: string;
  info: StayReviewInfo;
}) {
  const [mine, setMine] = useState<GuestReview | null>(info.mine);
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [categories, setCategories] = useState<Record<string, number>>({});
  const [title, setTitle] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justPosted, setJustPosted] = useState(false);
  const ref = useRef<HTMLElement | null>(null);

  // Arriving from the "How was your stay?" email or notification: bring the card into view.
  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#rate") {
      ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  if (!mine && info.state !== "CAN_REVIEW") return null;

  const submit = async () => {
    if (!rating) {
      setError("Tap a star to rate your stay.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { data } = await apiClient.post<{ review: GuestReview }>(
        `/api/customer/bookings/${encodeURIComponent(bookingReference)}/review`,
        {
          rating,
          title: title.trim() || null,
          comment: comment.trim() || null,
          categoryRatings: Object.keys(categories).length ? categories : null,
        },
      );
      setMine(data.review);
      setJustPosted(true);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Your review was not saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  const shown = hover || rating;

  return (
    <section ref={ref} id="rate" className="scroll-mt-4 overflow-hidden rounded-2xl border border-solid border-slate-200 bg-white shadow-sm">
      <header className="flex items-center gap-2.5 border-0 border-b border-solid border-slate-100 px-5 py-3.5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-amber-50 text-amber-500">
          <Star className="h-4 w-4 fill-amber-400" aria-hidden />
        </span>
        <h2 className="m-0 text-[15px] font-bold text-slate-900">{mine ? "Your review" : "How was your stay?"}</h2>
        {mine ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-[#02665e]/10 px-2 py-0.5 text-[11px] font-bold text-[#02665e]">
            <BadgeCheck className="h-3 w-3" aria-hidden /> Verified stay
          </span>
        ) : null}
      </header>

      {mine ? (
        <div className="px-5 py-4">
          {justPosted ? (
            <p className="m-0 mb-3 flex items-center gap-2 rounded-xl border border-solid border-emerald-200 bg-emerald-50 px-3 py-2.5 text-[13px] text-emerald-800">
              <CheckCircle2 className="h-4 w-4 flex-shrink-0" aria-hidden /> Thank you. Your review is now on the property page.
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <Stars value={mine.rating} />
            <span className="text-[13px] font-bold text-slate-900">{VERDICT[mine.rating]}</span>
            <span className="text-[12px] text-slate-500">· {dateLabel(mine.createdAt)}</span>
          </div>
          {mine.title ? <p className="m-0 mt-2 text-[14.5px] font-bold text-slate-900">{mine.title}</p> : null}
          {mine.comment ? <p className="m-0 mt-1 whitespace-pre-line text-[13.5px] leading-relaxed text-slate-700">{mine.comment}</p> : null}
          {mine.categoryRatings && Object.keys(mine.categoryRatings).length ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {Object.entries(mine.categoryRatings)
                .filter(([key]) => CATEGORY_LABEL[key])
                .map(([key, value]) => (
                  <span key={key} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-700">
                    {CATEGORY_LABEL[key]}
                    <span className="inline-flex items-center gap-0.5 font-bold text-slate-900">
                      <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden /> {value}
                    </span>
                  </span>
                ))}
            </div>
          ) : null}
          {mine.hidden ? (
            <p className="m-0 mt-3 text-[12.5px] text-slate-500">NoLSAF has hidden this review from the property page. Contact support if you think this is a mistake.</p>
          ) : null}
          {mine.ownerResponse ? (
            <div className="mt-3.5 rounded-xl bg-slate-50 px-3.5 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-[#02665e]/10 text-[#02665e]" aria-hidden>
                  <MessageSquare className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 truncate text-[12.5px] font-bold text-slate-900">Response from {propertyTitle}</span>
                {mine.ownerResponseAt ? <span className="flex-shrink-0 text-[11.5px] text-slate-500">· {dateLabel(mine.ownerResponseAt)}</span> : null}
              </div>
              <p className="m-0 mt-1.5 whitespace-pre-line text-[13px] leading-relaxed text-slate-700">{mine.ownerResponse}</p>
            </div>
          ) : !mine.hidden ? (
            <p className="m-0 mt-3 text-[12.5px] text-slate-500">We let {propertyTitle} know. If they reply, you will see it here.</p>
          ) : null}
        </div>
      ) : (
        <div className="px-5 py-4">
          <p className="m-0 text-[13.5px] text-slate-600">Rate your time at {propertyTitle}. It helps other travellers choose, and helps the host improve.</p>

          {/* The one required answer */}
          <div className="mt-3.5 flex flex-wrap items-center gap-3" onMouseLeave={() => setHover(0)}>
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Overall rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n === 1 ? "" : "s"}, ${VERDICT[n]}`}
                  onClick={() => { setRating(n); setError(null); }}
                  onMouseEnter={() => setHover(n)}
                  onFocus={() => setHover(n)}
                  onBlur={() => setHover(0)}
                  className="inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl border-0 bg-transparent p-0 transition-transform hover:scale-110"
                >
                  <Star className={`h-8 w-8 transition-colors ${n <= shown ? "fill-amber-400 text-amber-400" : "fill-slate-100 text-slate-300"}`} aria-hidden />
                </button>
              ))}
            </div>
            <span className={`text-[14px] font-bold ${shown ? "text-slate-900" : "text-slate-400"}`}>{shown ? VERDICT[shown] : "Tap a star"}</span>
          </div>

          {/* The rest opens once there is a rating, so the first step stays one tap. */}
          {rating ? (
            <div className="mt-4 space-y-4 border-0 border-t border-solid border-slate-100 pt-4">
              <div>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.08em] text-slate-400">Rate by category, optional</div>
                <div className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-2">
                  {CATEGORIES.map(({ key, label }) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <span className="text-[13px] text-slate-700">{label}</span>
                      <div className="flex items-center">
                        {[1, 2, 3, 4, 5].map((n) => (
                          <button
                            key={n}
                            type="button"
                            onClick={() => setCategories((prev) => (prev[key] === n ? Object.fromEntries(Object.entries(prev).filter(([k]) => k !== key)) : { ...prev, [key]: n }))}
                            className="inline-flex h-7 w-7 cursor-pointer items-center justify-center border-0 bg-transparent p-0"
                            aria-label={`${n} star${n === 1 ? "" : "s"} for ${label}`}
                          >
                            <Star className={`h-[18px] w-[18px] ${n <= (categories[key] ?? 0) ? "fill-amber-400 text-amber-400" : "fill-slate-100 text-slate-300 hover:text-slate-400"}`} aria-hidden />
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <input
                value={title}
                onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                placeholder="Sum it up in a few words (optional)"
                aria-label="Review title"
                className="box-border h-11 w-full rounded-lg border border-solid border-slate-300 bg-white px-3 text-sm text-slate-900 transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                style={{ fontFamily: "inherit" }}
              />
              <div>
                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value.slice(0, COMMENT_MAX))}
                  rows={4}
                  placeholder="What did you enjoy, and what could be better? (optional)"
                  aria-label="Your review"
                  className="box-border w-full resize-y rounded-lg border border-solid border-slate-300 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-900 transition-colors placeholder:text-slate-400 hover:border-slate-400 focus:border-[#02665e] focus:outline-none focus:ring-2 focus:ring-[#02665e]/20"
                  style={{ fontFamily: "inherit" }}
                />
                <div className="mt-1 text-right text-[11px] tabular-nums text-slate-400">{comment.length}/{COMMENT_MAX}</div>
              </div>

              {error ? <p className="m-0 rounded-lg border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p> : null}

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="m-0 text-[12px] text-slate-500">Shown with your first name and last initial, marked as a verified stay.</p>
                <button
                  type="button"
                  onClick={() => void submit()}
                  disabled={busy}
                  style={{ fontFamily: "inherit" }}
                  className="inline-flex h-10 flex-shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-lg border-0 bg-[#02665e] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#014e47] disabled:cursor-default disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />} Post review
                </button>
              </div>
            </div>
          ) : error ? (
            <p className="m-0 mt-3 rounded-lg border border-solid border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>
          ) : null}
        </div>
      )}
    </section>
  );
}
