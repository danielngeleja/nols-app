import { describe, expect, it } from "vitest";
import { paymentSettlesAccount } from "./nrmsAgentSettlement.js";
import { masterFolioStatusFromBalance } from "./nrmsMasterFolio.js";

describe("agent account settlement follow-up", () => {
  it("fires for the payment that settles an open account", () => {
    expect(paymentSettlesAccount("OPEN", "SETTLED")).toBe(true);
    expect(paymentSettlesAccount("OPEN", "CREDIT")).toBe(true);
  });

  it("does not fire for a part payment", () => {
    expect(paymentSettlesAccount("OPEN", "OPEN")).toBe(false);
  });

  it("does not fire again once the account was already settled", () => {
    expect(paymentSettlesAccount("SETTLED", "CREDIT")).toBe(false);
    expect(paymentSettlesAccount("CREDIT", "CREDIT")).toBe(false);
  });

  it("derives the before-status from the ledger balance", () => {
    expect(masterFolioStatusFromBalance(29_752_500)).toBe("OPEN");
    expect(masterFolioStatusFromBalance(0)).toBe("SETTLED");
    expect(masterFolioStatusFromBalance(-500)).toBe("CREDIT");
  });
});
