import { isNrmsStaffRole, type NrmsStaffRole } from "./nrmsStaffRoles.js";

/**
 * Stable server-owned capability catalogue for property NRMS workspaces.
 *
 * A capability answers only whether a role may attempt an operation. Resource
 * state, tenant/outlet scope, approval limits and separation of duties are
 * evaluated by authorizeNrmsAccess below and by tighter route business rules.
 */
export const NRMS_CAPABILITIES = [
  "property.overview.read",
  "property.settings.read",
  "property.settings.manage",
  "availability.read",
  "room_status.read",
  "room_status.update",
  "reservation.read",
  "reservation.create",
  "reservation.modify",
  "reservation.cancel_request",
  "reservation.cancel_approve",
  "reservation.check_in",
  "reservation.check_out",
  "guest.read",
  "guest.manage",
  "sales.inquiry.read",
  "sales.inquiry.manage",
  "sales.inquiry.convert",
  "sales.group.manage",
  "sales.agent.read",
  "sales.agent.manage",
  "sales.analytics.read",
  "rates.read",
  "rates.change_request",
  "rates.publish",
  "distribution.read",
  "distribution.manage",
  "payment.request.create",
  "payment.initiate",
  "payment.manual_record",
  "payment.void_request",
  "payment.void_approve",
  "payment.refund_request",
  "payment.refund_approve",
  "finance.shift.read_own",
  "finance.shift.manage_own",
  "finance.cashier_variance.review",
  "finance.night_audit.read",
  "finance.night_audit.close",
  "finance.revenue.read",
  "finance.ledger.read",
  "finance.settlement.read",
  "outlet.read",
  "outlet.order.manage",
  "outlet.bill.manage",
  "outlet.shift.read",
  "outlet.shift.manage",
  "outlet.exception.request",
  "outlet.exception.approve",
  "staff.directory.read",
  "staff.lower_role.assign",
  "staff.lower_role.revoke",
  "staff.manager.assign",
  "staff.manager.revoke",
  "nrms.subscription.manage",
  "merchant.kyc.submit",
  "merchant.provider.activate",
  "merchant.wallet.change",
  "merchant.settlement_destination.change",
  "merchant.policy.accept",
] as const;

export type NrmsCapability = (typeof NRMS_CAPABILITIES)[number];
export type NrmsRole = "OWNER" | NrmsStaffRole;
export type NrmsWorkspace =
  | "OWNER"
  | "MANAGER"
  | "SALES_EXECUTIVE"
  | "FRONT_DESK"
  | "OUTLET_SUPERVISOR"
  | "RESTAURANT"
  | "BAR";

export const RETIRED_NRMS_ROLES = ["HOUSEKEEPER"] as const;

const MANAGER_CAPABILITIES = [
  "property.overview.read",
  "property.settings.read",
  "property.settings.manage",
  "availability.read",
  "room_status.read",
  "room_status.update",
  "reservation.read",
  "reservation.create",
  "reservation.modify",
  "reservation.cancel_request",
  "reservation.cancel_approve",
  "reservation.check_in",
  "reservation.check_out",
  "guest.read",
  "guest.manage",
  "sales.inquiry.read",
  "sales.inquiry.manage",
  "sales.inquiry.convert",
  "sales.group.manage",
  "sales.agent.read",
  "sales.agent.manage",
  "sales.analytics.read",
  "rates.read",
  "rates.change_request",
  "distribution.read",
  "payment.request.create",
  "payment.initiate",
  "payment.manual_record",
  "payment.void_request",
  "payment.refund_request",
  "finance.cashier_variance.review",
  "finance.night_audit.read",
  "finance.night_audit.close",
  "finance.revenue.read",
  "finance.ledger.read",
  "finance.settlement.read",
  "outlet.read",
  "outlet.order.manage",
  "outlet.bill.manage",
  "outlet.shift.read",
  "outlet.shift.manage",
  "outlet.exception.request",
  "staff.directory.read",
  "staff.lower_role.assign",
  "staff.lower_role.revoke",
] as const satisfies readonly NrmsCapability[];

