"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { Download, FileSignature } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { statusTone } from "@/components/SalesShell";
import SalesPageHeader from "@/components/sales/SalesPageHeader";

type ContractPayload = {
  partner: {
    agentCode: string;
    status: string;
    legalName: string | null;
  };
  contract: {
    id: number;
    contractNumber: string;
    status: string;
    startsAt: string;
    expiresAt: string;
    nrmsCommissionRate: number;
    marketplaceRevenueRate: number;
    territory: string | null;
    signedAt: string | null;
    activatedAt: string | null;
    acceptanceHash: string | null;
    hasSignedPdf: boolean;
  };
  rendered: {
    content: string;
    bodyHash: string;
    termsHash: string;
    immutable: boolean;
  };
  timeline: Array<{ status: string; at: string }>;
};

function date(value: string | null): string {
  if (!value) return "Pending";
  return new Date(value).toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function ContractFrame({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  if (active) return <SalesShell>{children}</SalesShell>;
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="border-b border-gray-200 bg-brand-800 px-4 py-4 text-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
          <div>
            <p className="font-semibold">NoLSAF</p>
            <p className="text-xs text-white/75">Sales partner onboarding</p>
          </div>
          <Link href="/account" className="text-sm text-white/85 hover:text-white">
            Back to account
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}

export default function SalesContractPage() {
  const [data, setData] = useState<ContractPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [acceptedName, setAcceptedName] = useState("");
  const [confirmAuthority, setConfirmAuthority] = useState(false);
  const [confirmIndependent, setConfirmIndependent] = useState(false);
  const [confirmExample, setConfirmExample] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setError("");
    try {
      const response = await apiClient.get("/api/sales/contract/current");
      const payload = response.data as ContractPayload;
      setData(payload);
      setAcceptedName(payload.partner.legalName || "");
      if (payload.contract.status === "SENT") {
        await apiClient.post(`/api/sales/contracts/${payload.contract.id}/view`, {});
        setData((current) =>
          current
            ? {
                ...current,
                contract: { ...current.contract, status: "VIEWED" },
                timeline: [
                  ...current.timeline,
                  { status: "VIEWED", at: new Date().toISOString() },
                ],
              }
            : current,
        );
      }
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not load your agreement.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const accept = async () => {
    if (!data) return;
    setSubmitting(true);
    setError("");
    try {
      await apiClient.post(`/api/sales/contracts/${data.contract.id}/accept`, {
        acceptedName,
        expectedTermsHash: data.rendered.termsHash,
        confirmAuthority,
        confirmIndependentContractor: confirmIndependent,
        confirmMarketplaceExample: confirmExample,
      });
      await load();
    } catch (requestError: any) {
      setError(requestError?.response?.data?.error || "Could not record your acceptance.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-label="Loading" />
      </div>
    );
  }

  const isActive = ["ACTIVE", "EXPIRING"].includes(String(data?.contract.status || ""));
  const canAccept = ["SENT", "VIEWED"].includes(String(data?.contract.status || ""));

  return (
    <ContractFrame active={isActive}>
      <SalesPageHeader
        icon={FileSignature}
        eyebrow="Agreement and access"
        title="Sales partner agreement"
        description="Review the complete agreement, follow its signing status and retain the executed PDF for your records."
        actions={data ? (
          <a
            href={`/api/sales/contracts/${data.contract.id}/download`}
            className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-4 text-sm font-bold text-emerald-800 no-underline hover:bg-emerald-50"
          >
            <Download className="h-4 w-4" />Download PDF
          </a>
        ) : null}
      />

      {error ? (
        <p className="mt-5 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="border border-slate-200 bg-white p-4">
              <p className="text-xs text-gray-500">Contract</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">{data.contract.contractNumber}</p>
              <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs ${statusTone(data.contract.status)}`}>
                {data.contract.status}
              </span>
            </div>
            <div className="border border-slate-200 bg-white p-4">
              <p className="text-xs text-gray-500">Term</p>
              <p className="mt-1 text-sm text-gray-900">
                {date(data.contract.startsAt)} to {date(data.contract.expiresAt)}
              </p>
            </div>
            <div className="border border-slate-200 bg-white p-4">
              <p className="text-xs text-gray-500">Commission rates</p>
              <p className="mt-1 text-sm font-semibold text-gray-900">
                {data.contract.nrmsCommissionRate}% NRMS
              </p>
              <p className="text-sm font-semibold text-gray-900">
                {data.contract.marketplaceRevenueRate}% marketplace
              </p>
            </div>
            <div className="border border-slate-200 bg-white p-4">
              <p className="text-xs text-gray-500">Territory</p>
              <p className="mt-1 text-sm text-gray-900">{data.contract.territory || "As stated in agreement"}</p>
            </div>
          </section>

          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-gray-900">Agreement timeline</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {data.timeline.map((event, index) => (
                <li key={`${event.status}-${index}`} className="border-l-2 border-brand pl-3">
                  <p className="text-xs font-medium text-gray-900">{event.status}</p>
                  <p className="mt-1 text-xs text-gray-500">{date(event.at)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Full agreement</h2>
              <span className="text-xs text-gray-500">
                SHA-256 {data.rendered.bodyHash.slice(0, 12)}…
              </span>
            </div>
            <pre className="mt-4 max-h-[60vh] overflow-auto whitespace-pre-wrap rounded-lg bg-gray-50 p-4 font-sans text-sm leading-6 text-gray-800">
              {data.rendered.content}
            </pre>
          </section>

          {canAccept ? (
            <section className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-base font-semibold text-gray-900">Accept this agreement</h2>
              <p className="mt-1 text-sm text-gray-700">
                Your typed legal name, time, IP address and browser details form part of the acceptance evidence.
              </p>

              <div className="mt-4 space-y-3 text-sm text-gray-800">
                <label className="flex gap-3">
                  <input type="checkbox" checked={confirmExample} onChange={(event) => setConfirmExample(event.target.checked)} />
                  <span>I understand the marketplace worked example and that my percentage applies to eligible NoLSAF commission, not booking value.</span>
                </label>
                <label className="flex gap-3">
                  <input type="checkbox" checked={confirmIndependent} onChange={(event) => setConfirmIndependent(event.target.checked)} />
                  <span>I understand that I am entering this agreement as an independent contractor.</span>
                </label>
                <label className="flex gap-3">
                  <input type="checkbox" checked={confirmAuthority} onChange={(event) => setConfirmAuthority(event.target.checked)} />
                  <span>I have authority to accept this agreement and agree to be bound by it.</span>
                </label>
              </div>

              <label className="mt-5 block text-sm font-medium text-gray-900">
                Type your legal name
                <input
                  value={acceptedName}
                  onChange={(event) => setAcceptedName(event.target.value)}
                  autoComplete="name"
                  className="mt-2 block w-full max-w-md rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={accept}
                disabled={!confirmAuthority || !confirmIndependent || !confirmExample || !acceptedName.trim() || submitting}
                className="mt-5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Recording acceptance…" : "Accept agreement"}
              </button>
            </section>
          ) : data.contract.status === "SIGNED" ? (
            <section className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-5">
              <h2 className="text-sm font-semibold text-blue-900">Signature received</h2>
              <p className="mt-1 text-sm text-blue-800">
                Accepted on {date(data.contract.signedAt)}. An administrator must countersign and activate your workspace.
              </p>
              {data.contract.acceptanceHash ? (
                <p className="mt-2 break-all font-mono text-xs text-blue-700">
                  Acceptance reference: {data.contract.acceptanceHash}
                </p>
              ) : null}
            </section>
          ) : null}
        </>
      ) : null}
    </ContractFrame>
  );
}
