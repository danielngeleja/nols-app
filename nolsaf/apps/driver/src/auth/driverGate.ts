import type { AuthUser } from "./types";

export type DriverGateState =
  | "pending_kyc"
  | "action_required"
  | "rejected"
  | "suspended"
  | "incomplete_onboarding"
  | "ok";

const REQUIRED_DRIVER_DOCUMENT_GROUPS = [
  ["DRIVER_LICENSE", "DRIVING_LICENSE", "DRIVER_LICENCE", "DRIVING_LICENCE", "LICENSE"],
  ["NATIONAL_ID", "ID", "PASSPORT"],
  ["VEHICLE_REGISTRATION", "LATRA", "VEHICLE_REG"],
  ["INSURANCE"]
];

function extractExpiryDate(metadata: Record<string, unknown> | null | undefined): Date | null {
  if (!metadata) return null;
  const raw = metadata.expiresAt ?? metadata.expiresOn ?? metadata.expiryDate ??
    metadata.expiry ?? metadata.licenseExpiresOn ?? metadata.licenseExpiryDate;
  if (!raw) return null;
  const date = new Date(String(raw).includes("T") ? String(raw) : `${String(raw)}T23:59:59.999Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isDriverOnboardingComplete(account: AuthUser): boolean {
  const requiredTextFields = [
    account.name,
    account.email,
    account.phone,
    account.gender,
    account.nationality,
    account.nin,
    account.region,
    account.district,
    account.operationArea,
    account.vehicleType,
    account.plateNumber,
    account.licenseNumber,
    account.paymentPhone
  ];
  if (requiredTextFields.some((value) => !String(value ?? "").trim())) return false;
  if (!account.paymentVerified) return false;

  const docs = Array.isArray(account.documents) ? account.documents : [];
  const docTypes = new Set(
    docs.filter((doc) => doc?.url).map((doc) => String(doc?.type ?? "").toUpperCase())
  );
  const licenseDoc = docs.find((doc) =>
    REQUIRED_DRIVER_DOCUMENT_GROUPS[0].includes(String(doc?.type ?? "").toUpperCase()) && Boolean(doc?.url)
  );
  const licenseExpiry = extractExpiryDate(licenseDoc?.metadata);
  if (!licenseExpiry || licenseExpiry.getTime() < Date.now()) return false;
  return REQUIRED_DRIVER_DOCUMENT_GROUPS.every((group) => group.some((type) => docTypes.has(type)));
}

/** Mirrors the protected driver API's license-expiry requirement. */
export function getDriverGateState(user: AuthUser): DriverGateState {
  if (user.kycStatus === "PENDING_KYC") {
    return user.kycNote ? "action_required" : "pending_kyc";
  }

  if (user.suspendedAt || user.isDisabled) {
    return "suspended";
  }

  if (user.kycStatus === "REJECTED_KYC") {
    return "rejected";
  }

  if (!isDriverOnboardingComplete(user)) {
    return "incomplete_onboarding";
  }

  return "ok";
}
