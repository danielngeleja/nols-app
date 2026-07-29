import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export const OPERATOR_CONTRACT_TEMPLATE_FILE = "docs/NoLSAF_Operator_Mutual_NDA.md";

let operatorContractTemplateCache: string | null = null;

function defaultSearchRoots(): string[] {
  return [
    process.cwd(),
    resolve(process.cwd(), ".."),
    resolve(process.cwd(), "..", ".."),
  ];
}

export function loadOperatorContractTemplate(searchRoots = defaultSearchRoots()): string {
  if (operatorContractTemplateCache) return operatorContractTemplateCache;

  for (const root of searchRoots) {
    const file = resolve(root, OPERATOR_CONTRACT_TEMPLATE_FILE);
    if (existsSync(file)) {
      operatorContractTemplateCache = readFileSync(file, "utf8");
      return operatorContractTemplateCache;
    }
  }

  throw new Error(`Operator contract artifact not found: ${OPERATOR_CONTRACT_TEMPLATE_FILE}`);
}

export function resetOperatorContractTemplateCacheForTests(): void {
  operatorContractTemplateCache = null;
}
