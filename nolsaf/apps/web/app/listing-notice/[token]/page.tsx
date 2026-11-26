"use client";

/**
 * The owner's "Not expecting this?" link from an assisted listing SMS
 * (docs/SALES_ASSISTED_LISTING.md). No sign-in. The owner either confirms
 * nothing is wrong, or pauses the listing so NoLSAF calls them. It never
 * changes or deletes anything else.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, Building2, CheckCircle2, Clock3, Loader2, LogIn, MessageSquareText, PauseCircle, PhoneCall, ShieldCheck, ThumbsUp, UserRound } from "lucide-react";
import apiClient from "@/lib/apiClient";

const SUPPORT_PHONE = "+255 736 766 726";
const SUPPORT_TEL = `tel:${SUPPORT_PHONE.replace(/\s/g, "")}`;

const NEXT_STEPS = ["NoLSAF checks the listing", "You get an SMS when it is live", "You sign in and add where we pay you"];
const OTHER_REASON = "Something else";
const RENT_WRONG = "The rent or terms are wrong";
const OBJECTION_REASONS = ["I never agreed to list this property", "This is not my property", "I do not know this sales partner", OTHER_REASON];

type RentTerms = { lines: Array<{ label: string; value: string }>; confirmed: boolean; version: string };
type Notice = { propertyTitle: string | null; partnerName: string | null; partnerCode: string | null; paused: boolean; closed: boolean; rent?: RentTerms | null };
type View = "loading" | "missing" | "ask" | "agreed" | "object" | "paused" | "closed";

/** "LUMORA APARTMENTS" shown as "Lumora Apartments"; mixed case is kept. */
function tidy(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function initials(value: string): string {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase()).join("") || "N";
}

