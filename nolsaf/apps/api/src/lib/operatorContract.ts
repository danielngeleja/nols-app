import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The operator agreement is rendered from a template every time it is shown,
// so each version an operator may have signed must keep its own frozen file.
// Never edit a released version's file: add a new version instead.
export const OPERATOR_CONTRACT_TEMPLATE_FILE = "docs/NoLSAF_Operator_Mutual_NDA.md";

/** The version new agreements are prepared and signed on. */
export const OPERATOR_CONTRACT_CURRENT_VERSION = "2.0.0";

/** Frozen texts of earlier versions, kept so signed agreements still read as signed. */
const OPERATOR_CONTRACT_ARCHIVE: Record<string, string> = {
  "1.0.0": "docs/NoLSAF_Operator_Mutual_NDA.v1.0.0.md",
};

const templateCache = new Map<string, string>();

function defaultSearchRoots(): string[] {
  return [
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "..", ".."),
  ];
}

/** The template file for a version. Unknown versions fail closed. */
export function operatorContractTemplateFile(version: string = OPERATOR_CONTRACT_CURRENT_VERSION): string {
  const v = String(version || "").trim() || "1.0.0";
  if (v === OPERATOR_CONTRACT_CURRENT_VERSION) return OPERATOR_CONTRACT_TEMPLATE_FILE;
  const archived = OPERATOR_CONTRACT_ARCHIVE[v];
  if (!archived) throw new Error(`Operator contract version not found: ${v}`);
  return archived;
}

export function loadOperatorContractTemplate(
  version: string = OPERATOR_CONTRACT_CURRENT_VERSION,
  searchRoots = defaultSearchRoots(),
): string {
  const file = operatorContractTemplateFile(version);
  const cached = templateCache.get(file);
  if (cached) return cached;

  for (const root of searchRoots) {
    const path = resolve(root, file);
    if (existsSync(path)) {
      const text = readFileSync(path, "utf8");
      templateCache.set(file, text);
      return text;
    }
  }

  throw new Error(`Operator contract artifact not found: ${file}`);
}

/**
 * Which text a workflow is shown and signed on. Until NoLSAF signs, nothing is
 * agreed yet, so the current version applies. From NoLSAF's signature on, the
 * stored version is fixed and both parties see exactly that text.
 */
export function effectiveOperatorContractVersion(workflow: { status?: string | null; version?: string | null; nolsafSignedAt?: string | null }): string {
  const status = String(workflow?.status || "").toUpperCase();
  if (status === "PENDING_NOLSAF_SIGNATURE" && !workflow?.nolsafSignedAt) return OPERATOR_CONTRACT_CURRENT_VERSION;
  return String(workflow?.version || "").trim() || "1.0.0";
}

export function resetOperatorContractTemplateCacheForTests(): void {
  templateCache.clear();
}
