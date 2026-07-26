"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Download, FileSignature, Hash, MapPinned, Percent, ShieldCheck } from "lucide-react";
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

const CONTRACT_FONT = {
  fontFamily: '"Trebuchet MS", "Lucida Sans Unicode", "Lucida Grande", Arial, sans-serif',
} as const;

const AGREEMENT_SECTION_TITLES = new Set([
  "Nature of the relationship",
  "Term",
  "Territory",
  "Attribution",
  "What the Partner earns",
  "When the Partner earns",
  "Reversal",
  "Payment",
  "Conduct",
  "Termination",
  "Governing law and disputes",
  "Entire agreement",
  "Notices",
  "Confidentiality and records",
  "Responsibility and claims",
  "Events outside reasonable control",
  "Assignment and transfer",
  "Electronic records",
  "Acceptance",
]);

const AGREEMENT_METADATA_LABELS = new Set([
  "Contract ID",
  "Contract Version",
  "Agent Code",
  "Commencement Date",
  "Expiry Date",
]);

const WORKED_EXAMPLE_LABELS = new Set([
  "Booking value",
  "NoLSAF commission (10%)",
  "Tax and processing",
  "Eligible net NoLSAF revenue",
  "Partner rate",
  "Partner earning",
]);

function inlineContractText(value: string): ReactNode {
  return value.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={index} className="font-bold text-slate-950">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}

