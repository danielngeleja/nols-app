"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Download, FileSignature, Hash, MapPinned, Percent, ShieldCheck } from "lucide-react";
import apiClient from "@/lib/apiClient";
import SalesShell, { codeLabel, statusTone } from "@/components/SalesShell";
import { useSalesWorkspace } from "@/components/sales/SalesWorkspaceContext";

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
    timeZone: "Africa/Dar_es_Salaam",
  });
}

function dayOnly(value: string | null): string {
  if (!value) return "Pending";
  return new Date(value).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Africa/Dar_es_Salaam" });
}

/** How far through its term the agreement is, and the days left. */
function termProgress(startsAt: string, expiresAt: string, now = Date.now()) {
  const start = new Date(startsAt).getTime();
  const end = new Date(expiresAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const percent = Math.min(100, Math.max(0, ((now - start) / (end - start)) * 100));
  const daysLeft = Math.max(0, Math.ceil((end - now) / 86_400_000));
  return { percent, daysLeft, notStarted: now < start };
}

const TIMELINE_STEPS = ["CREATED", "SENT", "VIEWED", "SIGNED", "ACTIVE"] as const;

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

/** "NoLSAF SALES PARTNER AGREEMENT" -> "Sales partner agreement". */
function documentTitle(raw: string): string {
  const t = raw.replace(/^NoLSAFs+/i, "").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : "Sales partner agreement";
}

function AgreementDocument({ content, hash }: { content: string; hash?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const metadata: Array<{ label: string; value: string }> = [];
  const blocks: ReactNode[] = [];
  let codeRows: Array<{ label: string; value: string }> = [];
  let inCode = false;
  let title = "NoLSAF Sales Partner Agreement";

  const flushCodeTable = () => {
    if (!codeRows.length) return;
    // Read as a sum, top to bottom: each line says what it does to the one before.
    const step = (label: string): { op: string; kind: "start" | "apply" | "subtotal" | "result" } => {
      const l = label.toLowerCase();
      if (/partner earning/.test(l)) return { op: "=", kind: "result" };
      if (/eligible|net /.test(l)) return { op: "=", kind: "subtotal" };
      if (/tax|processing|fee/.test(l)) return { op: "−", kind: "apply" };
      if (/rate|commission/.test(l)) return { op: "×", kind: "apply" };
      return { op: "", kind: "start" };
    };
    blocks.push(
      <figure key={`table-${blocks.length}`} className="my-5 max-w-xl overflow-hidden rounded-md border border-solid border-slate-200">
        <figcaption className="flex items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 bg-slate-50 px-4 py-2.5">
          <span className="text-[13px] font-semibold text-slate-900">Worked marketplace example</span>
          <span className="text-[11.5px] text-slate-500">Illustration only</span>
        </figcaption>
        <table className="w-full border-collapse text-left text-sm">
          <tbody>
            {codeRows.map((row, index) => {
              const s = step(row.label);
              const result = s.kind === "result";
              const subtotal = s.kind === "subtotal";
              return (
                <tr key={`${row.label}-${index}`} className={result ? "bg-[#02665e]/[0.06]" : "bg-white"}>
                  <td className={`w-8 py-2.5 pl-4 pr-0 text-center font-mono text-[14px] font-semibold ${result ? "text-[#02665e]" : "text-slate-400"} ${index ? "border-0 border-t border-solid " + (subtotal || result ? "border-slate-300" : "border-slate-100") : ""}`}>
                    {s.op}
                  </td>
                  <td className={`px-3 py-2.5 ${result ? "font-semibold text-[#02665e]" : subtotal ? "font-medium text-slate-900" : "text-slate-600"} ${index ? "border-0 border-t border-solid " + (subtotal || result ? "border-slate-300" : "border-slate-100") : ""}`}>
                    {row.label}
                  </td>
                  <td className={`px-4 py-2.5 text-right tabular-nums ${result ? "text-[16px] font-bold text-[#02665e]" : subtotal ? "font-semibold text-slate-900" : "font-medium text-slate-800"} ${index ? "border-0 border-t border-solid " + (subtotal || result ? "border-slate-300" : "border-slate-100") : ""}`}>
                    {row.value}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </figure>,
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
        <section key={`heading-${blocks.length}`} className="mt-8 border-0 border-t border-solid border-slate-200 pt-6 first:mt-0 first:border-t-0 first:pt-0">
          <div className="flex items-center gap-3">
            <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-xs font-bold text-[#02665e]">
              {heading.match(/^\d+/)?.[0] || "•"}
            </span>
            <h3 className="m-0 text-[17px] font-bold tracking-tight text-slate-900">
              {heading.replace(/^\d+\.\s*/, "")}
            </h3>
          </div>
        </section>,
      );
      continue;
    }
    if (line.trim() === "Partner" || line.trim() === "For NoLSAF") {
      blocks.push(
        <h3 key={`signature-${blocks.length}`} className="mb-0 mt-6 border-0 border-b border-solid border-slate-200 pb-2 text-base font-bold text-slate-900">
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
          <span className="font-semibold tabular-nums text-[#02665e]">{clause[1]}</span>
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
    <article style={CONTRACT_FONT} className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
      <header className="flex flex-wrap items-center justify-between gap-3 border-0 border-b border-solid border-slate-200 px-5 py-4 sm:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-[#02665e]/10 text-[#02665e]">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0 leading-tight">
            <h2 className="m-0 text-[17px] font-bold text-slate-900">{documentTitle(title)}</h2>
            <p className="m-0 mt-0.5 text-[12px] text-slate-500">Full legal terms · controlled agreement record</p>
          </div>
        </div>
        {hash ? (
          <span title={`SHA-256 ${hash}`} className="rounded border border-solid border-slate-200 bg-slate-50 px-2 py-1 font-mono text-[11px] text-slate-500">
            SHA-256 {hash.slice(0, 12)}
          </span>
        ) : null}
      </header>

      {metadata.length ? (
        <dl className="m-0 grid gap-px border-0 border-b border-solid border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-3">
          {metadata.map((item) => (
            <div key={item.label} className="min-w-0 bg-slate-50 px-5 py-3 sm:px-8 lg:px-5">
              <dt className="text-[12px] text-slate-500">{item.label.charAt(0) + item.label.slice(1).toLowerCase()}</dt>
              <dd className="m-0 mt-0.5 break-words text-[13.5px] font-semibold text-slate-900">{item.value}</dd>
            </div>
          ))}
        </dl>
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
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-lg border border-solid border-white/10 bg-brand-800 px-5 py-4 shadow-[0_20px_45px_-30px_rgba(1,45,40,0.9)]">
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

function ContractLoadingContent() {
  return (
    <div className="space-y-6" role="status" aria-label="Loading sales agreement">
      <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        <div className="flex items-start gap-4 px-5 py-6 sm:px-7 sm:py-7">
          <span className="h-14 w-14 shrink-0 animate-pulse rounded-md bg-emerald-100" />
          <div className="min-w-0 flex-1 space-y-3 pt-1">
            <span className="block h-3 w-36 animate-pulse rounded-full bg-emerald-100" />
            <span className="block h-7 w-72 max-w-full animate-pulse rounded-lg bg-slate-200" />
            <span className="block h-4 w-full max-w-2xl animate-pulse rounded-full bg-slate-100" />
          </div>
        </div>
        <div className="grid gap-px border-t border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-3 bg-white px-5 py-5 sm:px-6">
              <span className="block h-3 w-24 animate-pulse rounded-full bg-slate-100" />
              <span className="block h-5 w-36 max-w-full animate-pulse rounded-full bg-slate-200" />
              <span className="block h-3 w-28 animate-pulse rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-solid border-slate-200 bg-white p-5">
        <span className="block h-4 w-36 animate-pulse rounded-full bg-slate-200" />
        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="space-y-2 border-l-2 border-emerald-100 pl-4">
              <span className="block h-3 w-20 animate-pulse rounded-full bg-slate-200" />
              <span className="block h-3 w-28 animate-pulse rounded-full bg-slate-100" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default function SalesContractPage() {
  const { me: workspaceMe } = useSalesWorkspace();
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

  const workspaceContractActive = ["ACTIVE", "EXPIRING"].includes(String(workspaceMe?.contract?.status || ""));
  const isActive = data
    ? ["ACTIVE", "EXPIRING"].includes(String(data.contract.status || ""))
    : workspaceContractActive;
  const canAccept = ["SENT", "VIEWED"].includes(String(data?.contract.status || ""));

  if (loading) {
    return (
      <ContractFrame active={workspaceContractActive}>
        <ContractLoadingContent />
      </ContractFrame>
    );
  }

  return (
    <ContractFrame active={isActive}>
      <section className="overflow-hidden rounded-lg border border-solid border-slate-200 bg-white">
        <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-5 sm:px-6">
          <div className="flex min-w-0 items-start gap-3.5">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#02665e] text-white">
              <FileSignature className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="m-0 text-[22px] font-bold leading-tight tracking-tight text-slate-950">Sales partner agreement</h1>
                {data ? (
                  <span className={`inline-flex rounded px-2 py-0.5 text-[11px] font-semibold ${statusTone(data.contract.status)}`}>
                    {codeLabel(data.contract.status)}
                  </span>
                ) : null}
              </div>
              <p className="mb-0 mt-1 max-w-3xl text-[13.5px] leading-6 text-slate-600">
                Your terms, signing progress and the executed agreement, kept on record.
              </p>
            </div>
          </div>

          {data ? (
            <a
              href={`/api/sales/contracts/${data.contract.id}/download`}
              className="inline-flex h-10 shrink-0 items-center gap-2 rounded-md bg-[#02665e] px-4 text-sm font-semibold text-white no-underline transition hover:bg-[#014e47]"
            >
              <Download className="h-4 w-4" />
              Download PDF
            </a>
          ) : null}
        </div>

        {data ? (() => {
          const term = termProgress(data.contract.startsAt, data.contract.expiresAt);
          const label = "flex items-center gap-1.5 text-[12px] font-medium text-slate-500";
          return (
            <dl className="m-0 grid gap-px border-0 border-t border-solid border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
              <div className="min-w-0 bg-white px-5 py-4 sm:px-6">
                <dt className={label}><Hash className="h-3.5 w-3.5 text-[#02665e]" />Agreement number</dt>
                <dd className="m-0 mt-1.5 font-mono text-[15px] font-semibold tracking-wide text-slate-900">{data.contract.contractNumber}</dd>
                <dd className="m-0 mt-1 text-[12px] text-slate-500">
                  {data.contract.activatedAt ? `Active since ${dayOnly(data.contract.activatedAt)}` : data.contract.signedAt ? `Signed ${dayOnly(data.contract.signedAt)}` : "Not signed yet"}
                </dd>
              </div>

              <div className="min-w-0 bg-white px-5 py-4 sm:px-6">
                <dt className={label}><CalendarClock className="h-3.5 w-3.5 text-[#02665e]" />Term</dt>
                <dd className="m-0 mt-1.5 text-[14px] font-semibold text-slate-900">
                  {dayOnly(data.contract.startsAt)} <span className="font-normal text-slate-400">to</span> {dayOnly(data.contract.expiresAt)}
                </dd>
                {term ? (
                  <dd className="m-0 mt-2">
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className={`h-full rounded-full ${term.daysLeft <= 30 ? "bg-amber-500" : "bg-[#02665e]"}`} style={{ width: `${term.percent}%` }} />
                    </div>
                    <p className={`m-0 mt-1 text-[12px] ${term.daysLeft <= 30 ? "font-semibold text-amber-700" : "text-slate-500"}`}>
                      {term.notStarted ? "Starts soon" : `${term.daysLeft} day${term.daysLeft === 1 ? "" : "s"} left`}
                    </p>
                  </dd>
                ) : null}
              </div>

              <div className="min-w-0 bg-white px-5 py-4 sm:px-6">
                <dt className={label}><Percent className="h-3.5 w-3.5 text-[#02665e]" />Your commission</dt>
                <dd className="m-0 mt-1.5 grid grid-cols-2 gap-3">
                  <div>
                    <p className="m-0 text-[20px] font-bold leading-none tabular-nums text-slate-900">{data.contract.nrmsCommissionRate}%</p>
                    <p className="m-0 mt-1 text-[12px] text-slate-500">NRMS</p>
                  </div>
                  <div className="border-0 border-l border-solid border-slate-200 pl-3">
                    <p className="m-0 text-[20px] font-bold leading-none tabular-nums text-slate-900">{data.contract.marketplaceRevenueRate}%</p>
                    <p className="m-0 mt-1 text-[12px] text-slate-500">Marketplace</p>
                  </div>
                </dd>
              </div>

              <div className="min-w-0 bg-white px-5 py-4 sm:px-6">
                <dt className={label}><MapPinned className="h-3.5 w-3.5 text-[#02665e]" />Territory</dt>
                <dd className="m-0 mt-1.5 text-[15px] font-semibold text-slate-900">{data.contract.territory || "As stated in the agreement"}</dd>
                <dd className="m-0 mt-1 text-[12px] text-slate-500">Where you may register leads</dd>
              </div>
            </dl>
          );
        })() : null}
      </section>

      {error ? (
        <p className="mt-5 rounded-md border border-solid border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          {/* Signing progress: the five fixed steps, done or still to come, joined by one line */}
          <section className="mt-4 rounded-lg border border-solid border-slate-200 bg-white px-5 py-4 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <h2 className="m-0 text-[14px] font-semibold text-slate-900">Signing progress</h2>
              <span className="text-[12px] text-slate-500">Times in EAT</span>
            </div>
            {(() => {
              const reached = new Map<string, string>();
              for (const event of data.timeline) if (!reached.has(event.status)) reached.set(event.status, event.at);
              const steps = TIMELINE_STEPS.map((status) => ({ status, at: reached.get(status) ?? null }));
              const lastDone = steps.reduce((acc, step, i) => (step.at ? i : acc), -1);
              return (
                <ol className="m-0 mt-4 grid list-none grid-cols-1 gap-3 p-0 sm:grid-cols-5 sm:gap-0">
                  {steps.map((step, i) => {
                    const done = Boolean(step.at);
                    const current = i === lastDone + 1;
                    return (
                      <li key={step.status} className="relative flex items-start gap-3 sm:flex-col sm:items-start sm:gap-2 sm:pr-3">
                        {/* connector to the next step (desktop) */}
                        {i < steps.length - 1 ? (
                          <span aria-hidden className={`absolute left-[26px] right-0 top-[9px] hidden h-0.5 sm:block ${i < lastDone ? "bg-[#02665e]" : "bg-slate-200"}`} />
                        ) : null}
                        <span
                          className={`relative z-[1] inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${
                            done ? "bg-[#02665e] text-white" : current ? "border-2 border-solid border-[#02665e] bg-white" : "border-2 border-solid border-slate-200 bg-white"
                          }`}
                        >
                          {done ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
                        </span>
                        <div className="min-w-0 leading-tight">
                          <p className={`m-0 text-[13px] font-semibold ${done ? "text-slate-900" : current ? "text-[#02665e]" : "text-slate-400"}`}>{codeLabel(step.status)}</p>
                          <p className="m-0 mt-0.5 text-[12px] tabular-nums text-slate-500">{step.at ? date(step.at) : current ? "Next" : "Not yet"}</p>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              );
            })()}
          </section>

          <section className="mt-4">
            <AgreementDocument
              content={data.rendered.content}
              hash={data.rendered.bodyHash}
            />
          </section>

          {canAccept ? (
            <section className="mt-4 rounded-lg border border-solid border-amber-200 bg-amber-50 p-5">
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
                  className="mt-2 block w-full max-w-md rounded-md border border-solid border-slate-300 bg-white px-3 py-2 text-sm"
                />
              </label>
              <button
                type="button"
                onClick={accept}
                disabled={!confirmAuthority || !confirmIndependent || !confirmExample || !acceptedName.trim() || submitting}
                className="mt-5 cursor-pointer rounded-md border-0 bg-[#02665e] px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Recording acceptance…" : "Accept agreement"}
              </button>
            </section>
          ) : data.contract.status === "SIGNED" ? (
            <section className="mt-4 rounded-lg border border-solid border-blue-200 bg-blue-50 p-5">
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
