import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  OPERATOR_CONTRACT_CURRENT_VERSION,
  effectiveOperatorContractVersion,
  loadOperatorContractTemplate,
  resetOperatorContractTemplateCacheForTests,
} from "./operatorContract.js";

afterEach(() => {
  resetOperatorContractTemplateCacheForTests();
});

describe("operator contract runtime artifact", () => {
  it("loads the controlled NoLSAF operator agreement from the repository", () => {
    const template = loadOperatorContractTemplate();

    expect(template).toContain("{{CONTRACT_ID}}");
    expect(template).toContain("{{OPERATOR_COMPANY_NAME}}");
  });

  it("describes NoLSAF as a marketplace, not a software subscription", () => {
    const template = loadOperatorContractTemplate();

    expect(template).not.toMatch(/Software-as-a-Service|SaaS/);
    expect(template).not.toContain("{{SUBSCRIPTION_GRACE_DAYS}}");
    expect(template).toContain("online travel marketplace");
  });

  it("keeps the text version 1.0.0 operators signed, unchanged", () => {
    const v1 = loadOperatorContractTemplate("1.0.0");

    expect(v1).toContain("Software-as-a-Service (SaaS)");
    expect(v1).toContain("{{SUBSCRIPTION_GRACE_DAYS}}");
  });

  it("refuses an unknown version instead of showing another text", () => {
    expect(() => loadOperatorContractTemplate("9.9.9")).toThrow("Operator contract version not found: 9.9.9");
  });

  it("fails closed instead of returning a substitute legal document", () => {
    const missingRoot = join(tmpdir(), `nolsaf-missing-operator-contract-${process.pid}`);
    expect(() => loadOperatorContractTemplate(OPERATOR_CONTRACT_CURRENT_VERSION, [missingRoot])).toThrow(
      "Operator contract artifact not found: docs/NoLSAF_Operator_Mutual_NDA.md",
    );
  });

  it("uses the current text until NoLSAF signs, then the signed version", () => {
    expect(effectiveOperatorContractVersion({ status: "PENDING_NOLSAF_SIGNATURE", version: "1.0.0" })).toBe(OPERATOR_CONTRACT_CURRENT_VERSION);
    expect(effectiveOperatorContractVersion({ status: "PENDING_AGENT_SIGNATURE", version: "1.0.0", nolsafSignedAt: "2026-10-01T00:00:00Z" })).toBe("1.0.0");
    expect(effectiveOperatorContractVersion({ status: "EXECUTED", version: "1.0.0" })).toBe("1.0.0");
    expect(effectiveOperatorContractVersion({ status: "EXECUTED", version: "" })).toBe("1.0.0");
  });
});
