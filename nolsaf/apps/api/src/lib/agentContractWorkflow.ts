import { OPERATOR_CONTRACT_CURRENT_VERSION } from "./operatorContract.js";

export const CONTRACT_WORKFLOW_STATUSES = [
  "PENDING_NOLSAF_SIGNATURE",
  "PENDING_AGENT_SIGNATURE",
  "EXECUTED",
] as const;

export type ContractWorkflowStatus = (typeof CONTRACT_WORKFLOW_STATUSES)[number];

export type AgentContractWorkflow = {
  contractId: string;
  version: string;
  hiredDate: string;
  effectiveDate: string;
  status: ContractWorkflowStatus;
  createdAt: string;
  preparedAt?: string;
  sentAt?: string;
  nolsafSignedAt?: string;
  nolsafSignatoryName?: string;
  nolsafSignatoryTitle?: string;
  nolsafSignedByUserId?: number;
  agentSignedAt?: string;
  agentSignerName?: string;
  agentSignedByUserId?: number;
  /** What the operator did to sign: typed name, the consent they ticked, and where from. */
  agentSignatureEvidence?: {
    typedName: string;
    consent: string;
    version: string;
    ip: string | null;
    userAgent: string | null;
  };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toPositiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.trunc(parsed);
}

export function toYmd(value: unknown): string {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

export function buildContractWorkflowSeed(params: {
  agentId: number;
  hiredDate: string;
  nowIso?: string;
  version?: string;
}): AgentContractWorkflow {
  const nowIso = params.nowIso || new Date().toISOString();
  const version = params.version || OPERATOR_CONTRACT_CURRENT_VERSION;

  return {
    contractId: `NDA-AGENT-${String(params.agentId).padStart(6, "0")}`,
    version,
    hiredDate: params.hiredDate,
    effectiveDate: params.hiredDate,
    status: "PENDING_NOLSAF_SIGNATURE",
    createdAt: nowIso,
    preparedAt: nowIso,
  };
}

export function readContractWorkflow(profile: unknown): AgentContractWorkflow | null {
  if (!isRecord(profile)) return null;
  const raw = (profile as Record<string, unknown>).contractWorkflow;
  if (!isRecord(raw)) return null;

  const status = toStringOrEmpty(raw.status).toUpperCase();
  if (!CONTRACT_WORKFLOW_STATUSES.includes(status as ContractWorkflowStatus)) return null;

  const contractId = toStringOrEmpty(raw.contractId);
  const version = toStringOrEmpty(raw.version) || "1.0.0";
  const hiredDate = toStringOrEmpty(raw.hiredDate);
  const effectiveDate = toStringOrEmpty(raw.effectiveDate) || hiredDate;
  const createdAt = toStringOrEmpty(raw.createdAt);

  if (!contractId || !hiredDate || !createdAt) return null;

  const out: AgentContractWorkflow = {
    contractId,
    version,
    hiredDate,
    effectiveDate,
    status: status as ContractWorkflowStatus,
    createdAt,
  };

  const preparedAt = toStringOrEmpty(raw.preparedAt);
  const sentAt = toStringOrEmpty(raw.sentAt);
  const nolsafSignedAt = toStringOrEmpty(raw.nolsafSignedAt);
  const nolsafSignatoryName = toStringOrEmpty(raw.nolsafSignatoryName);
  const nolsafSignatoryTitle = toStringOrEmpty(raw.nolsafSignatoryTitle);
  const nolsafSignedByUserId = toPositiveNumber(raw.nolsafSignedByUserId);
  const agentSignedAt = toStringOrEmpty(raw.agentSignedAt);
  const agentSignerName = toStringOrEmpty(raw.agentSignerName);
  const agentSignedByUserId = toPositiveNumber(raw.agentSignedByUserId);

  if (preparedAt) out.preparedAt = preparedAt;
  if (sentAt) out.sentAt = sentAt;
  if (nolsafSignedAt) out.nolsafSignedAt = nolsafSignedAt;
  if (nolsafSignatoryName) out.nolsafSignatoryName = nolsafSignatoryName;
  if (nolsafSignatoryTitle) out.nolsafSignatoryTitle = nolsafSignatoryTitle;
  if (nolsafSignedByUserId) out.nolsafSignedByUserId = nolsafSignedByUserId;
  if (agentSignedAt) out.agentSignedAt = agentSignedAt;
  if (agentSignerName) out.agentSignerName = agentSignerName;
  if (agentSignedByUserId) out.agentSignedByUserId = agentSignedByUserId;
  if (isRecord(raw.agentSignatureEvidence)) {
    const ev = raw.agentSignatureEvidence;
    out.agentSignatureEvidence = {
      typedName: toStringOrEmpty(ev.typedName),
      consent: toStringOrEmpty(ev.consent),
      version: toStringOrEmpty(ev.version),
      ip: toStringOrEmpty(ev.ip) || null,
      userAgent: toStringOrEmpty(ev.userAgent) || null,
    };
  }

  return out;
}

export function withContractWorkflow(profile: unknown, workflow: AgentContractWorkflow): Record<string, unknown> {
  const base = isRecord(profile) ? { ...profile } : {};
  return {
    ...base,
    contractWorkflow: workflow,
  };
}
