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
// Adding a sub-role is now a two-line change here. Every consumer is typed
// against `NrmsStaffRole`, so a label map that forgets the new role fails to
// compile rather than silently printing a code at someone.

export const NRMS_STAFF_ROLES = [
  "MANAGER",
  "FRONT_DESK",
  "HOUSEKEEPER",
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
  FRONT_DESK: "Front desk",
  HOUSEKEEPER: "Housekeeper",
  RESTAURANT: "Restaurant",
  BAR: "Bar attendant",
  OUTLET_SUPERVISOR: "Outlet supervisor",
};

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
