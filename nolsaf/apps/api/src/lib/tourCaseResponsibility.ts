export type OperatorCaseReceiptStatus = "NOT_ASSIGNED" | "NOT_OPERATIONAL" | "UNDELIVERED" | "AWAITING_RECEIPT" | "RECEIVED";

type Input = {
  bookingOperatorAgentId: number | null | undefined;
  requestingAgentId: number | null | undefined;
  paymentStatus: string | null | undefined;
  eventTypes: Array<string | null | undefined>;
};

const RECEIPT_EVENTS = new Set(["OPERATOR_RECEIVED", "ACKNOWLEDGE", "ESCALATE", "OPERATOR_COST_EVIDENCE"]);

/** Server-side responsibility classification; operatorAgentId alone is not proof of case delivery or receipt. */
export function classifyOperatorCaseResponsibility(input: Input): { visible: boolean; canRespond: boolean; status: OperatorCaseReceiptStatus } {
  if (!input.bookingOperatorAgentId || input.bookingOperatorAgentId !== input.requestingAgentId) {
    return { visible: false, canRespond: false, status: "NOT_ASSIGNED" };
  }
  // REFUNDED implies the payment was confirmed before the refund, so the
  // operator keeps visibility of the finished case and any recovery debt.
  if (!["PAID", "REFUNDED"].includes(String(input.paymentStatus || "").toUpperCase())) {
    return { visible: false, canRespond: false, status: "NOT_OPERATIONAL" };
  }
  const types = new Set(input.eventTypes.map((value) => String(value || "").toUpperCase()));
  const received = Array.from(RECEIPT_EVENTS).some((type) => types.has(type));
  if (received) return { visible: true, canRespond: true, status: "RECEIVED" };
  if (types.has("OPERATOR_NOTIFIED")) return { visible: true, canRespond: true, status: "AWAITING_RECEIPT" };
  return { visible: false, canRespond: false, status: "UNDELIVERED" };
}
