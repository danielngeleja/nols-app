"use client";

import { use, useEffect, useState } from "react";
import { CheckCircle2, Copy, LifeBuoy, Loader2, Share2, Star } from "lucide-react";
import apiClient from "@/lib/apiClient";

type Category = { key: string; label: string };
type Share = { url: string; message: string; whatsapp: string };

/** Overall rating at or below this gets the private follow-up path, never a share prompt. */
const RECOVERY_THRESHOLD = 3;

function StarRow({ value, onChange, size, label }: { value: number; onChange: (next: number) => void; size: "lg" | "sm"; label: string }) {
  const dimension = size === "lg" ? "h-9 w-9" : "h-5 w-5";
  return (
    <div className="flex gap-1" role="group" aria-label={label}>
      {[1, 2, 3, 4, 5].map((score) => (
        <button key={score} type="button" onClick={() => onChange(score)} aria-label={`${label}: ${score} of 5`} aria-pressed={score === value} className="border-0 bg-transparent p-1">
          <Star className={`${dimension} ${score <= value ? "fill-amber-400 text-amber-400" : "text-neutral-300"}`} />
        </button>
      ))}
    </div>
  );
}

export default function GuestReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [data, setData] = useState<any>(null);
  const [rating, setRating] = useState(0);
  const [categoryScores, setCategoryScores] = useState<Record<string, number>>({});
  const [feedback, setFeedback] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [share, setShare] = useState<Share | null>(null);
  const [intent, setIntent] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiClient.get(`/api/public/nrms/guest/reviews/${encodeURIComponent(token)}`)
      .then((response) => {
        const review = response.data.review;
        setData(review);
        if (review.respondedAt) {
          setDone(true);
          setRating(review.rating ?? 0);
          setIntent(review.platformIntent ?? null);
          if ((review.rating ?? 0) > RECOVERY_THRESHOLD) setShare(review.share ?? null);
        }
      })
      .catch((requestError) => setError(requestError?.response?.data?.error || "This review request is unavailable."));
  }, [token]);

  const submit = async () => {
    if (!rating) return;
    setBusy(true); setError(null);
    try {
      const response = await apiClient.post(`/api/public/nrms/guest/reviews/${encodeURIComponent(token)}`, {
        rating,
        feedback: feedback.trim() || null,
        categoryRatings: Object.keys(categoryScores).length ? categoryScores : null,
      });
      setShare(response.data.share ?? null);
      setDone(true);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Your review could not be submitted.");
    } finally { setBusy(false); }
  };

  const answerIntent = async (answer: string) => {
    setIntent(answer);
    try { await apiClient.post(`/api/public/nrms/guest/reviews/${encodeURIComponent(token)}/intent`, { platformIntent: answer }); } catch { /* the review itself is already saved */ }
  };

  const copyShare = async () => {
    if (!share) return;
    try { await navigator.clipboard.writeText(share.url); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch { /* clipboard unavailable */ }
  };

  if (!data && !error) return <main className="flex min-h-screen items-center justify-center bg-neutral-100"><Loader2 className="h-6 w-6 animate-spin text-emerald-700" /></main>;

  const categories: Category[] = data?.categories ?? [];
  const lowRating = rating > 0 && rating <= RECOVERY_THRESHOLD;

  return (
    <main className="min-h-screen bg-neutral-100 px-4 py-10">
      <section className="mx-auto max-w-xl border border-neutral-200 bg-white p-6 shadow-sm">
        <p className="m-0 text-[10px] font-bold uppercase tracking-[.16em] text-emerald-700">Verified stay feedback</p>
        <h1 className="mb-0 mt-2 text-2xl font-bold text-neutral-950">How was your stay?</h1>
        <p className="mb-0 mt-2 text-sm text-neutral-500">{data ? `${data.guest}, your feedback helps ${data.property} improve the guest experience.` : error}</p>

        {done ? (
          <div className="mt-8 space-y-4">
            <div className={`flex flex-col items-center border px-5 py-8 text-center ${lowRating ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
              {lowRating ? <LifeBuoy className="h-9 w-9 text-amber-700" /> : <CheckCircle2 className="h-9 w-9 text-emerald-700" />}
              <p className={`mb-0 mt-3 text-base font-bold ${lowRating ? "text-amber-950" : "text-emerald-950"}`}>Thank you for your feedback</p>
              <p className={`mb-0 mt-1 text-sm ${lowRating ? "text-amber-900/80" : "text-emerald-800/75"}`}>
                {lowRating
                  ? `${data?.property} has been notified and will contact you directly about what went wrong.`
                  : "Your verified-stay response has been recorded."}
              </p>
            </div>

            {share && (
              <>
                <div className="border border-neutral-200 p-4">
                  <p className="m-0 text-xs font-bold text-neutral-900">Would you book through NoLSAF again?</p>
                  <div className="mt-3 flex gap-2">
                    {[["YES", "Yes"], ["MAYBE", "Maybe"], ["NO", "No"]].map(([value, label]) => (
                      <button key={value} type="button" onClick={() => void answerIntent(value)}
                        className={`min-h-10 flex-1 rounded-md border px-3 text-xs font-bold ${intent === value ? "border-emerald-700 bg-emerald-700 text-white" : "border-neutral-300 bg-white text-neutral-700"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {intent && <p className="mb-0 mt-3 text-[11px] text-neutral-500">Thank you, your answer has been recorded.</p>}
                </div>

                <div className="border border-neutral-200 p-4">
                  <p className="m-0 text-xs font-bold text-neutral-900">Know someone who would enjoy {data?.property}?</p>
                  <p className="mb-0 mt-1 text-[11px] leading-4 text-neutral-500">Send them the listing. They can see the rooms, the real photos and the live rates.</p>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <a href={share.whatsapp} target="_blank" rel="noopener noreferrer"
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-800 px-4 text-sm font-bold text-white no-underline">
                      <Share2 className="h-4 w-4" />Share on WhatsApp
                    </a>
                    <button type="button" onClick={() => void copyShare()}
                      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-neutral-300 bg-white px-4 text-sm font-bold text-neutral-800">
                      <Copy className="h-4 w-4" />{copied ? "Link copied" : "Copy link"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        ) : data && (
          <>
            <div className="mt-8 flex justify-center" aria-label="Overall rating">
              <StarRow value={rating} onChange={setRating} size="lg" label="Overall stay" />
            </div>

            {/* Categories appear only after the overall rating is set. Tapping a star is the
                commitment moment, so everything revealed after it costs far less completion. */}
            {rating > 0 && categories.length > 0 && (
              <div className="mt-7 border-t border-neutral-200 pt-5">
                <p className="m-0 text-xs font-bold text-neutral-700">Rate what mattered to you</p>
                <p className="mb-0 mt-1 text-[11px] text-neutral-500">Optional. Skip anything that does not apply.</p>
                <div className="mt-3 divide-y divide-neutral-100">
                  {categories.map((category) => (
                    <div key={category.key} className="flex items-center justify-between gap-3 py-2">
                      <span className="text-xs font-medium text-neutral-700">{category.label}</span>
                      <StarRow value={categoryScores[category.key] ?? 0} size="sm" label={category.label}
                        onChange={(score) => setCategoryScores((prev) => ({ ...prev, [category.key]: score }))} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <label className="mt-6 grid gap-2 text-xs font-bold text-neutral-700">
              {lowRating ? "Tell the hotel what went wrong" : "Tell the hotel what stood out"}
              <textarea value={feedback} onChange={(event) => setFeedback(event.target.value)} maxLength={1000}
                className="min-h-32 rounded-md border border-neutral-300 p-3 text-sm font-normal outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                placeholder={lowRating ? "What happened, and what would have made it right?" : "Cleanliness, service, comfort or anything that could be improved"} />
            </label>

            {error && <p className="mt-3 text-sm text-red-700">{error}</p>}

            <button type="button" disabled={!rating || busy} onClick={() => void submit()}
              className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border-0 bg-emerald-800 px-4 text-sm font-bold text-white disabled:bg-neutral-200 disabled:text-neutral-500">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}Submit verified feedback
            </button>
          </>
        )}
      </section>
    </main>
  );
}
