"use client";

/**
 * The owner's "Not expecting this?" link from an assisted listing SMS
 * (docs/SALES_ASSISTED_LISTING.md). No sign-in. One tap pauses the listing
 * and asks NoLSAF to call the owner; it never changes or deletes anything.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, PauseCircle, PhoneCall, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";

const SUPPORT_PHONE = "+255 736 766 726";

type Notice = { propertyTitle: string | null; partnerName: string | null; partnerCode: string | null; paused: boolean; closed: boolean };

export default function ListingNoticePage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/public/listing-notice/${encodeURIComponent(token)}`)
      .then((response) => { if (active) { setNotice(response.data); setState("ready"); } })
      .catch(() => { if (active) setState("missing"); });
    return () => { active = false; };
  }, [token]);

  const object = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/public/listing-notice/${encodeURIComponent(token)}/object`, { note: note.trim() || null });
      setDone(true);
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Something went wrong. Please call NoLSAF support.");
    } finally {
      setBusy(false);
    }
  };

  const paused = done || notice?.paused;

  return (
    <main id="listing-notice" className="flex min-h-screen flex-col bg-slate-100">
      <style>{`#listing-notice, #listing-notice * { box-sizing: border-box; }`}</style>
      <header className="border-0 border-b border-solid border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-2.5 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/NoLS2025-04.png" alt="" className="h-7 w-7 shrink-0 object-contain" />
            <span className="text-[15px] font-bold text-slate-900">NoLSAF</span>
          </Link>
        </div>
      </header>

      <div className="mx-auto w-full max-w-xl flex-1 px-4 py-6">
        {state === "loading" ? (
          <div className="grid min-h-48 place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
        ) : state === "missing" || !notice ? (
          <section className="rounded-lg border border-solid border-slate-200 bg-white p-5">
            <p className="m-0 flex items-start gap-2 text-[15px] font-semibold text-slate-900">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              This link is not valid any more.
            </p>
            <p className="m-0 mt-2 text-sm text-slate-600">If something is wrong with a listing in your name, call NoLSAF support.</p>
          </section>
        ) : (
          <section className="rounded-lg border border-solid border-slate-200 bg-white p-5">
            <p className="m-0 text-[12px] font-semibold text-slate-500">Listing prepared for you</p>
            <h1 className="m-0 mt-1 text-[20px] font-bold text-slate-900">{notice.propertyTitle || "Your property"}</h1>
            <p className="m-0 mt-2 text-sm leading-6 text-slate-700">
              {notice.partnerName || "A NoLSAF sales partner"}
              {notice.partnerCode ? ` (${notice.partnerCode})` : ""} is listing this property on NoLSAF for you.
              If you agreed to this, you do not need to do anything.
            </p>

            {notice.closed ? (
              <p className="m-0 mt-4 flex items-start gap-2 rounded-md bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
                This listing has been withdrawn. Nothing more is needed from you.
              </p>
            ) : paused ? (
              <p className="m-0 mt-4 flex items-start gap-2 rounded-md bg-emerald-50 px-3 py-2.5 text-sm text-emerald-900">
                <PauseCircle className="mt-0.5 h-4 w-4 shrink-0" />
                Thank you. The listing is paused and is not on sale. NoLSAF will call you to check.
              </p>
            ) : (
              <div className="mt-5 border-0 border-t border-solid border-slate-100 pt-4">
                <p className="m-0 text-sm font-semibold text-slate-900">Not expecting this?</p>
                <p className="m-0 mt-1 text-sm text-slate-600">Tell us and we pause the listing straight away, then call you.</p>
                <label className="mt-3 block">
                  <span className="mb-1 block text-[12px] font-semibold text-slate-600">Anything we should know (optional)</span>
                  <textarea
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    maxLength={500}
                    className="min-h-20 w-full resize-y rounded-md border border-solid border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none focus:border-[#02665e]"
                  />
                </label>
                {error ? <p className="m-0 mt-2 text-sm text-red-700">{error}</p> : null}
                <button
                  type="button"
                  disabled={busy}
                  onClick={object}
                  className="mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PauseCircle className="h-4 w-4" />}
                  I did not agree to this, pause it
                </button>
              </div>
            )}
          </section>
        )}

        <ul className="m-0 mt-4 grid list-none gap-px overflow-hidden rounded-lg border border-solid border-slate-200 bg-slate-200 p-0 text-[12px] text-slate-600 sm:grid-cols-2">
          <li className="flex items-start gap-2.5 bg-white px-4 py-3">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
            <span><span className="block font-semibold text-slate-900">Your money stays yours</span>Only you can add the account NoLSAF pays you into.</span>
          </li>
          <li className="flex items-start gap-2.5 bg-white px-4 py-3">
            <PhoneCall className="mt-0.5 h-4 w-4 shrink-0 text-[#02665e]" aria-hidden />
            <span>
              <span className="block font-semibold text-slate-900">NoLSAF support</span>
              <a href={`tel:${SUPPORT_PHONE.replace(/\s/g, "")}`} className="text-[#02665e] no-underline">{SUPPORT_PHONE}</a>
            </span>
          </li>
        </ul>
      </div>
    </main>
  );
}
