"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import QRCode from "qrcode";
import { CheckCircle2, Clock3, FileText, Loader2, PenLine, ShieldCheck, X } from "lucide-react";

type ContractKeyTerms = {
  commissionPercent?: number | null;
  settlementMinHours?: number;
  settlementMaxDays?: number;
  payoutCurrency?: string;
  changeNoticeDays?: number;
};

type AgentContractPayload = {
  ok?: boolean;
  contract?: {
    title?: string;
    content?: string;
    generatedAt?: string;
  };
  workflow?: {
    status?: "PENDING_NOLSAF_SIGNATURE" | "PENDING_AGENT_SIGNATURE" | "EXECUTED";
    nolsafSignedAt?: string;
    agentSignedAt?: string;
    nolsafSignatoryName?: string;
    agentSignerName?: string;
    contractId?: string;
    version?: string;
  } | null;
  currentVersion?: string;
  signerName?: string | null;
  keyTerms?: ContractKeyTerms;
  error?: string;
  message?: string;
};

type ContractBlock =
  | { type: "h1"; text: string }
  | { type: "h2"; text: string; number: string | null }
  | { type: "h3"; text: string }
  | { type: "clause"; number: string; level: number; text: string }
  | { type: "meta"; rows: Array<{ label: string; value: string }> }
  | { type: "list"; items: string[] }
  | {
      type: "signatureColumns";
      leftTitle: string;
      leftItems: string[];
      rightTitle: string;
      rightItems: string[];
    }
  | { type: "paragraph"; text: string };

const stripInlineMarkdown = (input: string): string => {
  return input
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
    .trim();
};