function AgreementDocument({ content }: { content: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const metadata: Array<{ label: string; value: string }> = [];
  const blocks: ReactNode[] = [];
  let codeRows: Array<{ label: string; value: string }> = [];
  let inCode = false;
  let title = "NoLSAF Sales Partner Agreement";

  const flushCodeTable = () => {
    if (!codeRows.length) return;
    blocks.push(
      <div key={`table-${blocks.length}`} className="my-5 overflow-hidden rounded-xl border border-emerald-200">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="bg-[#073c35] text-white">
              <th className="px-4 py-3 font-bold">Worked marketplace example</th>
              <th className="px-4 py-3 text-right font-bold">Amount</th>
            </tr>
          </thead>
          <tbody>
            {codeRows.map((row, index) => (
              <tr key={`${row.label}-${index}`} className={index % 2 ? "bg-slate-50" : "bg-white"}>
                <td className="border-t border-slate-200 px-4 py-3 text-slate-700">{row.label}</td>
                <td className="border-t border-slate-200 px-4 py-3 text-right font-bold tabular-nums text-slate-950">
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
    codeRows = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (line.trim() === "```") {
      if (inCode) flushCodeTable();
      inCode = !inCode;
      continue;
    }
    if (inCode) {
      const match = line.trim().match(/^(.+?):\s{2,}(.+)$/);
      if (match) {
        codeRows.push({
          label: match[1].trim(),
          value: match[2].replace(/\s+/g, " ").trim(),
        });
      }
      continue;
    }
    const workedExampleMatch = line.trim().match(/^(.+?):\s{2,}(.+)$/);
    if (workedExampleMatch && WORKED_EXAMPLE_LABELS.has(workedExampleMatch[1].trim())) {
      codeRows.push({
        label: workedExampleMatch[1].trim(),
        value: workedExampleMatch[2].replace(/\s+/g, " ").trim(),
      });
      continue;
    }
    if (codeRows.length) flushCodeTable();

    if (line.startsWith("# ") || line.trim() === "NoLSAF SALES PARTNER AGREEMENT") {
      title = line.slice(2).trim();
      if (!line.startsWith("# ")) title = line.trim();
      continue;
    }
    const metadataMatch =
      line.match(/^\*\*(.+?):\*\*\s*(.+)$/) ||
      line.match(/^([^:]+):\s*(.+)$/);
    if (metadataMatch && blocks.length === 0 && AGREEMENT_METADATA_LABELS.has(metadataMatch[1].trim())) {
      metadata.push({ label: metadataMatch[1], value: metadataMatch[2] });
      continue;
    }
    const plainSectionMatch = line.match(/^(\d+)\.\s+(.+)$/);
    const isPlainSection = Boolean(
      plainSectionMatch && AGREEMENT_SECTION_TITLES.has(plainSectionMatch[2].trim()),
    );
    if (line.startsWith("## ") || isPlainSection) {
      const heading = line.startsWith("## ") ? line.slice(3).trim() : line.trim();
      blocks.push(
        <section key={`heading-${blocks.length}`} className="mt-8 border-t border-slate-200 pt-6 first:mt-0 first:border-0 first:pt-0">
          <div className="flex items-center gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-emerald-50 text-xs font-black text-emerald-800">
              {heading.match(/^\d+/)?.[0] || "•"}
            </span>
            <h3 className="m-0 text-lg font-bold tracking-tight text-[#073c35]">
              {heading.replace(/^\d+\.\s*/, "")}
            </h3>
          </div>
        </section>,
      );
      continue;
    }
    if (line.trim() === "Partner" || line.trim() === "For NoLSAF") {
      blocks.push(
        <h3 key={`signature-${blocks.length}`} className="mb-0 mt-6 border-b border-slate-200 pb-2 text-base font-bold text-[#073c35]">
          {line.trim()}
        </h3>,
      );
      continue;
    }
    if (!line.trim()) continue;

    const clause = line.match(/^(\d+(?:\.\d+)?)\s+(.+)$/);
    if (clause) {
      blocks.push(
        <div key={`clause-${blocks.length}`} className="mt-3 grid grid-cols-[3.2rem_minmax(0,1fr)] gap-2 text-sm leading-7 text-slate-700">
          <span className="font-bold tabular-nums text-emerald-800">{clause[1]}</span>
          <p className="m-0">{inlineContractText(clause[2])}</p>
        </div>,
      );
      continue;
    }

    blocks.push(
      <p key={`paragraph-${blocks.length}`} className="mb-0 mt-3 text-sm leading-7 text-slate-700">
        {inlineContractText(line)}
      </p>,
    );
  }
  flushCodeTable();

  return (
    <article style={CONTRACT_FONT} className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_20px_55px_-45px_rgba(15,23,42,0.45)]">
      <header className="bg-[#073c35] px-5 py-6 text-white sm:px-8">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="m-0 text-[10px] font-bold uppercase tracking-[0.2em] text-emerald-200">NoLSAF legal document</p>
            <h2 className="mb-0 mt-2 text-2xl font-bold tracking-tight">{title.replace(/^NoLSAF\s+/i, "")}</h2>
            <p className="mb-0 mt-2 text-xs text-white/70">Partner onboarding · Controlled agreement record</p>
          </div>
          <ShieldCheck className="h-9 w-9 text-emerald-200" aria-hidden="true" />
        </div>
      </header>

      {metadata.length ? (
        <div className="border-b border-slate-200 bg-slate-50/80 px-5 py-5 sm:px-8">
          <table className="w-full border-collapse text-sm">
            <tbody>
              {metadata.map((item) => (
                <tr key={item.label}>
                  <th className="w-[38%] border-b border-slate-200 py-2.5 pr-4 text-left text-[11px] font-bold uppercase tracking-wide text-slate-500 last:border-0">
                    {item.label}
                  </th>
                  <td className="border-b border-slate-200 py-2.5 font-bold text-slate-900 last:border-0">
                    {item.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <div className="px-5 py-6 sm:px-8 sm:py-8">{blocks}</div>
    </article>
  );
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
      <header className="px-4 pt-4 text-white sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-[24px] border border-white/10 bg-brand-800 px-5 py-4 shadow-[0_20px_45px_-30px_rgba(1,45,40,0.9)]">
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
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500"><Hash className="h-4 w-4" /><p className="m-0 text-xs">Contract</p></div>
              <p className="mt-2 text-sm font-bold text-gray-900">{data.contract.contractNumber}</p>
              <span className={`mt-2 inline-flex rounded-full px-2 py-1 text-xs ${statusTone(data.contract.status)}`}>
                {data.contract.status}
              </span>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500"><CalendarClock className="h-4 w-4" /><p className="m-0 text-xs">Term</p></div>
              <p className="mt-2 text-sm leading-6 text-gray-900">
                {date(data.contract.startsAt)} to {date(data.contract.expiresAt)}
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500"><Percent className="h-4 w-4" /><p className="m-0 text-xs">Commission rates</p></div>
              <p className="mt-2 text-sm font-bold text-gray-900">
                {data.contract.nrmsCommissionRate}% NRMS
              </p>
              <p className="text-sm font-bold text-gray-900">
                {data.contract.marketplaceRevenueRate}% marketplace
              </p>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center gap-2 text-slate-500"><MapPinned className="h-4 w-4" /><p className="m-0 text-xs">Territory</p></div>
              <p className="mt-2 text-sm font-semibold text-gray-900">{data.contract.territory || "As stated in agreement"}</p>
            </div>
          </section>

          <section className="mt-6 rounded-[22px] border border-gray-200 bg-white p-5 shadow-sm">
            <h2 className="text-sm font-bold text-gray-900">Agreement timeline</h2>
            <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              {data.timeline.map((event, index) => (
                <li key={`${event.status}-${index}`} className="relative border-l-2 border-brand pl-4">
                  <CheckCircle2 className="absolute -left-[9px] top-0 h-4 w-4 bg-white text-emerald-700" />
                  <p className="text-xs font-bold text-gray-900">{event.status}</p>
                  <p className="mt-1 text-xs text-gray-500">{date(event.at)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section className="mt-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="m-0 text-[10px] font-black uppercase tracking-[0.16em] text-emerald-700">Complete legal terms</p>
                <h2 className="mb-0 mt-1 text-xl font-bold text-gray-950">Full agreement</h2>
              </div>
              <span className="text-xs text-gray-500">
                SHA-256 {data.rendered.bodyHash.slice(0, 12)}…
              </span>
            </div>
            <div className="mt-4">
              <AgreementDocument content={data.rendered.content} />
            </div>
          </section>

          {canAccept ? (
            <section className="mt-6 rounded-[22px] border border-amber-200 bg-amber-50 p-5 shadow-sm">
              <h2 className="text-base font-bold text-gray-900">Accept this agreement</h2>
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
