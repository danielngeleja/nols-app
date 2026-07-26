"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, UserPlus } from "lucide-react";
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
      <div id="sales-lead-new" className="max-w-5xl">
        <SalesPageHeader
          icon={UserPlus}
          eyebrow="Lead pipeline"
          title="Register a lead"
          description="Create a protected prospect record. Genuine calls, emails, meetings and supporting documents keep its journey accountable."
          actions={<Link href="/sales/leads" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 no-underline hover:border-emerald-300 hover:text-emerald-800"><ArrowLeft className="h-4 w-4" />Back to leads</Link>}
        />

        {error ? <p className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
        {warning ? (
          <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">Possible duplicate saved for review</p>
            <p className="mt-1 text-sm text-amber-800">{warning.message}</p>
            <p className="mt-2 text-xs text-amber-700">Matched fields: {(warning.matchedFields || []).join(", ")}</p>
            {createdId ? (
              <button
                type="button"
                onClick={() => router.push(`/sales/leads/${createdId}`)}
                className="mt-4 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white"
              >
                Open saved lead
              </button>
            ) : null}
          </div>
        ) : (
          <section className="mt-5 border border-slate-200 bg-white p-5 shadow-[0_14px_35px_-34px_rgba(15,23,42,0.5)]">
            <SalesLeadForm submitLabel="Register lead" submitting={submitting} onSubmit={submit} />
          </section>
        )}
      </div>
    </SalesShell>
  );
}
