import { afterEach, describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
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

  it("fails closed instead of returning a substitute legal document", () => {
    const missingRoot = join(tmpdir(), `nolsaf-missing-operator-contract-${process.pid}`);
    expect(() => loadOperatorContractTemplate([missingRoot])).toThrow(
      "Operator contract artifact not found: docs/NoLSAF_Operator_Mutual_NDA.md",
    );
  });
});
