"use client";

/**
 * Hire for events on an assisted listing, partner side
 * (docs/SALES_AGENCY_EVENT_HIRE_STRATEGY.md section 4). The partner fills the
 * event details; the owner checks them and gives the consent on an SMS link.
 * The partner can never give the consent for the owner.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCircle2, Loader2, PartyPopper, Send } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import InfoTip from "@/components/sales/InfoTip";
import EventHireEditor from "@/components/events/EventHireEditor";
import EventHireStatusCard from "@/components/events/EventHireStatusCard";
import type { EventHireView, EventTerms } from "@/components/events/eventHireTypes";

export default function SalesLeadEventHirePage() {
  const params = useParams<{ id: string }>();
  const leadRef = String(params?.id || "");
  const base = `/api/sales/leads/${encodeURIComponent(leadRef)}/assisted-listing/event-hire`;
  const [view, setView] = useState<EventHireView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [photosSaving, setPhotosSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(base);
      setView(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not open event hire for this listing.");
    }
  }, [base]);
  useEffect(() => { void load(); }, [load]);

  const save = async (terms: EventTerms) => {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const res = await apiClient.put(base, { terms });
      setView(res.data);
      setNotice(res.data.problems?.length ? "Saved. Finish what is still needed, then send it to the owner." : "Saved. Send it to the owner to confirm.");
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
      const res = await apiClient.put(`${base}/${kind}`, { urls });
      setView(res.data);
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not save the photos.");
    } finally {
      setPhotosSaving(false);
    }
  };

  const send = async () => {
    setSending(true);
    setError("");
    setNotice("");
    try {
      const res = await apiClient.post(`${base}/send`);
      setView(res.data);
      setNotice(res.data.smsSent ? "Sent. The owner gets an SMS to check the details and confirm." : "Saved for the owner, but the SMS did not go. Try again in a moment.");
    } catch (cause: any) {
      setError(cause?.response?.data?.error || "Could not send it to the owner.");
    } finally {
      setSending(false);
    }
  };

  const editable = Boolean(view && ["NONE", "DRAFT", "AWAITING_OWNER", "RETURNED"].includes(view.status));
  const canSend = Boolean(view && editable && view.problems.length === 0);

  return (
    <SalesShell>
      <div className="min-w-0 space-y-4">
        <Link href={`/sales/leads/${leadRef}`} className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 no-underline hover:text-[#02665e]"><ArrowLeft className="h-3.5 w-3.5" />Back to the lead</Link>
        <SalesPageHeader
          icon={PartyPopper}
          title="Hire for events"
          description="Fill the event details for the owner. The owner confirms them by SMS before NoLSAF reviews."
        />
        {error ? <p role="alert" className="m-0 flex items-start gap-2 rounded-md border border-solid border-rose-300 bg-rose-50 px-4 py-3 text-sm text-rose-800"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{error}</p> : null}
        {notice ? <p role="status" className="m-0 flex items-start gap-2 rounded-md border border-solid border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{notice}</p> : null}

        {!view ? (
          !error ? <div className="grid min-h-40 place-items-center text-slate-400"><Loader2 className="h-6 w-6 animate-spin" /></div> : null
        ) : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
            <EventHireEditor
              view={view}
              disabled={!editable}
              saving={saving}
              onSave={(t) => void save(t)}
              onPhotos={(urls) => void savePhotos(urls)}
              onExtraPhotos={(urls) => savePhotos(urls, "extra-photos")}
              photosSaving={photosSaving}
              photosHref={`/sales/leads/${leadRef}/listing`}
            />
            <div className="min-w-0 space-y-4 lg:sticky lg:top-4">
              <EventHireStatusCard view={view} audience="partner" />
              {editable ? (
                <article className="min-w-0 rounded-lg border border-solid border-slate-300 bg-white p-4">
                  <p className="m-0 flex items-center gap-1 text-sm font-semibold text-slate-900">
                    Send to the owner
                    <InfoTip label="Why the owner confirms">Only the owner can say events are allowed in their space. They get an SMS link with these details and confirm, or tell NoLSAF something is wrong. Any change you make after sending needs a new SMS.</InfoTip>
                  </p>
                  <p className="m-0 mt-1 text-xs text-slate-500">{view.ownerPhone ? `SMS to ${view.ownerPhone}.` : "SMS to the owner's phone on NoLSAF."}</p>
                  <button type="button" onClick={() => void send()} disabled={!canSend || sending}
                    className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white hover:bg-[#014d47] disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400">
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}{view.status === "AWAITING_OWNER" ? "Send the SMS again" : "Send for the owner to confirm"}
                  </button>
                </article>
              ) : (
                <p className="m-0 rounded-lg border border-solid border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">The owner has this now. Changes go through the owner&apos;s own account.</p>
              )}
            </div>
          </div>
        )}
      </div>
    </SalesShell>
  );
}
