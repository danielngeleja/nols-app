"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import apiClient from "@/lib/apiClient";
import EventHireEditor from "./EventHireEditor";
import ConsentCheck from "./ConsentCheck";
import EventHireStatusCard from "./EventHireStatusCard";
import { STATUS_LABEL, type EventHireView, type EventTerms } from "./eventHireTypes";

export type EventListingHandle = { submit: () => Promise<string> };

/** Optional child of the accommodation wizard. Its review never blocks the parent. */
const EventHireListingStep = forwardRef<EventListingHandle, {
  active: boolean;
  propertyId: number | null;
  apiBase?: string;
  audience: "owner" | "assisted";
  ensureProperty: () => Promise<number>;
  draftTerms?: EventTerms;
  onDraftChange: (terms: EventTerms) => void;
  onSummary: (summary: string) => void;
}>(function EventHireListingStep({ active, propertyId, apiBase, audience, ensureProperty, draftTerms, onDraftChange, onSummary }, ref) {
  const ensure = useRef(ensureProperty);
  ensure.current = ensureProperty;
  const [base, setBase] = useState("");
  const [view, setView] = useState<EventHireView | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [includeReview, setIncludeReview] = useState(false);
  const latestTerms = useRef<EventTerms | undefined>(draftTerms);
  const changed = useCallback((terms: EventTerms, unsaved: boolean) => { latestTerms.current = terms; setDirty(unsaved); onDraftChange(terms); }, [onDraftChange]);

  useEffect(() => {
    if (!active || view) return;
    let cancelled = false;
    void (async () => {
      try {
        const id = propertyId ?? await ensure.current();
        const url = apiBase ?? `/api/owner/properties/${id}/event-hire`;
        const response = await apiClient.get(url);
        if (!cancelled) { setBase(url); setView(response.data); setError(""); }
      } catch (cause: any) {
        if (!cancelled) setError(cause?.response?.data?.error || cause?.message || "Could not open event hire. You can continue with accommodation and add it later.");
      }
    })();
    return () => { cancelled = true; };
  }, [active, propertyId, apiBase, view]);

  const ready = Boolean(view && !view.locked && !view.problems.length && !dirty && !saving);
  useEffect(() => {
    onSummary(view?.locked ? `Event hire: ${STATUS_LABEL[view.status]}` : ready && includeReview ? audience === "owner" ? "Event hire will be sent for separate review." : "Event hire will be sent to the owner for confirmation." : "Event hire stays a draft. Accommodation can proceed; finish event hire later.");
  }, [view, ready, includeReview, audience, onSummary]);

  async function save(terms: EventTerms) {
    setSaving(true); setError("");
    try { const response = await apiClient.put(base, { terms, draft: true }); setView(response.data); setIncludeReview(false); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Could not save event hire."); }
    finally { setSaving(false); }
  }

  async function savePhotos(urls: string[]) {
    setSaving(true); setError("");
    try { const response = await apiClient.put(`${base}/extra-photos`, { urls }); setView(response.data); setIncludeReview(false); }
    catch (cause: any) { setError(cause?.response?.data?.error || "Could not save event photos."); throw cause; }
    finally { setSaving(false); }
  }

  useImperativeHandle(ref, () => ({
    submit: async () => {
      if (view?.locked) return `Accommodation submitted. Event hire remains ${STATUS_LABEL[view.status].toLowerCase()} and is managed separately.`;
      if (!ready || !includeReview || !view) {
        if (dirty && latestTerms.current && base && !view?.locked) {
          try { await apiClient.put(base, { terms: latestTerms.current, draft: true }); }
          catch { return "Accommodation submitted. Your event draft could not be saved; please finish event hire from your property."; }
        }
        return "Accommodation submitted. Event hire can be completed separately from your property.";
      }
      try {
        const response = await apiClient.post(`${base}/${audience === "owner" ? "submit" : "send"}`, audience === "owner" ? { version: view.version, consent: true } : { version: view.version });
        setView(response.data);
        return audience === "owner" ? "Accommodation and event hire submitted for separate reviews. Event hire becomes available only after both approvals." : "Accommodation submitted. Event hire was sent to the owner for confirmation and separate review.";
      } catch (cause: any) {
        return `Accommodation submitted. Event hire was not submitted: ${cause?.response?.data?.error || "please retry from the property's event hire page"}.`;
      }
    },
  }));

  return <div className="event-hire-workspace space-y-4">
    <p className="eh-workspace-note">Event hire is reviewed separately. You can submit accommodation first and finish event hire later.</p>
    {error ? <p role="alert" className="rounded-lg border border-solid border-rose-300 bg-rose-50 p-3 text-sm text-rose-800">{error}</p> : null}
    {!view ? !error && <div className="flex items-center gap-2 p-4 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Opening event details…</div> : <div className="eh-event-layout">
      <EventHireEditor view={view} allowDraftSave draftTerms={view.locked ? undefined : draftTerms} disabled={Boolean(view.locked)} saving={saving} onSave={(terms) => void save(terms)} onExtraPhotos={savePhotos} photosSaving={saving}
        onDraftChange={changed} />
      <aside className="eh-event-sidebar space-y-4" aria-label="Event hire review and confirmation">
      <EventHireStatusCard view={view} audience={audience === "owner" ? "owner" : "partner"} />
      {!view.locked ? <div className="rounded-lg border border-solid border-slate-300 bg-white p-4 text-sm text-slate-800">
        {ready ? <ConsentCheck checked={includeReview} onChange={setIncludeReview}>
          {audience === "owner" ? `I own or control this space, events are allowed here, and these saved details are correct. I accept the ${view.ownerFeePercent ?? 10}% owner fee and ${view.clientFeePercent ?? 6}% client service fee. Include event hire in my submission for separate review.` : "Include event hire in this submission. NoLSAF will send the owner a link to check these terms and give their own consent."}
        </ConsentCheck> : <p className="m-0">Save the event details and required photos to include event hire in review. You can also continue with accommodation and finish this later.</p>}
      </div> : null}
      </aside>
    </div>}
  </div>;
});

export default EventHireListingStep;