export default function ListingNoticePage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [view, setView] = useState<View>("loading");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/public/listing-notice/${encodeURIComponent(token)}`)
      .then((response) => {
        if (!active) return;
        const data = response.data as Notice;
        setNotice(data);
        setView(data.closed ? "closed" : data.paused ? "paused" : "ask");
      })
      .catch(() => { if (active) setView("missing"); });
    return () => { active = false; };
  }, [token, reload]);

  const rent = notice?.rent ?? null;
  const rentPending = Boolean(rent && !rent.confirmed);

  const confirmRent = async () => {
    if (!rent) return;
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/public/listing-notice/${encodeURIComponent(token)}/confirm-rent`, { version: rent.version });
      setNotice((current) => (current?.rent ? { ...current, rent: { ...current.rent, confirmed: true } } : current));
      setView("agreed");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Something went wrong. Please call NoLSAF support.");
      // The partner changed the terms since the page opened: show the new ones.
      if (requestError?.response?.data?.code === "CHANGED") setReload((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  const object = async () => {
    // A pause takes a real reason: one tap on "no" is not enough to stop a listing.
    if (!reason) { setError("Choose what is wrong first."); return; }
    if (reason === OTHER_REASON && note.trim().length < 5) { setError("Tell us in a few words what is wrong."); return; }
    setBusy(true);
    setError("");
    try {
      const text = note.trim() ? `${reason}: ${note.trim()}` : reason;
      await apiClient.post(`/api/public/listing-notice/${encodeURIComponent(token)}/object`, { note: text.slice(0, 500) });
      setView("paused");
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Something went wrong. Please call NoLSAF support.");
    } finally {
      setBusy(false);
    }
  };

  const property = tidy(notice?.propertyTitle) || "Your property";
  const partner = tidy(notice?.partnerName) || "A NoLSAF sales partner";

  const headline: Record<View, { title: string; sub: string }> = {
    loading: { title: "Checking your link", sub: "One moment." },
    missing: { title: "This link has expired", sub: "Nothing on your account was changed." },
    ask: rentPending
      ? { title: "Is this rent right?", sub: "Your home goes live for monthly tenants only after you confirm." }
      : { title: "Did you agree to this listing?", sub: "A NoLSAF sales partner is listing a property in your name." },
    agreed: { title: rent?.confirmed ? "Rent confirmed, thank you" : "Thank you, all set", sub: "There is nothing else you need to do now." },
    object: { title: "Tell us what is wrong", sub: "We pause the listing straight away, then call you." },
    paused: { title: "Listing paused", sub: "It is not on sale. NoLSAF will call you to check." },
    closed: { title: "This listing was withdrawn", sub: "Nothing else is needed from you." },
  };

  return (
    <main id="listing-notice" className="flex min-h-screen flex-col bg-slate-100">
      <style>{`#listing-notice, #listing-notice * { box-sizing: border-box; }`}</style>

      <header className="border-0 border-b border-solid border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/NoLS2025-04.png" alt="" className="h-7 w-7 shrink-0 object-contain" />
            <span className="text-[15px] font-bold text-slate-900">NoLSAF</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> Listing notice
          </span>
        </div>
      </header>

      {/* The answer, in one line, on a dark band */}
      <div className="bg-[#0b2420]">
        <div className="mx-auto w-full max-w-xl px-4 pb-20 pt-6 text-white">
          <p className="m-0 text-[19px] font-bold leading-tight">{headline[view].title}</p>
          <p className="m-0 mt-1 text-[13px] text-white/65">{headline[view].sub}</p>
        </div>
      </div>

      <div className="mx-auto -mt-16 w-full max-w-xl flex-1 px-4 pb-8">
        <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)]">
          {view === "loading" ? (
            <div className="grid min-h-40 place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : view === "missing" ? (
            <div className="p-5">
              <div className="flex items-start gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-600"><AlertTriangle className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="m-0 text-[15px] font-semibold text-slate-900">Why this happens</p>
                  <ul className="m-0 mt-2 list-none space-y-2 p-0 text-[13px] leading-5 text-slate-600">
                    <li className="flex items-start gap-2"><MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />When a listing goes live, NoLSAF sends a new SMS with a new link. Use the latest message.</li>
                    <li className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />The listing may have been withdrawn, so the link is no longer needed.</li>
                  </ul>
                </div>
              </div>
              <div className="mt-5 grid gap-2 sm:grid-cols-2">
                <a href={SUPPORT_TEL} className="flex h-11 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014e47]">
                  <PhoneCall className="h-4 w-4" /> Call support
                </a>
                <Link href="/account/login?next=%2Fowner" className="flex h-11 items-center justify-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 no-underline hover:bg-slate-50">
                  <LogIn className="h-4 w-4" /> Sign in to my account
                </Link>
              </div>
            </div>
          ) : (
            <>
              {/* What is being listed, and by whom */}
              <div className="flex items-center gap-3 border-0 border-b border-solid border-slate-100 p-5">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-md bg-[#02665e] text-[15px] font-bold text-white">{initials(property)}</span>
                <div className="min-w-0 flex-1">
                  <p className="m-0 truncate text-[16px] font-bold text-slate-900">{property}</p>
                  <p className="m-0 mt-0.5 flex items-center gap-1.5 truncate text-[13px] text-slate-500">
                    <UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    Listed by {partner}{notice?.partnerCode ? <span className="font-mono text-[12px] text-slate-400">{notice.partnerCode}</span> : null}
                  </p>
                </div>
                <span className={`shrink-0 rounded-md px-2 py-1 text-[11px] font-semibold ${view === "paused" ? "bg-amber-50 text-amber-800" : view === "closed" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-800"}`}>
                  {view === "paused" ? "Paused" : view === "closed" ? "Withdrawn" : "Being listed"}
                </span>
              </div>

              <div className="p-5">
                {view === "ask" && rent && rentPending ? (
                  // Long stay: the money terms the partner set, for the owner to agree.
                  <div>
                    <dl className="m-0 divide-y divide-slate-100 overflow-hidden rounded-md border border-solid border-slate-200">
                      {rent.lines.map((line, index) => (
                        <div key={line.label} className={`flex items-baseline justify-between gap-4 px-3.5 py-2.5 ${index === 0 ? "bg-[#02665e]/[0.04]" : ""}`}>
                          <dt className="text-[13px] text-slate-500">{line.label}</dt>
                          <dd className={`m-0 text-right ${index === 0 ? "text-[17px] font-bold text-slate-900" : "text-[13.5px] font-semibold text-slate-800"}`}>{line.value}</dd>
                        </div>
                      ))}
                    </dl>
                    {error ? <p className="m-0 mt-3 text-sm text-red-700">{error}</p> : null}
                    <button type="button" disabled={busy} onClick={confirmRent} className="mt-4 flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014e47] disabled:opacity-60 [font-family:inherit]">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ThumbsUp className="h-4 w-4" />} Yes, the rent is right
                    </button>
                    <p className="m-0 mt-4 border-0 border-t border-solid border-slate-100 pt-3 text-center text-[12.5px] text-slate-500">
                      Not what you agreed?{" "}
                      <button type="button" onClick={() => { setReason(RENT_WRONG); setError(""); setView("object"); }} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-amber-700 underline-offset-2 hover:underline [font-family:inherit]">
                        Tell us
                      </button>
                    </p>
                  </div>
                ) : view === "ask" ? (
                  // One clear answer up front (Hick's law): the expected "yes" is the only
                  // button. Saying no stays available, as a quieter link below.
                  <div>
                    <p className="m-0 text-[11px] font-semibold uppercase tracking-wide text-slate-400">What happens next</p>
                    <ol className="m-0 mb-4 mt-2 list-none space-y-2 p-0">
                      {NEXT_STEPS.map((step, index) => (
                        <li key={step} className="flex items-center gap-2.5 text-[13px] text-slate-700">
                          <span className="grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-100 text-[11px] font-semibold text-slate-600">{index + 1}</span>
                          {step}
                        </li>
                      ))}
                    </ol>
                    <button type="button" onClick={() => setView("agreed")} className="flex h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014e47] [font-family:inherit]">
                      <ThumbsUp className="h-4 w-4" /> Yes, I agreed
                    </button>
                    <p className="m-0 mt-4 border-0 border-t border-solid border-slate-100 pt-3 text-center text-[12.5px] text-slate-500">
                      Never agreed to this?{" "}
                      <button type="button" onClick={() => setView("object")} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] font-semibold text-amber-700 underline-offset-2 hover:underline [font-family:inherit]">
                        Report it
                      </button>
                    </p>
                  </div>
                ) : view === "agreed" ? (
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#02665e]" />
                    <p className="m-0 text-[13.5px] leading-6 text-slate-700">
                      {rent?.confirmed ? "NoLSAF can now approve the monthly rent listing. " : null}
                      When {property} goes live, NoLSAF sends you an SMS with a link to sign in and add the account we pay you into.
                      <button type="button" onClick={() => setView("ask")} className="ml-1 border-0 bg-transparent p-0 text-[13px] font-semibold text-[#02665e] hover:underline [font-family:inherit]">Changed your mind?</button>
                    </p>
                  </div>
                ) : view === "object" ? (
                  <div>
                    <p className="m-0 text-[13px] font-semibold text-slate-700">What is wrong?</p>
                    <div className="mt-1.5 grid gap-1.5" role="radiogroup" aria-label="What is wrong?">
                      {(rent ? [RENT_WRONG, ...OBJECTION_REASONS] : OBJECTION_REASONS).map((option) => (
                        <label key={option} className={`flex cursor-pointer items-center gap-2.5 rounded-md border border-solid px-3 py-2.5 text-[13.5px] ${reason === option ? "border-amber-400 bg-amber-50 text-slate-900" : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"}`}>
                          <input type="radio" name="notice-reason" checked={reason === option} onChange={() => { setReason(option); setError(""); }} className="h-4 w-4 accent-amber-600" />
                          {option}
                        </label>
                      ))}
                    </div>
                    <label htmlFor="notice-note" className="mt-3 block text-[13px] font-semibold text-slate-700">
                      Tell us more {reason === OTHER_REASON ? null : <span className="font-normal text-slate-400">optional</span>}
                    </label>
                    <textarea
                      id="notice-note"
                      value={note}
                      onChange={(event) => { setNote(event.target.value); setError(""); }}
                      maxLength={400}
                      placeholder="Anything that helps NoLSAF check it"
                      className="mt-1.5 min-h-20 w-full resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#02665e] [font-family:inherit]"
                    />
                    {error ? <p className="m-0 mt-2 text-sm text-red-700">{error}</p> : null}
                    <p className="m-0 mt-3 flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2 text-[12px] leading-5 text-slate-600">
                      <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" aria-hidden />
                      Pausing only takes it off sale. Nothing is deleted, and NoLSAF calls you to check.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={busy} onClick={object} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-md border-0 bg-amber-600 px-4 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60 [font-family:inherit]">
                        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                        Pause this listing
                      </button>
                      <button type="button" onClick={() => setView("ask")} className="inline-flex h-11 items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 [font-family:inherit]">
                        Back
                      </button>
                    </div>
                  </div>
                ) : view === "paused" ? (
                  <div className="flex items-start gap-3">
                    <PauseCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
                    <p className="m-0 text-[13.5px] leading-6 text-slate-700">Thank you. {property} is off NoLSAF while we check. Expect a call from NoLSAF support, or call us now on <a href={SUPPORT_TEL} className="font-semibold text-[#02665e] no-underline">{SUPPORT_PHONE}</a>.</p>
                  </div>
                ) : (
                  <div className="flex items-start gap-3">
                    <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-slate-400" />
                    <p className="m-0 text-[13.5px] leading-6 text-slate-700">This listing has been withdrawn from NoLSAF. Nothing more is needed from you.</p>
                  </div>
                )}
              </div>
            </>
          )}
        </section>

        <ul className="m-0 mt-4 grid list-none gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 p-0 text-[12px] text-slate-600 sm:grid-cols-2">
          <li className="flex items-start gap-2.5 bg-white px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
            <span><span className="block font-semibold text-slate-900">Your money stays yours</span>Only you can add the account NoLSAF pays you into.</span>
          </li>
          <li className="flex items-start gap-2.5 bg-white px-4 py-3">
            <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
            <span>
              <span className="block font-semibold text-slate-900">NoLSAF support</span>
              <a href={SUPPORT_TEL} className="text-[#02665e] no-underline">{SUPPORT_PHONE}</a>
            </span>
          </li>
        </ul>
      </div>
    </main>
  );
}
