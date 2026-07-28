export type ServiceType = "PROPERTY" | "GROUP_STAY" | "TOUR";
export type BookingStage = "DRAFT" | "AWAITING_REVIEW" | "AWAITING_PAYMENT" | "CONFIRMED" | "IN_SERVICE" | "COMPLETED" | "CANCELLED" | "DECLINED" | "EXPIRED";
export type PaymentStage = "UNPAID" | "PENDING" | "PARTIALLY_PAID" | "PAID" | "REFUND_PENDING" | "REFUNDED";
export type ReceiptStage = "NOT_AVAILABLE" | "AVAILABLE" | "VOIDED";
export type ResponsibilityStage = "NOT_ASSIGNED" | "ASSIGNED" | "DELIVERED" | "ACKNOWLEDGED" | "NOT_TRACKED";
export type CaseStage = "NOT_LOADED" | "NONE" | "SUBMITTED" | "REVIEWING" | "APPROVED" | "REJECTED" | "REFUND_PENDING" | "RESOLVED";
export type LifecycleAction = "COMPLETE_PAYMENT" | "AWAIT_REVIEW" | "PAY_DEPOSIT" | "AWAIT_CONFIRMATION" | "PREPARE_FOR_SERVICE" | "FOLLOW_SERVICE_PLAN" | "CONFIRM_COMPLETION" | "REVIEW_CANCELLATION" | "CONTACT_SUPPORT" | "NO_ACTION";

export type LifecycleIssue = {
  code: string;
  severity: "WARNING" | "ERROR";
  message: string;
};

export type ServiceLifecycle = {
  version: 1;
  serviceType: ServiceType;
  bookingStage: BookingStage;
  paymentStage: PaymentStage;
  receiptStage: ReceiptStage;
  responsibilityStage: ResponsibilityStage;
  caseStage: CaseStage;
  requiredAction: LifecycleAction;
  requiredActionLabel: string;
  consistency: {
    status: "CONSISTENT" | "REVIEW_REQUIRED";
    issues: LifecycleIssue[];
  };
};

const upper = (value: unknown) => String(value || "").trim().replace(/[\s-]+/g, "_").toUpperCase();

const ACTION_LABELS: Record<LifecycleAction, string> = {
  COMPLETE_PAYMENT: "Complete payment before the payment window expires",
  AWAIT_REVIEW: "Wait for NoLSAF to review the request",
  PAY_DEPOSIT: "Pay the confirmed group-stay deposit",
  AWAIT_CONFIRMATION: "Wait for final service confirmation",
  PREPARE_FOR_SERVICE: "Prepare for the confirmed service",
  FOLLOW_SERVICE_PLAN: "Follow the active service plan",
  CONFIRM_COMPLETION: "Confirm that the service was completed",
  REVIEW_CANCELLATION: "Review the active cancellation or refund case",
  CONTACT_SUPPORT: "Contact NoLSAF to reconcile this booking",
  NO_ACTION: "No action is currently required",
};

function result(input: Omit<ServiceLifecycle, "version" | "requiredActionLabel" | "consistency"> & { requiredAction: LifecycleAction; issues: LifecycleIssue[] }): ServiceLifecycle {
  return {
    version: 1,
    serviceType: input.serviceType,
    bookingStage: input.bookingStage,
    paymentStage: input.paymentStage,
    receiptStage: input.receiptStage,
    responsibilityStage: input.responsibilityStage,
    caseStage: input.caseStage,
    requiredAction: input.requiredAction,
    requiredActionLabel: ACTION_LABELS[input.requiredAction],
    consistency: { status: input.issues.length ? "REVIEW_REQUIRED" : "CONSISTENT", issues: input.issues },
  };
}