export const NRMS_ROLE_CAPABILITIES = {
  OWNER: NRMS_CAPABILITIES,
  MANAGER: MANAGER_CAPABILITIES,
  SALES_EXECUTIVE: [
    "property.overview.read",
    "availability.read",
    "reservation.read",
    "guest.read",
    "sales.inquiry.read",
    "sales.inquiry.manage",
    "sales.inquiry.convert",
    "sales.group.manage",
    "sales.agent.read",
    "sales.agent.manage",
    "sales.analytics.read",
    "rates.read",
    "rates.change_request",
    "payment.request.create",
  ],
  FRONT_DESK: [
    "property.overview.read",
    "availability.read",
    "room_status.read",
    "room_status.update",
    "reservation.read",
    "reservation.create",
    "reservation.modify",
    "reservation.cancel_request",
    "reservation.check_in",
    "reservation.check_out",
    "guest.read",
    "guest.manage",
    "sales.inquiry.read",
    "sales.inquiry.convert",
    "rates.read",
    "payment.request.create",
    "finance.shift.read_own",
    "finance.shift.manage_own",
    "finance.night_audit.read",
    "finance.revenue.read",
  ],
  OUTLET_SUPERVISOR: [
    "property.overview.read",
    "payment.request.create",
    "payment.initiate",
    "payment.manual_record",
    "payment.void_request",
    "payment.refund_request",
    "finance.shift.read_own",
    "finance.shift.manage_own",
    "finance.revenue.read",
    "outlet.read",
    "outlet.order.manage",
    "outlet.bill.manage",
    "outlet.shift.read",
    "outlet.shift.manage",
    "outlet.exception.request",
  ],
  RESTAURANT: [
    "payment.request.create",
    "payment.initiate",
    "payment.manual_record",
    "payment.void_request",
    "finance.shift.read_own",
    "finance.shift.manage_own",
    "finance.revenue.read",
    "outlet.read",
    "outlet.order.manage",
    "outlet.bill.manage",
    "outlet.shift.read",
    "outlet.shift.manage",
    "outlet.exception.request",
  ],
  BAR: [
    "payment.request.create",
    "payment.initiate",
    "payment.manual_record",
    "payment.void_request",
    "finance.shift.read_own",
    "finance.shift.manage_own",
    "finance.revenue.read",
    "outlet.read",
    "outlet.order.manage",
    "outlet.bill.manage",
    "outlet.shift.read",
    "outlet.shift.manage",
    "outlet.exception.request",
  ],
} as const satisfies Record<NrmsRole, readonly NrmsCapability[]>;

const WORKSPACES: Record<NrmsRole, NrmsWorkspace> = {
  OWNER: "OWNER",
  MANAGER: "MANAGER",
  SALES_EXECUTIVE: "SALES_EXECUTIVE",
  FRONT_DESK: "FRONT_DESK",
  OUTLET_SUPERVISOR: "OUTLET_SUPERVISOR",
  RESTAURANT: "RESTAURANT",
  BAR: "BAR",
};

const OUTLET_SCOPED_PREFIX = "outlet.";

/**
 * Approval capabilities are named two ways: as their own segment
 * (`outlet.exception.approve`) and as a verb pair (`payment.void_approve`). Matching
 * only the underscore form silently exempted quote, discount and outlet
 * exception approvals from limits and separation of duties, so both spellings
 * are recognised here off the last path segment.
 */
function isApprovalCapability(capability: string): boolean {
  const action = capability.split(".").pop() ?? "";
  return action === "approve" || action.endsWith("_approve");
}

export type NrmsAuthorizationReason =
  | "NRMS_UNAUTHENTICATED"
  | "NRMS_ROLE_RETIRED"
  | "NRMS_ROLE_UNSUPPORTED"
  | "NRMS_MEMBERSHIP_INACTIVE"
  | "NRMS_MEMBERSHIP_UNCONFIRMED"
  | "NRMS_PROPERTY_SCOPE_MISMATCH"
  | "NRMS_CAPABILITY_DENIED"
  | "NRMS_OUTLET_SCOPE_REQUIRED"
  | "NRMS_OUTLET_SCOPE_MISMATCH"
  | "NRMS_APPROVAL_LIMIT_REQUIRED"
  | "NRMS_APPROVAL_LIMIT_EXCEEDED"
  | "NRMS_SEPARATION_OF_DUTIES";

export type NrmsAuthorizationDecision =
  | { allowed: true }
  | { allowed: false; reasonCode: NrmsAuthorizationReason };

export type NrmsAuthorizationInput = {
  actorId: number | null | undefined;
  role: string | null | undefined;
  capability: NrmsCapability;
  propertyId: number;
  targetPropertyId?: number;
  membershipStatus?: string | null;
  membershipConfirmed?: boolean;
  assignedOutletId?: number | null;
  targetOutletId?: number | null;
  amount?: number;
  approvalLimit?: number | null;
  requesterId?: number | null;
};

export function isNrmsRole(value: unknown): value is NrmsRole {
  return value === "OWNER" || isNrmsStaffRole(value);
}

