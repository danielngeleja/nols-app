/** Central bilateral partnership policy shared by activation and booking gates. */

export type PartnershipConsent = "PENDING" | "ACCEPTED" | "DECLINED" | "WITHDRAWN";

export type PartnershipPolicyInput = {
  linkStatus: string;
  initiatedBy?: string | null;
  hotelConsentStatus?: string | null;
  agentConsentStatus?: string | null;
  agencyStatus?: string | null;
  agencyVerificationStatus?: string | null;
  propertyStatus?: string | null;
  propertyNrmsActivated: boolean;
  paygStatus?: string | null;
};

export type PartnershipPolicyReason =
  | "RELATIONSHIP_NOT_ACTIVE"
  | "HOTEL_CONSENT_REQUIRED"
  | "AGENT_CONSENT_REQUIRED"
  | "CONSENT_DECLINED"
  | "AGENCY_INACTIVE"
  | "AGENCY_NOT_VERIFIED"
  | "PROPERTY_INACTIVE"
  | "PROPERTY_NRMS_INACTIVE"
  | "PROPERTY_BILLING_BLOCKED";

export type PartnershipPolicyResult =
  | { ok: true }
  | { ok: false; reason: PartnershipPolicyReason; message: string };

const upper = (value: unknown) => String(value ?? "").trim().toUpperCase();

/** Legacy inference lets existing rows remain valid while the migration rolls out. */
export function resolvePartnershipConsents(input: Pick<PartnershipPolicyInput, "linkStatus" | "initiatedBy" | "hotelConsentStatus" | "agentConsentStatus">) {
  const status = upper(input.linkStatus);
  const initiatedBy = upper(input.initiatedBy) || (status === "REQUESTED" ? "AGENT" : "HOTEL");
  let hotel = upper(input.hotelConsentStatus) as PartnershipConsent | "";
  let agent = upper(input.agentConsentStatus) as PartnershipConsent | "";

  if (!hotel) {
    hotel = initiatedBy === "HOTEL" || ["AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"].includes(status) ? "ACCEPTED" : "PENDING";
  }
  if (!agent) {
    agent = initiatedBy === "AGENT" || ["AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"].includes(status) ? "ACCEPTED" : "PENDING";
  }
  return { initiatedBy, hotel, agent };
}

function evaluateShared(input: PartnershipPolicyInput): PartnershipPolicyResult {
  const consent = resolvePartnershipConsents(input);
  if ([consent.hotel, consent.agent].some((value) => value === "DECLINED" || value === "WITHDRAWN")) {
    return { ok: false, reason: "CONSENT_DECLINED", message: "This partnership was declined or withdrawn." };
  }
  if (consent.hotel !== "ACCEPTED") return { ok: false, reason: "HOTEL_CONSENT_REQUIRED", message: "The hotel must accept this partnership first." };
  if (consent.agent !== "ACCEPTED") return { ok: false, reason: "AGENT_CONSENT_REQUIRED", message: "The travel operator must accept this partnership first." };
  if (upper(input.agencyStatus) !== "ACTIVE") return { ok: false, reason: "AGENCY_INACTIVE", message: "The agency identity is not active." };
  if (upper(input.agencyVerificationStatus) !== "VERIFIED") return { ok: false, reason: "AGENCY_NOT_VERIFIED", message: "The agency must be centrally verified before activation." };
  if (upper(input.propertyStatus) !== "APPROVED") return { ok: false, reason: "PROPERTY_INACTIVE", message: "The property is not approved." };
  if (!input.propertyNrmsActivated) return { ok: false, reason: "PROPERTY_NRMS_INACTIVE", message: "NRMS is not active for this property." };
  if (!upper(input.paygStatus) || ["FROZEN", "PAYMENT_REQUIRED", "PAYMENT_PENDING", "CLOSED"].includes(upper(input.paygStatus))) {
    return { ok: false, reason: "PROPERTY_BILLING_BLOCKED", message: "The property's NRMS billing account is not currently eligible." };
  }
  return { ok: true };
}

export function canActivatePartnership(input: PartnershipPolicyInput): PartnershipPolicyResult {
  if (!["REQUESTED", "AGENT_ACCEPTED", "ACTIVE", "SUSPENDED"].includes(upper(input.linkStatus))) {
    return { ok: false, reason: "RELATIONSHIP_NOT_ACTIVE", message: "This relationship is not ready for activation." };
  }
  return evaluateShared(input);
}

export function canBookPartnership(input: PartnershipPolicyInput): PartnershipPolicyResult {
  if (upper(input.linkStatus) !== "ACTIVE") {
    return { ok: false, reason: "RELATIONSHIP_NOT_ACTIVE", message: "This hotel partnership is not active." };
  }
  return evaluateShared(input);
}
