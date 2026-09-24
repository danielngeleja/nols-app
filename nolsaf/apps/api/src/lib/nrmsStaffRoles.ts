// apps/api/src/lib/nrmsStaffRoles.ts
//
// The one list of NRMS staff roles.
//
// These values are written to NrmsStaffMembership.role. Before this module they
// were re-declared in five places (the invite validator, the invite email
// labels, the property-access type, the admin role resolver, and the admin
// customer filter), which had already drifted: the invite email had no entry
// for HOUSEKEEPER and sent the raw code to the staff member.
//
// This is the assignable role list. Retired database values such as
// HOUSEKEEPER deliberately stay out of it so every new invitation fails closed.
// Every consumer is typed against `NrmsStaffRole`, so a label map that forgets
// a new role fails to compile rather than silently printing a code at someone.

export const NRMS_STAFF_ROLES = [
  "MANAGER",
  "SALES_EXECUTIVE",
  "FRONT_DESK",
  "RESTAURANT",
  "BAR",
  "OUTLET_SUPERVISOR",
] as const;

export type NrmsStaffRole = (typeof NRMS_STAFF_ROLES)[number];

/**
 * Wording for administrators: short, and says what the person does rather than
 * naming the system. The staff-facing invite email has its own phrasing in
 * nrmsStaffEmails.ts, built over the same codes.
 */
export const NRMS_STAFF_ROLE_LABELS: Record<NrmsStaffRole, string> = {
  MANAGER: "Manager",
  SALES_EXECUTIVE: "Sales executive",
  FRONT_DESK: "Front desk",
  RESTAURANT: "Restaurant",
  BAR: "Bar attendant",
  OUTLET_SUPERVISOR: "Outlet supervisor",
};

/**
 * Roles that only make sense against one outlet, so an assignment must name it.
 *
 * Kept beside the role list rather than as a loose array at the call site: it
 * was previously retyped in the staff assign handler and again in the owner's
 * staff page, which meant a new outlet-scoped role would be accepted by one and
 * rejected by the other.
 */
export const NRMS_OUTLET_SCOPED_ROLES: readonly NrmsStaffRole[] = [
  "RESTAURANT",
  "BAR",
  "OUTLET_SUPERVISOR",
];

export function nrmsRoleRequiresOutlet(code: string): boolean {
  return (NRMS_OUTLET_SCOPED_ROLES as readonly string[]).includes(code);
}

/**
 * The outlet type a role must be attached to, or null when any outlet will do.
 * Mirrors the checks the staff assign handler makes after loading the outlet.
 */
export function nrmsRoleOutletType(code: string): string | null {
  if (code === "RESTAURANT") return "RESTAURANT";
  if (code === "BAR") return "BAR";
  return null;
}

export function isNrmsStaffRole(value: unknown): value is NrmsStaffRole {
  return typeof value === "string" && (NRMS_STAFF_ROLES as readonly string[]).includes(value);
}

/**
 * Label for a role code. Unknown codes are prettified rather than dropped, so
 * a row written before a role was retired still reads as something.
 */
export function nrmsStaffRoleLabel(code: string): string {
  if (isNrmsStaffRole(code)) return NRMS_STAFF_ROLE_LABELS[code];
  return String(code || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/^\S/, (c) => c.toUpperCase()) || "Unknown role";
}
