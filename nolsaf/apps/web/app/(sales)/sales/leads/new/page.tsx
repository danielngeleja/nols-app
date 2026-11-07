"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, ShieldAlert, UserPlus } from "lucide-react";
import SalesPageHeader from "@/components/sales/SalesPageHeader";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesLeadForm, { toSalesLeadPayload, type SalesLeadFormValue } from "@/components/sales/SalesLeadForm";

export default function NewSalesLeadPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<any>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  const submit = async (value: SalesLeadFormValue) => {
    setSubmitting(true);
    setError("");
    try {
      const response = await apiClient.post("/api/sales/leads", toSalesLeadPayload(value));
      const ref = String(response.data?.lead?.ref || "");
      if (response.data?.warning) {
        setWarning(response.data.warning);
        setCreatedId(ref);
      } else {
        router.push(`/sales/leads/${ref}`);
      }
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not register the lead.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SalesShell>
      <style jsx global>{`
        #sales-lead-new *,
        #sales-lead-new *::before,
        #sales-lead-new *::after {
          box-sizing: border-box;
        }
      `}</style>
      <div id="sales-lead-new" className="w-full min-w-0">
        <SalesPageHeader
          icon={UserPlus}
          eyebrow="Sales workspace · Lead pipeline"
          title="Register a lead"
          description="Capture the prospect, where it is and your next step. The lead check on the right shows what is still missing."
          actions={
            <Link href="/sales/leads" className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-md border border-solid border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 no-underline hover:bg-slate-50 sm:w-auto"><ArrowLeft className="h-4 w-4" aria-hidden />Back to leads</Link>
          }
        />

        {error ? (
          <p className="mb-0 mt-4 flex items-start gap-2 rounded-md border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}
        {warning ? (
          <div className="mt-4 flex flex-col gap-4 rounded-lg border border-solid border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-white text-amber-700">
                <ShieldAlert className="h-5 w-5" />
              </span>
              <div>
                <p className="m-0 text-sm font-black text-amber-950">Possible duplicate saved for review</p>
                <p className="mb-0 mt-1 text-sm leading-5 text-amber-900/80">{warning.message}</p>
                <p className="mb-0 mt-2 text-[11px] font-semibold text-amber-700">
                  Matched fields: {(warning.matchedFields || []).join(", ")}
                </p>
              </div>
            </div>
            {createdId ? (
              <button
                type="button"
                onClick={() => router.push(`/sales/leads/${createdId}`)}
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-md border-0 bg-[#02665e] px-4 text-sm font-semibold text-white transition hover:bg-[#014d47]"
              >
                Open saved lead
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : (
          <section className="mt-4">
            <SalesLeadForm submitLabel="Register lead" submitting={submitting} onSubmit={submit} />
          </section>
        )}
      </div>
    </SalesShell>
  );
}