export function isRetiredNrmsRole(value: unknown): boolean {
  return (RETIRED_NRMS_ROLES as readonly unknown[]).includes(value);
}

export function hasNrmsCapability(role: string, capability: NrmsCapability): boolean {
  if (!isNrmsRole(role)) return false;
  return (NRMS_ROLE_CAPABILITIES[role] as readonly NrmsCapability[]).includes(capability);
}

export function authorizeNrmsAccess(input: NrmsAuthorizationInput): NrmsAuthorizationDecision {
  if (!Number.isInteger(input.actorId) || Number(input.actorId) <= 0) {
    return { allowed: false, reasonCode: "NRMS_UNAUTHENTICATED" };
  }
  if (isRetiredNrmsRole(input.role)) {
    return { allowed: false, reasonCode: "NRMS_ROLE_RETIRED" };
  }
  if (!isNrmsRole(input.role)) {
    return { allowed: false, reasonCode: "NRMS_ROLE_UNSUPPORTED" };
  }
  if (input.role !== "OWNER") {
    if (input.membershipStatus !== "ACTIVE") {
      return { allowed: false, reasonCode: "NRMS_MEMBERSHIP_INACTIVE" };
    }
    if (!input.membershipConfirmed) {
      return { allowed: false, reasonCode: "NRMS_MEMBERSHIP_UNCONFIRMED" };
    }
  }
  if ((input.targetPropertyId ?? input.propertyId) !== input.propertyId) {
    return { allowed: false, reasonCode: "NRMS_PROPERTY_SCOPE_MISMATCH" };
  }
  if (!hasNrmsCapability(input.role, input.capability)) {
    return { allowed: false, reasonCode: "NRMS_CAPABILITY_DENIED" };
  }
  if (input.capability.startsWith(OUTLET_SCOPED_PREFIX) && !["OWNER", "MANAGER"].includes(input.role)) {
    if (!input.assignedOutletId) {
      return { allowed: false, reasonCode: "NRMS_OUTLET_SCOPE_REQUIRED" };
    }
    if (input.targetOutletId != null && input.targetOutletId !== input.assignedOutletId) {
      return { allowed: false, reasonCode: "NRMS_OUTLET_SCOPE_MISMATCH" };
    }
  }
  if (isApprovalCapability(input.capability) && input.amount != null) {
    if (input.approvalLimit == null) {
      return { allowed: false, reasonCode: "NRMS_APPROVAL_LIMIT_REQUIRED" };
    }
    if (input.amount > input.approvalLimit) {
      return { allowed: false, reasonCode: "NRMS_APPROVAL_LIMIT_EXCEEDED" };
    }
  }
  if (input.requesterId != null && input.requesterId === input.actorId && isApprovalCapability(input.capability)) {
    return { allowed: false, reasonCode: "NRMS_SEPARATION_OF_DUTIES" };
  }
  return { allowed: true };
}

export type NrmsEffectiveAccessManifest = {
  propertyId: number;
  primaryRole: NrmsRole;
  workspace: NrmsWorkspace;
  capabilities: NrmsCapability[];
  scopes: {
    outletIds: number[];
    shift: "ANY" | "OWN" | "NONE";
    finance: "FULL" | "OPERATIONAL" | "LIMITED" | "NONE";
  };
  membershipVersion: number;
};

export function buildNrmsEffectiveAccessManifest(input: {
  propertyId: number;
  role: NrmsRole;
  outletId?: number | null;
  membershipVersion?: number | null;
}): NrmsEffectiveAccessManifest {
  const propertyWide = input.role === "OWNER" || input.role === "MANAGER";
  const operationalFinance = ["MANAGER", "FRONT_DESK", "OUTLET_SUPERVISOR"].includes(input.role);
  const ownShift = ["FRONT_DESK", "OUTLET_SUPERVISOR", "RESTAURANT", "BAR"].includes(input.role);
  return {
    propertyId: input.propertyId,
    primaryRole: input.role,
    workspace: WORKSPACES[input.role],
    capabilities: [...NRMS_ROLE_CAPABILITIES[input.role]],
    scopes: {
      outletIds: propertyWide ? [] : input.outletId ? [input.outletId] : [],
      shift: propertyWide ? "ANY" : ownShift ? "OWN" : "NONE",
      finance: input.role === "OWNER" ? "FULL" : operationalFinance ? "OPERATIONAL" : ownShift ? "LIMITED" : "NONE",
    },
    membershipVersion: Math.max(0, input.membershipVersion ?? 0),
  };
}
