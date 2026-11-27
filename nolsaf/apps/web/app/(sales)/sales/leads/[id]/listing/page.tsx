"use client";

/**
 * Assisted listing: the partner fills in the owner's listing
 * (docs/SALES_ASSISTED_LISTING.md). This is the owner's own listing wizard,
 * pointed at the partner's scoped endpoints, so the steps, checks and review
 * are exactly the ones owners use. Only open while the listing is the
 * partner's to edit; otherwise it sends them back to the lead.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Loader2, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import PropertyListingWizard, { type ListingWizardAdapter } from "@/app/(owner)/owner/properties/add/_components/PropertyListingWizard";

export default function SalesAssistedListingPage() {
  const params = useParams<{ id: string }>();
  const leadRef = String(params.id || "");
  const [state, setState] = useState<"loading" | "ready" | "closed" | "error">("loading");
  const [message, setMessage] = useState("");
  const [title, setTitle] = useState("");

  useEffect(() => {
    if (!/^sl_[A-Za-z0-9_-]{22}$/.test(leadRef)) {
      setState("error");
      setMessage("This lead link is not valid.");
      return;
    }
    let active = true;
    apiClient.get(`/api/sales/leads/${leadRef}/assisted-listing`)
      .then((response) => {
        if (!active) return;
        const listing = response.data?.listing;
        const refusal = response.data?.gate?.refusal;
        if (!listing) {
          setState("closed");
          setMessage("No listing has been started for this lead yet. Start it from the lead page.");
        } else if (refusal) {
          setState("closed");
          setMessage(refusal);
        } else if (!listing.editable) {
          setState("closed");
          setMessage("This listing is with NoLSAF now and can no longer be edited by you.");
        } else {
          setTitle(listing.propertyTitle || "");
          setState("ready");
        }
      })
      .catch((error) => {
        if (!active) return;
        setState("error");
        setMessage(error?.response?.data?.error || "Could not open this listing.");
      });
    return () => { active = false; };
  }, [leadRef]);

  const adapter = useMemo<ListingWizardAdapter>(() => {
    const base = `/api/sales/leads/${leadRef}/assisted-listing`;
    let loadedId: number | null = null;
    return {
      mode: "assisted",
      load: async () => {
        const response = await apiClient.get(`${base}/property`);
        loadedId = Number(response.data?.id) || null;
        return response.data;
      },
      // The property already exists (created when the listing started), so
      // saving is always an update to it.
      save: async (_propertyId, body) => {
        await apiClient.put(`${base}/property`, body);
        return loadedId;
      },
      submit: async () => {
        await apiClient.post(`${base}/submit`);
      },
      doneHref: () => `/sales/leads/${leadRef}#assisted-listing`,
      longStayRequestHref: `/sales/leads/${leadRef}#long-stay-request`,
      eventHireHref: `/sales/leads/${leadRef}/events`,
      doneLabel: "Back to the lead",
      doneNote: "Follow its progress on the lead page.",
      successTitle: "Sent to NoLSAF for review",
      successTimeline: "NoLSAF reviews the owner's listing within 3 to 5 business days. It is locked while it is being reviewed.",
      successSteps: [
        "NoLSAF checks the details, photos and rooms",
        "The owner gets an SMS when it goes live",
        "You get a notification when it is approved or returned",
        "Your attribution is checked in the conversion review",
      ],
      draftStorageKey: `assisted_property_draft_${leadRef}`,
      allowResume: false,
      // Monthly terms open once NoLSAF switched the owner on, or while the request waits.
      longStayApiBase: `${base}/long-stay`,
    };
  }, [leadRef]);

  return (
    <SalesShell>
      <div id="sales-assisted-listing" className="w-full min-w-0">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 pb-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href={`/sales/leads/${leadRef}`}
              aria-label="Back to the lead"
              title="Back to the lead"
              className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-solid border-slate-200 bg-white text-slate-600 no-underline transition hover:border-[#02665e]/40 hover:bg-[#02665e]/5 hover:text-[#02665e] hover:no-underline"
            >
              <ArrowLeft className="h-4 w-4" />
            </Link>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">Listing for the owner</div>
              <div className="truncate text-[15px] font-semibold text-slate-900">{title || "New listing"}</div>
            </div>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md bg-[#02665e]/[0.07] px-2.5 py-1 text-xs font-medium text-[#02665e]">
            <ShieldCheck className="h-3.5 w-3.5" />
            Owner sets their own payout
          </span>
        </div>

        {state === "loading" ? (
          <div className="grid min-h-60 place-items-center text-slate-500">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : state === "ready" ? (
          <PropertyListingWizard adapter={adapter} />
        ) : (
          <p className="m-0 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {message}
          </p>
        )}
      </div>
    </SalesShell>
  );
}
