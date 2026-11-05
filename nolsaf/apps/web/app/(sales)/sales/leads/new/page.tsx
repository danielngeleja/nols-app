"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowLeft, ArrowRight, Building2, ClipboardCheck, MapPinned, ShieldAlert, UserPlus } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell from "@/components/SalesShell";
import SalesLeadForm, { toSalesLeadPayload, type SalesLeadFormValue } from "@/components/sales/SalesLeadForm";

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
      <div id="sales-lead-new" className="w-full min-w-0">
        <header className="relative overflow-hidden rounded-2xl bg-[#0b2420] text-white shadow-[0_18px_40px_-30px_rgba(3,51,44,0.8)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(90%_120%_at_0%_100%,rgba(16,185,129,0.16)_0%,rgba(11,36,32,0)_60%)]" aria-hidden />
          <div className="pointer-events-none absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)", backgroundSize: "18px 18px" }} aria-hidden />
          <div className="relative px-5 py-5 sm:px-6 sm:py-6">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="m-0 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-300/80"><UserPlus className="h-3.5 w-3.5" /> Sales workspace · Lead pipeline</p>
                <h1 className="m-0 mt-1 text-2xl font-bold tracking-tight text-white">Register a lead</h1>
                <p className="m-0 mt-1 max-w-2xl text-sm leading-5 text-white/60">Capture the prospect, location and next action in one record.</p>
              </div>
              <Link href="/sales/leads" className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border border-white/20 bg-white/[0.07] px-3 text-xs font-semibold text-white no-underline transition hover:bg-white/15 hover:text-white hover:no-underline"><ArrowLeft className="h-3.5 w-3.5" />Back to leads</Link>
            </div>
            <div className="mt-5 grid gap-2 border-t border-white/10 pt-4 sm:grid-cols-3">
              {[
                { icon: Building2, title: "Prospect", detail: "Property and contact" },
                { icon: MapPinned, title: "Location", detail: "Region to landmark" },
                { icon: ClipboardCheck, title: "Opportunity", detail: "Product and follow-up" },
              ].map((step, index) => {
                const Icon = step.icon;
                return (
                  <div key={step.title} className="flex min-w-0 items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2.5">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-300/10 text-emerald-300"><Icon className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className="block text-xs font-semibold text-white">{String(index + 1).padStart(2, "0")} · {step.title}</span>
                      <span className="block truncate text-[11px] text-white/50">{step.detail}</span>
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        </header>

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
          <section className="mt-4">
            <SalesLeadForm submitLabel="Register lead" showTopSubmit submitting={submitting} onSubmit={submit} />
          </section>
        )}
      </div>
    </SalesShell>
  );
}
