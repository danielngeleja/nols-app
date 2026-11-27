"use client";

/**
 * The owner's SMS link for event hire terms a sales partner filled in
 * (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4). No sign-in. The owner
 * confirms that events are allowed in the space and the details are right,
 * or tells NoLSAF something is wrong. It never changes the listing itself.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, PartyPopper, PhoneCall, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import EventTermsSummary from "@/components/events/EventTermsSummary";
import ConsentCheck from "@/components/events/ConsentCheck";
import type { EventTerms } from "@/components/events/eventHireTypes";

const SUPPORT_PHONE = "+255 736 766 726";
const SUPPORT_TEL = `tel:${SUPPORT_PHONE.replace(/\s/g, "")}`;

type Data = { status: string; terms: EventTerms; version: string; ownerFeePercent?: number; clientFeePercent?: number; propertyTitle: string | null; partnerName: string | null; partnerCode: string | null; confirmedAt: string | null };
type View = "loading" | "missing" | "ask" | "object" | "done" | "objected";

function tidy(value: string | null | undefined): string {
  const text = String(value || "").trim();
  if (!text || text !== text.toUpperCase() || !/[A-Z]/.test(text)) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

export default function EventConfirmPage() {
  const params = useParams<{ token: string }>();
  const token = String(params?.token || "");
  const [data, setData] = useState<Data | null>(null);
  const [view, setView] = useState<View>("loading");
  const [consent, setConsent] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiClient.get(`/api/public/event-hire-confirm/${encodeURIComponent(token)}`)
      .then((res) => {
        if (!active) return;
        const d = res.data as Data;
        setData(d);
        setView(d.status === "AWAITING_OWNER" ? "ask" : d.confirmedAt ? "done" : "missing");
      })
      .catch(() => { if (active) setView("missing"); });
    return () => { active = false; };
  }, [token]);

  const confirm = async () => {
    if (!data) return;
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/public/event-hire-confirm/${encodeURIComponent(token)}/confirm`, { version: data.version, consent: true });
      setView("done");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not confirm. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const object = async () => {
    setBusy(true);
    setError("");
    try {
      await apiClient.post(`/api/public/event-hire-confirm/${encodeURIComponent(token)}/object`, { note: note.trim() });
      setView("objected");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not send. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const partner = tidy(data?.partnerName) || "A NoLSAF sales partner";
  const place = tidy(data?.propertyTitle) || "your property";
  const headline: Record<View, { title: string; sub: string }> = {
    loading: { title: "Checking your link", sub: "One moment." },
    missing: { title: "This link has expired", sub: "Nothing on your listing was changed." },
    ask: { title: "Can guests hire your space for events?", sub: `${partner} added event hire for ${place}. Check the details below.` },
    object: { title: "Tell us what is wrong", sub: "Nothing goes for review. Your sales partner sees your note." },
    done: { title: "Thank you, confirmed", sub: "NoLSAF reviews it and lets you know." },
    objected: { title: "Thank you, we have your note", sub: "Nothing was sent for review. Your sales partner will correct it." },
  };

  return (
    <main id="event-confirm" className="flex min-h-screen flex-col bg-slate-100">
      <style>{`#event-confirm, #event-confirm * { box-sizing: border-box; }`}</style>
      <header className="border-0 border-b border-solid border-slate-200 bg-white">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-3 px-4">
          <Link href="/" className="flex min-w-0 items-center gap-2.5 no-underline">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/assets/NoLS2025-04.png" alt="" className="h-7 w-7 shrink-0 object-contain" />
            <span className="text-[15px] font-bold text-slate-900">NoLSAF</span>
          </Link>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-solid border-emerald-200 bg-emerald-50 px-2 py-1 text-[11px] font-semibold text-emerald-800">
            <PartyPopper className="h-3.5 w-3.5" aria-hidden /> Event hire
          </span>
        </div>
      </header>

      <div className="bg-[#0b2420]">
        <div className="mx-auto w-full max-w-xl px-4 pb-20 pt-6 text-white">
          <p className="m-0 text-[19px] font-bold leading-tight">{headline[view].title}</p>
          <p className="m-0 mt-1 text-[13px] text-white/65">{headline[view].sub}</p>
        </div>
      </div>

      <div className="mx-auto -mt-16 w-full max-w-xl flex-1 space-y-3 px-4 pb-8">
        <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white shadow-[0_16px_40px_-28px_rgba(15,23,42,0.45)]">
          {view === "loading" ? (
            <div className="grid min-h-40 place-items-center text-slate-500"><Loader2 className="h-6 w-6 animate-spin" /></div>
          ) : view === "missing" ? (
            <div className="p-5">
              <p className="m-0 flex items-start gap-2 text-[13px] leading-5 text-slate-600"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />Use the latest SMS from NoLSAF, or ask your sales partner to send it again. You can also set up event hire yourself from My properties.</p>
              <a href={SUPPORT_TEL} className="mt-4 flex h-11 items-center justify-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-semibold text-white no-underline hover:bg-[#014e47]"><PhoneCall className="h-4 w-4" /> Call NoLSAF support</a>
            </div>
          ) : view === "done" || view === "objected" ? (
            <div className="flex items-start gap-3 p-5">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-600"><CheckCircle2 className="h-5 w-5" /></span>
              <p className="m-0 text-[13px] leading-5 text-slate-600">
                {view === "done"
                  ? "When it is approved, NoLSAF sales partners can offer your space for events. Clients pay NoLSAF, NoLSAF holds the deposit and pays you after each event."
                  : "If you did not agree to event hire at all, call NoLSAF support."}
              </p>
            </div>
          ) : data ? (
            <>
              <EventTermsSummary terms={data.terms} fees={data} />
              {view === "ask" ? (
                <div className="border-0 border-t border-solid border-slate-200 p-4">
                  <ConsentCheck checked={consent} onChange={setConsent}>
                    I own or control this space, events are allowed here by the building, the landlord and the neighbours&apos; rules, and these details are right. I agree that NoLSAF keeps {data.ownerFeePercent ?? 10}% of my price, adds a {data.clientFeePercent ?? 6}% service fee for the client, and pays me the rest after each event.
                  </ConsentCheck>
                  {error ? <p role="alert" className="m-0 mt-3 text-[13px] text-rose-700">{error}</p> : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button type="button" disabled={!consent || busy} onClick={() => void confirm()}
                      className={`flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition ${consent
                        ? "border-0 bg-[#02665e] text-white shadow-[0_8px_20px_-10px_rgba(2,102,94,0.7)] hover:bg-[#014e47]"
                        : "cursor-not-allowed border border-solid border-[#02665e]/40 bg-white text-[#02665e]"}`}>
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{consent ? "Confirm" : "Tick the box to confirm"}
                    </button>
                    <button type="button" disabled={busy} onClick={() => { setView("object"); setError(""); }}
                      className="flex h-11 items-center justify-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">
                      Something is wrong
                    </button>
                  </div>
                </div>
              ) : (
                <div className="border-0 border-t border-solid border-slate-200 p-4">
                  <textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 500))} rows={3} placeholder="For example: the garden takes 50 people, not 100. Or: I never agreed to events."
                    className="block w-full rounded-md border border-solid border-slate-300 p-3 text-sm outline-none focus:border-[#02665e] focus:ring-2 focus:ring-[#02665e]/15" />
                  {error ? <p role="alert" className="m-0 mt-2 text-[13px] text-rose-700">{error}</p> : null}
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <button type="button" disabled={note.trim().length < 3 || busy} onClick={() => void object()}
                      className="flex h-11 items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014e47] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}Send note
                    </button>
                    <button type="button" disabled={busy} onClick={() => setView("ask")} className="flex h-11 items-center justify-center rounded-md border border-solid border-slate-300 bg-white px-4 text-sm font-semibold text-slate-800 hover:bg-slate-50">Back</button>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </section>
        <p className="m-0 text-center text-[11px] text-slate-500">Questions? <a href={SUPPORT_TEL} className="font-semibold text-[#02665e] no-underline">{SUPPORT_PHONE}</a></p>
      </div>
    </main>
  );
}
