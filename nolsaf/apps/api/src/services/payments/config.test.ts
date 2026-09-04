import { describe, expect, it } from "vitest";

import { checkOrchestrationGate, readOrchestrationConfig } from "./config.js";

describe("orchestration gate defaults", () => {
  it("is disabled when nothing is configured", () => {
    expect(checkOrchestrationGate({})).toMatchObject({
      ok: false,
      code: "orchestration_disabled",
    });
  });

  it("defaults to SANDBOX rather than inheriting a real environment", () => {
    expect(readOrchestrationConfig({}).environment).toBe("SANDBOX");
    expect(readOrchestrationConfig({ PAYMENTS_ORCHESTRATION_ENVIRONMENT: "nonsense" }).environment).toBe(
      "SANDBOX"
    );
  });

  it("treats any value other than the exact string true as off", () => {
    for (const value of ["1", "TRUE", "yes", "on", ""]) {
      expect(
        checkOrchestrationGate({ PAYMENTS_ORCHESTRATION_ENABLED: value }),
        `${value} must not enable the core`
      ).toMatchObject({ ok: false });
    }
  });
});

describe("production requires a second acknowledgement", () => {
  it("refuses PRODUCTION on the enable flag alone", () => {
    // A variable copied between deployments must not be able to put real
    // money in motion by itself.
    expect(
      checkOrchestrationGate({
        PAYMENTS_ORCHESTRATION_ENABLED: "true",
        PAYMENTS_ORCHESTRATION_ENVIRONMENT: "PRODUCTION",
      })
    ).toMatchObject({ ok: false, code: "production_not_authorized" });
  });

  it("allows PRODUCTION only with the explicit second flag", () => {
    expect(
      checkOrchestrationGate({
        PAYMENTS_ORCHESTRATION_ENABLED: "true",
        PAYMENTS_ORCHESTRATION_ENVIRONMENT: "PRODUCTION",
        PAYMENTS_ORCHESTRATION_ALLOW_PRODUCTION: "true",
      })
    ).toMatchObject({ ok: true, config: { environment: "PRODUCTION" } });
  });

  it("does not require the second flag for sandbox or staging", () => {
    for (const environment of ["SANDBOX", "STAGING"]) {
      expect(
        checkOrchestrationGate({
          PAYMENTS_ORCHESTRATION_ENABLED: "true",
          PAYMENTS_ORCHESTRATION_ENVIRONMENT: environment,
        })
      ).toMatchObject({ ok: true });
    }
  });
});

describe("refusal messages", () => {
  it("never leaks configuration state to the caller", () => {
    const gate = checkOrchestrationGate({});
    expect(gate.ok).toBe(false);
    if (!gate.ok) {
      expect(gate.message).toBe("Online payment is not available yet.");
      expect(gate.message.toLowerCase()).not.toContain("env");
    }
  });
});