/** Shows **defined terms** in bold, the way the agreement is written. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i} className="font-semibold text-neutral-900">
            {part.slice(2, -2)}
          </strong>
        ) : (
          <React.Fragment key={i}>{part.replace(/__([^_]+)__/g, "$1").replace(/`([^`]+)`/g, "$1")}</React.Fragment>
        )
      )}
    </>
  );
}

const parseContractBlocks = (raw: string): ContractBlock[] => {
  const lines = raw.replace(/\r/g, "").split("\n");
  const blocks: ContractBlock[] = [];
  let listBuffer: string[] = [];

  const flushList = () => {
    if (listBuffer.length > 0) {
      blocks.push({ type: "list", items: listBuffer });
      listBuffer = [];
    }
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      flushList();
      continue;
    }

    const h1 = trimmed.match(/^#\s+(.+)$/);
    if (h1) {
      flushList();
      blocks.push({ type: "h1", text: stripInlineMarkdown(h1[1]) });
      continue;
    }

    const h2 = trimmed.match(/^##\s+(.+)$/);
    if (h2) {
      flushList();
      const text = stripInlineMarkdown(h2[1]);
      const numbered = text.match(/^(\d+)\.\s+(.+)$/);
      blocks.push({ type: "h2", number: numbered ? numbered[1] : null, text: numbered ? numbered[2] : text });
      continue;
    }

    const h3 = trimmed.match(/^###\s+(.+)$/);
    if (h3) {
      flushList();
      blocks.push({ type: "h3", text: stripInlineMarkdown(h3[1]) });
      continue;
    }

    const labelLine = trimmed.match(/^\*\*([^*]+):\*\*\s*(.+)$/);
    if (labelLine) {
      flushList();
      const row = { label: stripInlineMarkdown(labelLine[1]), value: stripInlineMarkdown(labelLine[2]) };
      const last = blocks[blocks.length - 1];
      if (last?.type === "meta") last.rows.push(row);
      else blocks.push({ type: "meta", rows: [row] });
      continue;
    }

    const bullet = trimmed.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      listBuffer.push(bullet[1].trim());
      continue;
    }

    const clauseLine = trimmed.match(/^(\d+(?:\.\d+)*)(?:\.)?\s+(.+)$/);
    if (clauseLine) {
      flushList();
      const clauseNumber = clauseLine[1];
      blocks.push({
        type: "clause",
        number: clauseNumber,
        level: clauseNumber.split(".").length,
        text: clauseLine[2].trim(),
      });
      continue;
    }

    flushList();
    blocks.push({ type: "paragraph", text: trimmed });
  }

  flushList();

  // The signature section becomes two side-by-side columns.
  const enhanced: ContractBlock[] = [];
  for (let i = 0; i < blocks.length; i += 1) {
    const current = blocks[i];
    const next = blocks[i + 1];
    const third = blocks[i + 2];
    const fourth = blocks[i + 3];

    const looksLikeLeftHeader = current?.type === "paragraph" && /^FOR\s+NOLSAF$/i.test(current.text.trim());
    const looksLikeRightHeader = third?.type === "paragraph" && /^FOR\s+THE\s+OPERATOR$/i.test(third.text.trim());

    if (looksLikeLeftHeader && next?.type === "list" && looksLikeRightHeader && fourth?.type === "list") {
      enhanced.push({
        type: "signatureColumns",
        leftTitle: "For NoLSAF",
        leftItems: next.items.map(stripInlineMarkdown),
        rightTitle: "For the operator",
        rightItems: fourth.items.map(stripInlineMarkdown),
      });
      i += 3;
      continue;
    }

    enhanced.push(current);
  }

  return enhanced;
};

const sectionAnchorId = (number: string): string => `contract-section-${number}`;

function signatureHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return (h >>> 0).toString(16).toUpperCase().padStart(8, "0");
}

function buildSignatureCode(params: {
  contractId: string;
  version: string;
  party: "NOLSAF" | "OPERATOR";
  signedAt: string;
}): string {
  const fingerprint = signatureHash(`${params.contractId}|${params.version}|${params.party}|${params.signedAt}`);
  return `NLS-SIG-${params.party}-${fingerprint}`;
}

const formatSignedAt = (at: string) =>
  new Date(at).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Africa/Dar_es_Salaam",
  }) + " EAT";

export default function AgentContractContent() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [content, setContent] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [workflow, setWorkflow] = useState<NonNullable<AgentContractPayload["workflow"]> | null>(null);
  const [keyTerms, setKeyTerms] = useState<ContractKeyTerms | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [signatureQr, setSignatureQr] = useState<{ nolsaf: string | null; operator: string | null }>({
    nolsaf: null,
    operator: null,
  });
  const [signing, setSigning] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // Signing is a deliberate act: a confirm card with consent and the typed name.
  const [signerName, setSignerName] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [typedName, setTypedName] = useState("");
  const [signError, setSignError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const controller = new AbortController();

    const loadContract = async () => {
      try {
        setLoading(true);
        setError(null);

        const res = await fetch("/api/agent/contract", {
          credentials: "include",
          signal: controller.signal,
        });

        const data = (await res.json().catch(() => ({}))) as AgentContractPayload;

        if (!mounted) return;

        if (!res.ok || !data?.contract?.content) {
          setContent("");
          setWorkflow(null);
          setError(data?.message || data?.error || "Contract is not available yet.");
          return;
        }

        setContent(String(data.contract.content));
        setTitle(String(data.contract.title || ""));
        setWorkflow(data.workflow || null);
        setKeyTerms(data.keyTerms || null);
        setCurrentVersion(String(data.currentVersion || ""));
        setSignerName(String(data.signerName || ""));
      } catch {
        if (!mounted) return;
        setError("Unable to load contract right now.");
      } finally {
        if (mounted) setLoading(false);
      }
    };

    void loadContract();

    return () => {
      mounted = false;
      controller.abort();
    };
  }, [refreshKey]);

  useEffect(() => {
    let mounted = true;

    const generate = async () => {
      if (!workflow?.contractId) {
        if (mounted) setSignatureQr({ nolsaf: null, operator: null });
        return;
      }

      const version = workflow.version || "1.0.0";
      const payloadFor = (party: "NOLSAF" | "OPERATOR", signedAt: string, signer: string | null) =>
        signedAt
          ? JSON.stringify({
              kind: "contract-signature",
              contractId: workflow.contractId,
              version,
              party,
              signer,
              signedAt,
              code: buildSignatureCode({ contractId: workflow.contractId!, version, party, signedAt }),
            })
          : "";

      const nolsafPayload = payloadFor("NOLSAF", workflow.nolsafSignedAt || "", workflow.nolsafSignatoryName || null);
      const operatorPayload = payloadFor("OPERATOR", workflow.agentSignedAt || "", workflow.agentSignerName || null);

      const [nolsafQr, operatorQr] = await Promise.all([
        nolsafPayload ? QRCode.toDataURL(nolsafPayload, { margin: 1, width: 96 }) : Promise.resolve(null),
        operatorPayload ? QRCode.toDataURL(operatorPayload, { margin: 1, width: 96 }) : Promise.resolve(null),
      ]);

      if (mounted) setSignatureQr({ nolsaf: nolsafQr, operator: operatorQr });
    };

    void generate();
    return () => {
      mounted = false;
    };
  }, [workflow]);

  const normaliseName = (v: string) => v.normalize("NFKC").replace(/\s+/g, " ").trim().toLowerCase();
  const nameMatches = Boolean(signerName) && normaliseName(typedName) === normaliseName(signerName);
  const canSign = accepted && nameMatches && !signing;

  const openConfirm = () => {
    setAccepted(false);
    setTypedName("");
    setSignError(null);
    setConfirmOpen(true);
  };

  useEffect(() => {
    if (!confirmOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !signing) setConfirmOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirmOpen, signing]);

  const handleAgentSign = async () => {
    if (!canSign) return;
    setSigning(true);
    setSignError(null);
    try {
      const res = await fetch("/api/agent/contract/sign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accept: true, typedName: typedName.trim(), version: workflow?.version || "" }),
      });
      const data = (await res.json().catch(() => ({}))) as AgentContractPayload;
      if (!res.ok) {
        setSignError(data?.message || data?.error || "The agreement could not be signed right now. Try again.");
        return;
      }
      setConfirmOpen(false);
      setRefreshKey((v) => v + 1);
    } catch {
      setSignError("No connection. Check your network and try again.");
    } finally {
      setSigning(false);
    }
  };

  const blocks = parseContractBlocks(content);
  const sections = blocks.filter((b): b is Extract<ContractBlock, { type: "h2" }> => b.type === "h2" && Boolean(b.number));
  const docTitle = blocks.find((b): b is Extract<ContractBlock, { type: "h1" }> => b.type === "h1")?.text || title || "Partnership agreement";
  const workflowStatus = String(workflow?.status || "").toUpperCase();
  const version = workflow?.version || "";
  const olderVersion = Boolean(version && currentVersion && version !== currentVersion);

  const statusMessage =
    workflowStatus === "PENDING_NOLSAF_SIGNATURE"
      ? "NoLSAF is preparing your agreement. You will be able to sign once NoLSAF has signed."
      : workflowStatus === "PENDING_AGENT_SIGNATURE"
        ? "NoLSAF has signed. Read the agreement, then sign as the operator."
        : workflowStatus === "EXECUTED"
          ? "Signed by NoLSAF and by you. This is your agreement in force."
          : "This agreement has not been prepared yet.";
  const statusTone =
    workflowStatus === "EXECUTED"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : workflowStatus === "PENDING_AGENT_SIGNATURE"
        ? "border-amber-200 bg-amber-50 text-amber-800"
        : "border-neutral-200 bg-neutral-50 text-neutral-600";
  const statusLabel =
    workflowStatus === "EXECUTED"
      ? "In force"
      : workflowStatus === "PENDING_AGENT_SIGNATURE"
        ? "Your signature needed"
        : workflowStatus === "PENDING_NOLSAF_SIGNATURE"
          ? "Awaiting NoLSAF"
          : "Not prepared";

  const signatureSteps: Array<{ party: string; at?: string | null }> = [
    { party: "NoLSAF", at: workflow?.nolsafSignedAt },
    { party: "Operator", at: workflow?.agentSignedAt },
  ];

  // The money terms, stated plainly. Version 1.0.0 was written on a different
  // model, so the summary is only shown for the agreements it describes.
  const terms = keyTerms && !olderVersion ? keyTerms : null;
  const termRows: Array<{ label: string; value: string; note: string }> = terms
    ? [
        {
          label: "What NoLSAF earns",
          value: terms.commissionPercent != null ? `${terms.commissionPercent}% commission` : "Commission per booking",
          note: "Added on top of your package price and paid by the traveller. No subscription or listing fee.",
        },
        {
          label: "What you receive",
          value: "Your full package price",
          note: "Paid as an advance before the trip and the balance after it.",
        },
        {
          label: "When you are paid",
          value: `${terms.settlementMinHours ?? 24} hours to ${terms.settlementMaxDays ?? 3} days`,
          note: "From each claim, to your verified mobile money account.",
        },
        {
          label: "Changes to these terms",
          value: `${terms.changeNoticeDays ?? 30} days' notice`,
          note: "Never applied to bookings made before the change.",
        },
      ]
    : [];

  const card = "rounded-lg border border-solid border-neutral-200 bg-white";

  const contentsList = (compact: boolean) => (
    <ol className="m-0 list-none space-y-0.5 p-0">
      {sections.map((s) => (
        <li key={s.number}>
          <a
            href={`#${sectionAnchorId(s.number!)}`}
            className={`flex gap-2 rounded-md px-2 py-1.5 leading-5 text-neutral-600 no-underline transition hover:bg-emerald-50/70 hover:text-emerald-800 hover:no-underline ${compact ? "text-[12.5px]" : "text-[13px]"}`}
          >
            <span className="w-5 shrink-0 text-right font-semibold tabular-nums text-neutral-400">{s.number}</span>
            <span className="min-w-0">{s.text}</span>
          </a>
        </li>
      ))}
    </ol>
  );

  return (
    <div className="w-full h-full min-h-0">
      {loading ? (
        <div className="space-y-3 px-1 py-2 sm:py-3">
          <div className="h-4 w-48 rounded bg-neutral-200 animate-pulse" />
          <div className="h-4 w-full rounded bg-neutral-200 animate-pulse" />
          <div className="h-4 w-[92%] rounded bg-neutral-200 animate-pulse" />
          <div className="h-4 w-[85%] rounded bg-neutral-200 animate-pulse" />
        </div>
      ) : error ? (
        <div className={`${card} p-5 sm:p-6`}>
          <div className="text-sm font-bold text-neutral-900">Contract unavailable</div>
          <div className="text-sm text-neutral-600 mt-1">{error}</div>
          <div className="mt-4">
            <a
              href="mailto:support@nolsaf.com"
              className="inline-flex h-10 items-center justify-center rounded-md bg-brand px-5 text-sm font-semibold text-white no-underline transition-colors hover:bg-brand-700"
            >
              Email support
            </a>
          </div>
        </div>
      ) : (
        <div className="h-full overflow-auto">
          <div className="mx-auto grid w-full max-w-[92rem] gap-5 pb-6 xl:grid-cols-[minmax(0,1fr)_18rem] xl:items-start">
            <article className="min-w-0 space-y-4 text-left">
              {/* Standing: what this document is, who has signed, the one action. */}
              <section className={`${card} overflow-hidden`}>
                <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                      <FileText className="h-5 w-5" aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <h2 className="m-0 text-base font-bold text-neutral-900">{docTitle}</h2>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2">
                        <span className={`inline-flex items-center gap-1.5 rounded border border-solid px-2 py-0.5 text-[12px] font-semibold ${statusTone}`}>
                          {workflowStatus === "EXECUTED" ? <ShieldCheck className="h-3.5 w-3.5" aria-hidden /> : <Clock3 className="h-3.5 w-3.5" aria-hidden />}
                          {statusLabel}
                        </span>
                        {workflow?.contractId ? (
                          <code className="rounded bg-neutral-100 px-1.5 py-0.5 font-mono text-[12px] text-neutral-600">{workflow.contractId}</code>
                        ) : null}
                        {version ? <span className="text-[12px] text-neutral-500">Version {version}</span> : null}
                      </div>
                      <p className="m-0 mt-2 text-[13px] leading-5 text-neutral-600">{statusMessage}</p>
                    </div>
                  </div>

                  {workflowStatus === "PENDING_AGENT_SIGNATURE" ? (
                    <button
                      type="button"
                      onClick={openConfirm}
                      className="inline-flex h-10 shrink-0 cursor-pointer appearance-none items-center gap-2 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-800"
                    >
                      <PenLine className="h-4 w-4" aria-hidden />
                      Sign as operator
                    </button>
                  ) : null}
                </div>

                <div className="grid grid-cols-2 border-0 border-t border-solid border-neutral-200">
                  {signatureSteps.map(({ party, at }, i) => (
                    <div key={party} className={`px-5 py-3 ${i ? "border-0 border-l border-solid border-neutral-200" : ""}`}>
                      <p className="m-0 text-[12px] text-neutral-500">{party}</p>
                      <p className={`m-0 mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-semibold ${at ? "text-emerald-700" : "text-neutral-400"}`}>
                        {at ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden /> : <Clock3 className="h-3.5 w-3.5" aria-hidden />}
                        {at ? "Signed" : "Not signed yet"}
                      </p>
                      {at ? <p className="m-0 mt-0.5 text-[12px] text-neutral-500">{formatSignedAt(at)}</p> : null}
                    </div>
                  ))}
                </div>

                {olderVersion ? (
                  <p className="m-0 border-0 border-t border-solid border-amber-200 bg-amber-50/70 px-5 py-2.5 text-[12.5px] leading-5 text-amber-900">
                    You signed version {version}. Agreements prepared from now on use version {currentVersion}. Your signed version stays in force until you and NoLSAF sign a new one.
                  </p>
                ) : null}
              </section>

              {/* The money terms in plain words, before the legal text. */}
              {termRows.length ? (
                <section className={card}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
                    <h3 className="m-0 text-[14px] font-semibold text-neutral-900">Key terms at a glance</h3>
                    <p className="m-0 text-[12px] text-neutral-500">A summary. The agreement below is what binds.</p>
                  </div>
                  <dl className="m-0 grid gap-px p-4 sm:grid-cols-2 xl:grid-cols-4">
                    {termRows.map((row) => (
                      <div key={row.label} className="rounded-md bg-neutral-50 px-3.5 py-3">
                        <dt className="text-[12px] text-neutral-500">{row.label}</dt>
                        <dd className="m-0 mt-0.5 text-[14px] font-semibold text-neutral-900">{row.value}</dd>
                        <dd className="m-0 mt-1 text-[12px] leading-5 text-neutral-600">{row.note}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="m-0 border-0 border-t border-solid border-neutral-100 px-5 py-3 text-[12.5px] text-neutral-600">
                    The full payout and refund rules:{" "}
                    <Link href="/tour-operator-disbursement-policy" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
                      Disbursement Policy
                    </Link>{" "}
                    and{" "}
                    <Link href="/cancellation-policy" className="font-medium text-emerald-700 underline-offset-2 hover:underline">
                      Cancellation Policy
                    </Link>
                    .
                  </p>
                </section>
              ) : null}

              {/* Contents inline below xl, where the side rail is not shown. */}
              {sections.length > 0 ? (
                <details className={`${card} xl:hidden`}>
                  <summary className="cursor-pointer px-5 py-3 text-[13px] font-semibold text-neutral-800">Contents ({sections.length} sections)</summary>
                  <div className="border-0 border-t border-solid border-neutral-100 p-3">{contentsList(true)}</div>
                </details>
              ) : null}

              <div className={`${card} px-5 py-5 sm:px-8 sm:py-7`}>
                {blocks.map((block, idx) => {
                  if (block.type === "h1") return null;

                  if (block.type === "meta") {
                    return (
                      <dl key={idx} className="m-0 mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-md border border-solid border-neutral-200 bg-neutral-200 sm:grid-cols-4">
                        {block.rows.map((row) => (
                          <div key={row.label} className="bg-neutral-50 px-3 py-2">
                            <dt className="text-[11.5px] text-neutral-500">{row.label}</dt>
                            <dd className="m-0 mt-0.5 break-words text-[13px] font-semibold text-neutral-900">{row.value}</dd>
                          </div>
                        ))}
                      </dl>
                    );
                  }

                  if (block.type === "h2") {
                    return (
                      <h3
                        key={idx}
                        id={block.number ? sectionAnchorId(block.number) : undefined}
                        className="m-0 mt-7 flex scroll-mt-4 items-baseline gap-2.5 border-0 border-t border-solid border-neutral-200 pt-5 text-[15px] font-semibold leading-snug text-neutral-900"
                      >
                        {block.number ? (
                          <span className="grid h-6 min-w-6 shrink-0 place-items-center rounded bg-emerald-50 px-1 text-[12px] font-bold tabular-nums text-emerald-800">
                            {block.number}
                          </span>
                        ) : null}
                        {block.text}
                      </h3>
                    );
                  }

                  if (block.type === "h3") {
                    return (
                      <h4 key={idx} className="m-0 mt-4 text-[13.5px] font-semibold leading-snug text-neutral-800">
                        {block.text}
                      </h4>
                    );
                  }

                  if (block.type === "clause") {
                    const nested = block.level > 2;
                    return (
                      <div key={idx} className={`mt-3 grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-2 text-[13.5px] leading-6 text-neutral-700 ${nested ? "pl-5" : ""}`}>
                        <span className="pt-px text-[12.5px] font-semibold tabular-nums text-neutral-400">{block.number}</span>
                        <span>
                          <RichText text={block.text} />
                        </span>
                      </div>
                    );
                  }

                  if (block.type === "list") {
                    return (
                      <ul key={idx} className="m-0 mt-2 list-none space-y-1.5 py-0 pl-[3.25rem] pr-2 text-[13.5px] leading-6 text-neutral-700">
                        {block.items.map((item, itemIdx) => (
                          <li key={itemIdx} className="relative pl-4">
                            <span className="absolute left-0 top-[0.7em] h-1.5 w-1.5 rounded-full bg-emerald-600" aria-hidden />
                            <RichText text={item} />
                          </li>
                        ))}
                      </ul>
                    );
                  }

                  if (block.type === "signatureColumns") {
                    const renderSignatureItems = (items: string[], party: "NOLSAF" | "OPERATOR") =>
                      items.map((item, itemIdx) => {
                        const m = item.match(/^([^:]+):\s*(.*)$/);
                        if (!m) {
                          return (
                            <div key={itemIdx} className="text-[13px] text-neutral-800">
                              {item}
                            </div>
                          );
                        }

                        const label = m[1].trim();
                        const value = m[2].trim();

                        if (label.toLowerCase() === "signature") {
                          const signedAt = party === "NOLSAF" ? workflow?.nolsafSignedAt : workflow?.agentSignedAt;
                          const contractId = workflow?.contractId || "";
                          const code = signedAt && contractId ? buildSignatureCode({ contractId, version: version || "1.0.0", party, signedAt }) : null;
                          const qrSrc = party === "NOLSAF" ? signatureQr.nolsaf : signatureQr.operator;

                          return (
                            <div key={itemIdx} className="grid grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-2 text-[13px] text-neutral-800">
                              <span className="text-neutral-500">{label}</span>
                              <div className="space-y-1.5">
                                {signedAt && code ? (
                                  <>
                                    <span className="inline-flex items-center gap-1 rounded border border-solid border-emerald-300 bg-emerald-50 px-2 py-0.5 text-[12px] font-semibold text-emerald-800">
                                      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                                      Signed digitally
                                    </span>
                                    <div className="break-all font-mono text-[12px] text-neutral-600">{code}</div>
                                    {qrSrc ? (
                                      // eslint-disable-next-line @next/next/no-img-element
                                      <img src={qrSrc} alt={`${party === "NOLSAF" ? "NoLSAF" : "Operator"} signature code`} className="h-20 w-20 rounded border border-solid border-neutral-200 bg-white p-1" />
                                    ) : null}
                                  </>
                                ) : (
                                  <span className="text-neutral-400">{value && !/^_+$/.test(value) ? value : "Not signed yet"}</span>
                                )}
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={itemIdx} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-2 text-[13px] text-neutral-800">
                            <span className="text-neutral-500">{label}</span>
                            <span className="min-w-0 break-words font-medium">{value}</span>
                          </div>
                        );
                      });

                    return (
                      <div key={idx} className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
                        {[
                          { t: block.leftTitle, items: block.leftItems, party: "NOLSAF" as const },
                          { t: block.rightTitle, items: block.rightItems, party: "OPERATOR" as const },
                        ].map((col) => (
                          <div key={col.party} className="space-y-2 rounded-md border border-solid border-neutral-200 bg-neutral-50 p-4">
                            <h5 className="m-0 text-[13.5px] font-semibold text-neutral-900">{col.t}</h5>
                            {renderSignatureItems(col.items, col.party)}
                          </div>
                        ))}
                      </div>
                    );
                  }

                  return (
                    <p key={idx} className="m-0 mt-3 text-[13.5px] leading-6 text-neutral-700 first:mt-0">
                      <RichText text={block.text} />
                    </p>
                  );
                })}
              </div>
            </article>

            {sections.length > 0 ? (
              <nav aria-label="Contract contents" className={`${card} sticky top-0 hidden max-h-[calc(100dvh-10rem)] overflow-y-auto p-3 xl:block`}>
                <p className="m-0 mb-1.5 px-2 text-[12.5px] font-semibold text-neutral-800">Contents</p>
                {contentsList(false)}
              </nav>
            ) : null}
          </div>
        </div>
      )}

      {confirmOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="fixed inset-0 z-[120] flex items-end justify-center bg-neutral-950/50 p-0 sm:items-center sm:p-4" style={{ boxSizing: "border-box" }} onMouseDown={(e) => { if (e.target === e.currentTarget && !signing) setConfirmOpen(false); }}>
              <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="sign-confirm-title"
                className="w-full max-w-[480px] overflow-hidden rounded-t-lg bg-white shadow-2xl sm:rounded-lg [&_*]:box-border"
              >
                <div className="flex items-start gap-3 border-0 border-b border-solid border-neutral-200 px-5 py-4">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-md bg-emerald-50 text-emerald-700">
                    <PenLine className="h-5 w-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 id="sign-confirm-title" className="m-0 text-base font-semibold text-neutral-900">Sign the agreement</h2>
                    <p className="m-0 mt-0.5 text-[13px] leading-5 text-neutral-600">Your signature is binding. Check the details below before you sign.</p>
                  </div>
                  <button type="button" onClick={() => setConfirmOpen(false)} disabled={signing} aria-label="Close" className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-md border-0 bg-transparent text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="space-y-4 px-5 py-4">
                  <dl className="m-0 grid gap-1.5 rounded-md bg-neutral-50 px-3.5 py-3 text-[13px]">
                    <div className="flex justify-between gap-3"><dt className="text-neutral-500">Agreement</dt><dd className="m-0 text-right font-medium text-neutral-900">{docTitle}</dd></div>
                    {workflow?.contractId ? <div className="flex justify-between gap-3"><dt className="text-neutral-500">Reference</dt><dd className="m-0 font-mono text-[12px] text-neutral-900">{workflow.contractId}</dd></div> : null}
                    {version ? <div className="flex justify-between gap-3"><dt className="text-neutral-500">Version</dt><dd className="m-0 font-medium text-neutral-900">{version}</dd></div> : null}
                    {workflow?.nolsafSignedAt ? <div className="flex justify-between gap-3"><dt className="text-neutral-500">NoLSAF signed</dt><dd className="m-0 text-right font-medium text-neutral-900">{formatSignedAt(workflow.nolsafSignedAt)}</dd></div> : null}
                    {terms?.commissionPercent != null ? <div className="flex justify-between gap-3"><dt className="text-neutral-500">NoLSAF commission</dt><dd className="m-0 font-medium text-neutral-900">{terms.commissionPercent}%, paid by the traveller</dd></div> : null}
                  </dl>

                  <label className="flex cursor-pointer items-start gap-2.5 text-[13px] leading-5 text-neutral-700">
                    <input
                      type="checkbox"
                      checked={accepted}
                      onChange={(e) => setAccepted(e.target.checked)}
                      disabled={signing}
                      className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-emerald-700"
                    />
                    <span>I have read the whole agreement, including the commission, payout and cancellation terms, and I sign it as the authorised representative of the operator.</span>
                  </label>

                  <div>
                    <label htmlFor="sign-typed-name" className="block text-[13px] font-medium text-neutral-800">Type your full name to sign</label>
                    <input
                      id="sign-typed-name"
                      type="text"
                      value={typedName}
                      onChange={(e) => setTypedName(e.target.value)}
                      disabled={signing || !signerName}
                      autoComplete="off"
                      spellCheck={false}
                      autoFocus
                      placeholder={signerName || "Your full name"}
                      className={`mt-1.5 w-full rounded-md border border-solid bg-white px-3 py-2.5 text-[15px] text-neutral-900 outline-none transition focus:ring-2 ${
                        typedName && !nameMatches ? "border-amber-300 focus:ring-amber-100" : nameMatches ? "border-emerald-500 focus:ring-emerald-100" : "border-neutral-300 focus:border-emerald-600 focus:ring-emerald-100"
                      }`}
                      style={{ fontFamily: "'Segoe Script', 'Brush Script MT', cursive" }}
                    />
                    <p className={`m-0 mt-1.5 text-[12px] ${nameMatches ? "text-emerald-700" : "text-neutral-500"}`}>
                      {!signerName
                        ? "Your account has no full name yet. Add it on your profile before signing."
                        : nameMatches
                          ? "Name matches your account."
                          : `As it appears on your account: ${signerName}`}
                    </p>
                  </div>

                  <p className="m-0 flex items-start gap-2 rounded-md border border-solid border-neutral-200 px-3 py-2.5 text-[12px] leading-5 text-neutral-600">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-700" aria-hidden />
                    NoLSAF records the date, time and device of your signature. A signed agreement cannot be withdrawn here; changes need a new agreement with NoLSAF.
                  </p>

                  {signError ? (
                    <p role="alert" className="m-0 rounded-md border border-solid border-rose-200 bg-rose-50 px-3 py-2.5 text-[13px] text-rose-800">{signError}</p>
                  ) : null}
                </div>

                <div className="flex flex-col-reverse gap-2 border-0 border-t border-solid border-neutral-200 bg-neutral-50 px-5 py-3 sm:flex-row sm:justify-end">
                  <button type="button" onClick={() => setConfirmOpen(false)} disabled={signing} className="h-10 cursor-pointer rounded-md border border-solid border-neutral-300 bg-white px-4 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50">
                    Not now
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleAgentSign()}
                    disabled={!canSign}
                    className="inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border-0 bg-emerald-700 px-4 text-[13px] font-semibold text-white transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-neutral-300"
                  >
                    {signing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <PenLine className="h-4 w-4" aria-hidden />}
                    {signing ? "Signing" : "Sign agreement"}
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
