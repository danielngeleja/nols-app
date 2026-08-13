"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, ShieldAlert, UserPlus } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesLeadForm, { toSalesLeadPayload, type SalesLeadFormValue } from "@/components/sales/SalesLeadForm";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

export default function NewSalesLeadPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState<any>(null);
  const [createdId, setCreatedId] = useState<number | null>(null);

  const submit = async (value: SalesLeadFormValue) => {
    setSubmitting(true);
    setError("");
    try {
      const response = await apiClient.post("/api/sales/leads", toSalesLeadPayload(value));
      const id = Number(response.data?.lead?.id);
      if (response.data?.warning) {
        setWarning(response.data.warning);
        setCreatedId(id);
      } else {
        router.push(`/sales/leads/${id}`);
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
      <div id="sales-lead-new" className="max-w-6xl">
        <SalesPageHeader
          icon={UserPlus}
          eyebrow="Lead pipeline"
          title="Register a lead"
          description="Create a protected prospect record. Genuine calls, emails, meetings and supporting documents keep its journey accountable."
          actions={<Link href="/sales/leads" className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 no-underline transition hover:border-emerald-300 hover:bg-emerald-50 hover:text-emerald-800 hover:no-underline"><ArrowLeft className="h-4 w-4" />Back to leads</Link>}
        />

        {error ? (
          <p className="mb-0 mt-5 flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        ) : null}
        {warning ? (
          <div className="mt-5 flex flex-col gap-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-amber-700 shadow-sm">
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
                className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#073c35] px-4 text-sm font-bold text-white transition hover:bg-emerald-800"
              >
                Open saved lead
                <ArrowRight className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        ) : (
          <section className="mt-5 rounded-3xl border border-slate-200 bg-slate-50/70 p-3 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.45)] sm:p-4">
            <SalesLeadForm submitLabel="Register lead" submitting={submitting} onSubmit={submit} />
          </section>
        )}
      </div>
    </SalesShell>
  );
}
