"use client";

/**
 * Hire for events, owner side (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4).
 * The owner declares the event space and gives the consent that events are
 * allowed there; NoLSAF then reviews it. Nothing is sold until event booking opens.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, PartyPopper, Send, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import { ownerPropertyRefOrId, useOwnerPropertyId } from "@/lib/ownerPropertyRefs";
import EventHireEditor from "@/components/events/EventHireEditor";
import EventHireStatusCard from "@/components/events/EventHireStatusCard";
import ConsentCheck from "@/components/events/ConsentCheck";
import type { EventHireView, EventTerms } from "@/components/events/eventHireTypes";

export default function OwnerEventHirePage() {
  const params = useParams<{ id: string }>();
  const { id, error: refError } = useOwnerPropertyId(params?.id, (ref) => `/owner/properties/${encodeURIComponent(ref)}/events`);
  const [view, setView] = useState<EventHireView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [photosSaving, setPhotosSaving] = useState(false);
  const [consent, setConsent] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiClient.get(`/api/owner/properties/${id}/event-hire`);
      setView(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not load event hire.");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const save = async (terms: EventTerms) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await apiClient.put(`/api/owner/properties/${id}/event-hire`, { terms });
      setView(res.data);
      setConsent(false);
      setNotice(res.data.problems?.length ? "Saved. Finish what is still needed, then send it for review." : "Saved. Confirm below and send it for review.");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save.");
    } finally {
      setSaving(false);
    }
  };

  const savePhotos = async (urls: string[], kind: "photos" | "extra-photos" = "photos") => {
    setPhotosSaving(true);
    setError("");
    try {
      const res = await apiClient.put(`/api/owner/properties/${id}/event-hire/${kind}`, { urls });
      setView(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save the photos.");
    } finally {
      setPhotosSaving(false);
    }
  };

  const submit = async () => {
    if (!view) return;
    setSending(true);
    setError("");
    setNotice("");
    try {
      const res = await apiClient.post(`/api/owner/properties/${id}/event-hire/submit`, { version: view.version, consent: true });
      setView(res.data);
      setNotice("Sent. NoLSAF reviews it and lets you know.");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not send it for review.");
      if (cause?.response?.data?.code === "CHANGED") void load();
    } finally {
      setSending(false);
    }
  };

  const canSubmit = Boolean(view && !view.locked && view.problems.length === 0 && ["NONE", "DRAFT", "RETURNED", "AWAITING_OWNER"].includes(view.status));

  return (
    <div id="owner-event-hire" className="w-full min-w-0 space-y-4">
      <style>{`#owner-event-hire, #owner-event-hire * { box-sizing: border-box; }`}</style>
      <div className="min-w-0">
        <Link href="/owner/properties/approved" className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 no-underline hover:text-[#02665e]"><ArrowLeft className="h-3.5 w-3.5" />My properties</Link>
        <div className="mt-2 flex min-w-0 flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#02665e] text-white"><PartyPopper className="h-5 w-5" aria-hidden /></span>
            <div className="min-w-0">
              <h1 className="m-0 truncate text-xl font-bold text-slate-900">Hire for events{view?.propertyTitle ? <span className="font-semibold text-slate-400"> · {view.propertyTitle}</span> : null}</h1>
              <p className="m-0 mt-0.5 text-sm text-slate-500">Let NoLSAF sales partners offer your space for parties, meetings and gatherings. You are paid through NoLSAF.</p>
            </div>
          </div>
        </div>
        {view ? (
          <ol className="m-0 mt-3 grid list-none grid-cols-3 gap-2 p-0">
            {[
              { label: "Describe the space", done: view.problems.length === 0 },
              { label: "Confirm and send", done: ["PENDING", "APPROVED", "PAUSED"].includes(view.status) },
              { label: "NoLSAF approves", done: view.status === "APPROVED" },
            ].map((s, i, all) => {
              const current = !s.done && all.slice(0, i).every((p) => p.done);
              return (
                <li key={s.label} className={`flex min-w-0 items-center gap-2 rounded-md border border-solid px-2.5 py-2 text-xs font-semibold ${s.done ? "border-[#02665e]/30 bg-[#02665e]/[0.06] text-[#02665e]" : current ? "border-[#02665e] bg-white text-slate-900" : "border-slate-200 bg-white text-slate-400"}`}>
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${s.done ? "bg-[#02665e] text-white" : current ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                    {s.done ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
                  </span>
                  <span className="min-w-0 truncate">{s.label}</span>
                </li>
              );
            })}
          </ol>
        ) : null}
      </div>

      {refError ? <p role="alert" className="m-0 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800">{refError}</p> : null}
      {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
      {notice ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

      {!view ? (
        !error && !refError ? <div className="grid min-h-40 place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : null
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <EventHireEditor
            view={view}
            disabled={Boolean(view.locked)}
            saving={saving}
            onSave={(t) => void save(t)}
            onPhotos={(urls) => void savePhotos(urls)}
            onExtraPhotos={(urls) => savePhotos(urls, "extra-photos")}
            photosSaving={photosSaving}
            photosHref={id ? `/owner/properties/add?id=${ownerPropertyRefOrId(id)}` : undefined}
          />
          <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
            <EventHireStatusCard view={view} audience="owner" />
            {canSubmit ? (
              <article className="min-w-0 rounded-lg border border-solid border-slate-300 bg-white p-4">
                <ConsentCheck checked={consent} onChange={setConsent}>
                  I own or control this space, and events are allowed here by the building, the landlord and the neighbours&apos; rules. The details above are true. I agree that NoLSAF keeps {view.ownerFeePercent ?? 10}% of my price, adds a {view.clientFeePercent ?? 6}% service fee for the client, and pays me the rest after each event.
                </ConsentCheck>
                <button type="button" onClick={() => void submit()} disabled={!consent || sending}
                  className={`mt-3 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold transition ${consent
                    ? "border-0 bg-[#02665e] text-white shadow-[0_8px_20px_-10px_rgba(2,102,94,0.7)] hover:bg-[#014d47]"
                    : "cursor-not-allowed border border-solid border-[#02665e]/40 bg-white text-[#02665e]"}`}>
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  {consent ? "Send for review" : "Tick the box above to send"}
                </button>
                <p className="m-0 mt-2 flex items-start gap-1.5 text-[11px] leading-4 text-slate-500"><ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#02665e]" />Clients pay NoLSAF, never you directly. NoLSAF holds the deposit and pays you after the event.</p>
              </article>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