export function mapCaseStage(value: unknown, loaded = false): CaseStage {
  if (!loaded) return "NOT_LOADED";
  const status = upper(value);
  if (!status) return "NONE";
  if (["OPEN", "SUBMITTED", "ELIGIBLE"].includes(status)) return "SUBMITTED";
  if (["ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "REVIEWING", "NEED_INFO"].includes(status)) return "REVIEWING";
  if (status === "APPROVED") return "APPROVED";
  if (status === "REJECTED") return "REJECTED";
  if (status === "REFUND_PENDING") return "REFUND_PENDING";
  if (["REFUNDED", "RESOLVED", "CLOSED", "WITHDRAWN"].includes(status)) return "RESOLVED";
  return "REVIEWING";
}

export function mapPropertyLifecycle(input: {
  bookingStatus: unknown;
  invoiceStatus?: unknown;
  hasInvoice?: boolean;
  receiptNumber?: unknown;
  checkInCodeStatus?: unknown;
  draftExpired?: boolean;
  cancellationStatus?: unknown;
  cancellationLoaded?: boolean;
}): ServiceLifecycle {
  const booking = upper(input.bookingStatus);
  const invoice = upper(input.invoiceStatus);
  const code = upper(input.checkInCodeStatus);
  const hasReceipt = Boolean(String(input.receiptNumber || "").trim());
  const paymentStage: PaymentStage = ["REFUNDED"].includes(invoice)
    ? "REFUNDED"
    : invoice === "REFUND_PENDING"
      ? "REFUND_PENDING"
      : invoice === "PAID" || (invoice === "CUSTOMER_PAID" && hasReceipt)
        ? "PAID"
        : ["PENDING", "PROCESSING", "CUSTOMER_PAID"].includes(invoice)
          ? "PENDING"
          : "UNPAID";
  const bookingStage: BookingStage = ["CANCELED", "CANCELLED"].includes(booking)
    ? "CANCELLED"
    : ["CHECKED_OUT", "COMPLETED"].includes(booking)
      ? "COMPLETED"
      : booking === "CHECKED_IN"
        ? "IN_SERVICE"
        : booking === "CONFIRMED" || paymentStage === "PAID"
          ? "CONFIRMED"
          : input.draftExpired
            ? "EXPIRED"
            : booking === "NEW" && input.hasInvoice
              ? "AWAITING_PAYMENT"
              : "DRAFT";
  const receiptStage: ReceiptStage = hasReceipt ? "AVAILABLE" : "NOT_AVAILABLE";
  const caseStage = mapCaseStage(input.cancellationStatus, Boolean(input.cancellationLoaded));
  const issues: LifecycleIssue[] = [];
  if (hasReceipt && paymentStage !== "PAID" && paymentStage !== "REFUNDED") issues.push({ code: "RECEIPT_WITHOUT_VERIFIED_PAYMENT", severity: "ERROR", message: "Accommodation receipt exists without a verified paid invoice." });
  if (bookingStage === "CONFIRMED" && paymentStage !== "PAID") issues.push({ code: "CONFIRMED_WITHOUT_PAYMENT", severity: "ERROR", message: "Accommodation booking is confirmed while payment is not verified." });
  if (bookingStage === "CANCELLED" && code === "ACTIVE") issues.push({ code: "ACTIVE_CHECKIN_FOR_CANCELLED_BOOKING", severity: "ERROR", message: "Cancelled accommodation booking still has an active check-in code." });
  if (caseStage === "REJECTED" && bookingStage === "CANCELLED") issues.push({ code: "REJECTED_CANCELLATION_WITH_CANCELLED_BOOKING", severity: "ERROR", message: "Rejected accommodation cancellation conflicts with a cancelled booking." });
  const requiredAction: LifecycleAction = issues.length
    ? "CONTACT_SUPPORT"
    : ["SUBMITTED", "REVIEWING", "APPROVED", "REFUND_PENDING"].includes(caseStage)
      ? "REVIEW_CANCELLATION"
      : ["DRAFT", "AWAITING_PAYMENT"].includes(bookingStage)
        ? "COMPLETE_PAYMENT"
        : bookingStage === "CONFIRMED"
          ? "PREPARE_FOR_SERVICE"
          : bookingStage === "IN_SERVICE"
            ? "FOLLOW_SERVICE_PLAN"
            : "NO_ACTION";
  return result({ serviceType: "PROPERTY", bookingStage, paymentStage, receiptStage, responsibilityStage: bookingStage === "DRAFT" ? "NOT_ASSIGNED" : "ASSIGNED", caseStage, requiredAction, issues });
}

export function mapGroupStayLifecycle(input: {
  bookingStatus: unknown;
  depositPaid?: boolean;
  depositPaidAt?: unknown;
  depositAmount?: unknown;
  depositExpired?: boolean;
  confirmedPropertyId?: unknown;
  cancellationStatus?: unknown;
  cancellationLoaded?: boolean;
}): ServiceLifecycle {
  const booking = upper(input.bookingStatus);
  const depositPaid = Boolean(input.depositPaid);
  const depositAmount = Number(input.depositAmount || 0);
  const bookingStage: BookingStage = ["CANCELED", "CANCELLED", "WITHDRAWN"].includes(booking)
    ? "CANCELLED"
    : booking === "REJECTED"
      ? "DECLINED"
      : booking === "COMPLETED"
        ? "COMPLETED"
        : ["CHECKED_IN", "IN_PROGRESS", "PROCESSING"].includes(booking)
          ? "IN_SERVICE"
          : input.depositExpired
            ? "EXPIRED"
            : depositPaid || ["CONFIRMED", "ACCEPTED", "BOOKED"].includes(booking)
              ? "CONFIRMED"
              : booking === "AWAITING_DEPOSIT"
                ? "AWAITING_PAYMENT"
                : "AWAITING_REVIEW";
  const paymentStage: PaymentStage = depositPaid ? "PARTIALLY_PAID" : "UNPAID";
  const receiptStage: ReceiptStage = depositPaid && Boolean(input.depositPaidAt) ? "AVAILABLE" : "NOT_AVAILABLE";
  const responsibilityStage: ResponsibilityStage = input.confirmedPropertyId ? "ASSIGNED" : "NOT_ASSIGNED";
  const caseStage = mapCaseStage(input.cancellationStatus, Boolean(input.cancellationLoaded));
  const issues: LifecycleIssue[] = [];
  if (depositPaid && !input.depositPaidAt) issues.push({ code: "DEPOSIT_PAID_WITHOUT_TIMESTAMP", severity: "ERROR", message: "Group-stay deposit is marked paid without a payment timestamp." });
  if (receiptStage === "AVAILABLE" && !depositPaid) issues.push({ code: "DEPOSIT_RECEIPT_WITHOUT_PAYMENT", severity: "ERROR", message: "Group-stay deposit receipt exists without a recorded deposit payment." });
  if (booking === "AWAITING_DEPOSIT" && depositAmount <= 0) issues.push({ code: "AWAITING_INVALID_DEPOSIT", severity: "ERROR", message: "Group stay is awaiting a deposit but has no positive deposit amount." });
  if (bookingStage === "CONFIRMED" && !input.confirmedPropertyId) issues.push({ code: "CONFIRMED_WITHOUT_PROPERTY", severity: "ERROR", message: "Group stay is confirmed without an assigned property." });
  if (bookingStage === "CANCELLED" && caseStage === "NONE") issues.push({ code: "CANCELLED_WITHOUT_CASE_RECORD", severity: "WARNING", message: "Group stay is cancelled without a dedicated cancellation case record." });
  const requiredAction: LifecycleAction = issues.length
    ? "CONTACT_SUPPORT"
    : ["SUBMITTED", "REVIEWING", "APPROVED", "REFUND_PENDING"].includes(caseStage)
      ? "REVIEW_CANCELLATION"
      : bookingStage === "AWAITING_REVIEW"
        ? "AWAIT_REVIEW"
        : bookingStage === "AWAITING_PAYMENT"
          ? "PAY_DEPOSIT"
          : bookingStage === "CONFIRMED"
            ? "AWAIT_CONFIRMATION"
            : bookingStage === "IN_SERVICE"
              ? "FOLLOW_SERVICE_PLAN"
              : "NO_ACTION";
  return result({ serviceType: "GROUP_STAY", bookingStage, paymentStage, receiptStage, responsibilityStage, caseStage, requiredAction, issues });
}

export function mapTourLifecycle(input: {
  bookingStatus: unknown;
  paymentStatus?: unknown;
  paidAt?: unknown;
  operatorAssigned?: boolean;
  operatorReceiptStatus?: unknown;
  cancellationStatus?: unknown;
  cancellationLoaded?: boolean;
}): ServiceLifecycle {
  const booking = upper(input.bookingStatus);
  const payment = upper(input.paymentStatus);
  const paymentStage: PaymentStage = payment === "REFUNDED"
    ? "REFUNDED"
    : payment === "REFUND_PENDING"
      ? "REFUND_PENDING"
      : payment === "PAID" || Boolean(input.paidAt)
        ? "PAID"
        : payment === "PENDING"
          ? "PENDING"
          : "UNPAID";
  const bookingStage: BookingStage = ["CANCELED", "CANCELLED", "REFUNDED"].includes(booking)
    ? "CANCELLED"
    : ["COMPLETED", "OPERATOR_COMPLETED"].includes(booking)
      ? "COMPLETED"
      : ["IN_PROGRESS", "ACTIVE", "ONGOING"].includes(booking)
        ? "IN_SERVICE"
        : ["CONFIRMED", "PAID"].includes(booking) || paymentStage === "PAID"
          ? "CONFIRMED"
          : "AWAITING_PAYMENT";
  const receiptStage: ReceiptStage = paymentStage === "PAID" || paymentStage === "REFUNDED" ? "AVAILABLE" : "NOT_AVAILABLE";
  const receiptStatus = upper(input.operatorReceiptStatus);
  const responsibilityStage: ResponsibilityStage = receiptStatus === "RECEIVED"
    ? "ACKNOWLEDGED"
    : receiptStatus === "AWAITING_RECEIPT"
      ? "DELIVERED"
      : input.operatorAssigned
        ? "ASSIGNED"
        : "NOT_ASSIGNED";
  const caseStage = mapCaseStage(input.cancellationStatus, Boolean(input.cancellationLoaded));
  const issues: LifecycleIssue[] = [];
  if (Boolean(input.paidAt) && payment && payment !== "PAID" && payment !== "REFUNDED") issues.push({ code: "PAID_TIMESTAMP_STATUS_CONFLICT", severity: "ERROR", message: "Tour has a paid timestamp but payment status is not paid." });
  if (bookingStage === "CONFIRMED" && paymentStage !== "PAID") issues.push({ code: "CONFIRMED_WITHOUT_PAYMENT", severity: "ERROR", message: "Tour booking is confirmed while payment is not verified." });
  if (receiptStage === "AVAILABLE" && paymentStage !== "PAID" && paymentStage !== "REFUNDED") issues.push({ code: "RECEIPT_WITHOUT_VERIFIED_PAYMENT", severity: "ERROR", message: "Tour receipt is available without verified payment." });
  if (caseStage === "REJECTED" && bookingStage === "CANCELLED") issues.push({ code: "REJECTED_CANCELLATION_WITH_CANCELLED_BOOKING", severity: "ERROR", message: "Rejected tour cancellation conflicts with a cancelled booking." });
  const requiredAction: LifecycleAction = issues.length
    ? "CONTACT_SUPPORT"
    : ["SUBMITTED", "REVIEWING", "APPROVED", "REFUND_PENDING"].includes(caseStage)
      ? "REVIEW_CANCELLATION"
      : bookingStage === "AWAITING_PAYMENT"
        ? "COMPLETE_PAYMENT"
        : bookingStage === "CONFIRMED"
          ? "PREPARE_FOR_SERVICE"
          : bookingStage === "IN_SERVICE"
            ? "FOLLOW_SERVICE_PLAN"
            : booking === "OPERATOR_COMPLETED"
              ? "CONFIRM_COMPLETION"
              : "NO_ACTION";
  return result({ serviceType: "TOUR", bookingStage, paymentStage, receiptStage, responsibilityStage, caseStage, requiredAction, issues });
}
