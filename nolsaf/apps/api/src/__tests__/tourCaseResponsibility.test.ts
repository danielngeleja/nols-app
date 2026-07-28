import { describe, expect, it } from "vitest";
import { classifyOperatorCaseResponsibility } from "../lib/tourCaseResponsibility";

const base = { bookingOperatorAgentId: 8, requestingAgentId: 8, paymentStatus: "PAID", eventTypes: [] as string[] };

describe("tour case operator responsibility", () => {
  it("does not expose a case based only on operatorAgentId", () => {
    expect(classifyOperatorCaseResponsibility(base)).toEqual({ visible: false, canRespond: false, status: "UNDELIVERED" });
  });

  it("does not assign operational responsibility for an unpaid booking", () => {
    expect(classifyOperatorCaseResponsibility({ ...base, paymentStatus: "UNPAID", eventTypes: ["OPERATOR_NOTIFIED"] }).status).toBe("NOT_OPERATIONAL");
  });

  it("shows a delivered case as awaiting receipt", () => {
    expect(classifyOperatorCaseResponsibility({ ...base, eventTypes: ["OPERATOR_NOTIFIED"] })).toEqual({ visible: true, canRespond: true, status: "AWAITING_RECEIPT" });
  });

  it("marks an acknowledged case as received", () => {
    expect(classifyOperatorCaseResponsibility({ ...base, eventTypes: ["OPERATOR_NOTIFIED", "ACKNOWLEDGE"] }).status).toBe("RECEIVED");
  });

  it("rejects access by a different operator", () => {
    expect(classifyOperatorCaseResponsibility({ ...base, requestingAgentId: 9, eventTypes: ["OPERATOR_NOTIFIED"] }).status).toBe("NOT_ASSIGNED");
  });

  it("keeps a refunded booking's case visible to the operator", () => {
    expect(classifyOperatorCaseResponsibility({ ...base, paymentStatus: "REFUNDED", eventTypes: ["OPERATOR_NOTIFIED", "ACKNOWLEDGE"] }).status).toBe("RECEIVED");
  });
});
