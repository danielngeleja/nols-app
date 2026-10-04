// apps/api/src/lib/userRoles.ts
//
// Every hat one account wears.
//
// `User.role` is a single column, so it can only ever say one thing. In
// practice one person is frequently several things at once: a customer who
// books stays, who also tends the bar at one property, who also fronts the
// desk at another, who is also a NoLSAF sales partner. Reading only
// `User.role` hides all of that, which is how a support conversation ends up
// looking at the wrong account.
//
// This resolver reads the relations that actually confer a capability and
// returns them as one list. It never invents a role: each entry names the row
// it came from, so an administrator can go and look.
//
// Two kinds of role exist here and they behave differently:
//
//   ADDITIVE           sits alongside whatever User.role already says. Verified
//                      by reading the creation paths: neither the NRMS staff
//                      invite (nrms.operations.ts) nor sales partner onboarding
//                      (admin.sales.partners.ts) touches User.role, so a
//                      traveller invited to tend a bar stays role = CUSTOMER.
//
//   ACCOUNT_DEFINING   replaces User.role. admin.agents.ts sets role = "AGENT"
//                      when a tour operator profile is created; a travel agency
//                      primary user is NRMS_AGENT; owners are OWNER. These
//                      accounts leave the customer list entirely, so an account
//                      can never truthfully read "Customer + Tour operator".
//
// `additive` records which kind an entry is, so a caller can present the two
// correctly instead of implying a combination this system cannot produce.

import { nrmsStaffRoleLabel } from "./nrmsStaffRoles.js";

export type UserRoleSource =
  | "ACCOUNT"
  | "NRMS_STAFF"
  | "SALES_PARTNER"
  | "TRAVEL_AGENCY"
  | "TOUR_OPERATOR"
  | "PROPERTY_OWNER"
  | "MERCHANT_ADMIN";

export type UserRole = {
  source: UserRoleSource;
  /** Machine code, e.g. FRONT_DESK, BAR, SALES_PARTNER. */
  code: string;
  /** What to print on a badge. */
  label: string;
  /** Where the role applies: property name, territory, company. */
  scope: string | null;
  /** Live, pending, suspended and so on, in the source's own vocabulary. */
  status: string;
  /** True when this role can be exercised right now. */
  active: boolean;
  /** True when the role sits alongside User.role rather than replacing it.
   *  See the two kinds described at the top of this file. */
  additive: boolean;
  since: string | null;
  /** Extra identifying detail, e.g. a partner code or an outlet name. */
  detail: string | null;
};

const ACCOUNT_ROLE_LABELS: Record<string, string> = {
  ADMIN: "Administrator",
  OWNER: "Property owner",
  DRIVER: "Driver",
  CUSTOMER: "Customer",
  AGENT: "Agent",
  NRMS_AGENT: "Travel agency",
};

function iso(value: any): string | null {
  return value ? new Date(value).toISOString() : null;
}

function label(code: string, table: Record<string, string>): string {
  return table[code] ?? code.replace(/_/g, " ").toLowerCase().replace(/^\S/, c => c.toUpperCase());
}

export type UserRoleSummary = {
  /** The single value on User.role. Kept separate because it is not the whole story. */
  accountRole: string;
  roles: UserRole[];
  /** Roles that can be exercised right now. */
  activeCount: number;
  /** Roles that genuinely sit alongside User.role. */
  additiveCount: number;
  /** True when the account holds a role ALONGSIDE its account role. Roles that
   *  replace the account role do not count: an AGENT account is not a customer
   *  who also holds a tour operator role. */
  hasAdditionalRoles: boolean;
  /** Short list for a table cell or a badge row. Additive roles only. */
  badges: string[];
};

/**
 * Resolves every role one user holds. Never throws: an account page must still
 * render if one of these tables is unavailable, and a missing role is reported
 * as an absent role rather than as an error.
 */
export async function resolveUserRoles(db: any, userId: number): Promise<UserRoleSummary> {
  const empty: UserRoleSummary = {
    accountRole: "UNKNOWN",
    roles: [],
    activeCount: 0,
    additiveCount: 0,
    hasAdditionalRoles: false,
    badges: [],
  };

  try {
    const user = await db.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, createdAt: true, suspendedAt: true },
    });
    if (!user) return empty;

    const [staff, salesPartner, agencies, tourOperator, ownedProperties, merchants] = await Promise.all([
      db.nrmsStaffMembership.findMany({
        where: { userId },
        select: {
          role: true, status: true, confirmedAt: true, createdAt: true,
          property: { select: { title: true } },
          outlet: { select: { name: true } },
        },
        orderBy: { id: "asc" },
      }).catch(() => []),
      db.salesPartnerProfile.findUnique({
        where: { userId },
        select: {
          agentCode: true, status: true, level: true, region: true, territory: true,
          activatedAt: true, createdAt: true, suspendedAt: true, terminatedAt: true,
        },
      }).catch(() => null),
      db.nrmsAgentAccount.findMany({
        where: { primaryUserId: userId },
        select: { legalName: true, tradingName: true, status: true, verificationStatus: true, createdAt: true },
      }).catch(() => []),
      // A tour operator is a separate profile from the account role: the same
      // person can book stays as a customer and sell tours as an operator.
      db.agent.findUnique({
        where: { userId },
        select: { id: true, status: true, createdAt: true, operatorProfile: true },
      }).catch(() => null),
      db.property.count({ where: { ownerId: userId } }).catch(() => 0),
      db.merchantLegalEntity.findMany({
        where: { administeredById: userId },
        select: { legalName: true, tradingName: true, status: true, createdAt: true },
      }).catch(() => []),
    ]);

    const roles: UserRole[] = [];

    // The account's own role always leads, so the list is never empty and the
    // single-column answer is still visible next to the fuller picture.
    const accountRole = String(user.role || "CUSTOMER").toUpperCase();
    roles.push({
      source: "ACCOUNT",
      // The account role is the baseline, not something held in addition.
      additive: false,
      code: accountRole,
      label: label(accountRole, ACCOUNT_ROLE_LABELS),
      scope: "NoLSAF account",
      status: user.suspendedAt ? "SUSPENDED" : "ACTIVE",
      active: !user.suspendedAt,
      since: iso(user.createdAt),
      detail: null,
    });

    for (const row of staff as any[]) {
      const code = String(row.role || "").toUpperCase();
      roles.push({
        source: "NRMS_STAFF",
        additive: true,
        code,
        label: nrmsStaffRoleLabel(code),
        scope: row.property?.title ?? "Property not named",
        status: String(row.status || "PENDING").toUpperCase(),
        // Only a confirmed membership grants access; an invite does not.
        active: String(row.status || "").toUpperCase() === "ACTIVE",
        since: iso(row.confirmedAt ?? row.createdAt),
        detail: row.outlet?.name ? `Outlet: ${row.outlet.name}` : null,
      });
    }

    if (salesPartner) {
      const status = String(salesPartner.status || "PENDING").toUpperCase();
      roles.push({
        source: "SALES_PARTNER",
        additive: true,
        code: "SALES_PARTNER",
        label: "Sales partner",
        scope: salesPartner.territory || salesPartner.region || "Territory not set",
        status,
        active: status === "ACTIVE" && !salesPartner.suspendedAt && !salesPartner.terminatedAt,
        since: iso(salesPartner.activatedAt ?? salesPartner.createdAt),
        detail: [salesPartner.agentCode, salesPartner.level ? `Level ${salesPartner.level}` : null]
          .filter(Boolean).join(" · ") || null,
      });
    }

    for (const row of agencies as any[]) {
      const status = String(row.status || "").toUpperCase();
      roles.push({
        source: "TRAVEL_AGENCY",
        // The agency's primary user is NRMS_AGENT, not a customer who also
        // happens to run an agency.
        additive: false,
        code: "TRAVEL_AGENCY",
        label: "Travel agency",
        scope: row.tradingName || row.legalName || "Agency not named",
        status,
        active: status === "ACTIVE",
        since: iso(row.createdAt),
        detail: row.verificationStatus && row.verificationStatus !== "VERIFIED"
          ? `KYC ${String(row.verificationStatus).toLowerCase()}`
          : null,
      });
    }

    if (tourOperator) {
      const status = String(tourOperator.status || "").toUpperCase();
      // The operator's trading name lives in a JSON profile blob, so read it
      // defensively rather than assuming a shape.
      const profile = (tourOperator.operatorProfile ?? {}) as any;
      const operatorName =
        (typeof profile?.companyName === "string" && profile.companyName.trim())
        || (typeof profile?.businessName === "string" && profile.businessName.trim())
        || (typeof profile?.name === "string" && profile.name.trim())
        || null;
      roles.push({
        source: "TOUR_OPERATOR",
        // Creating an operator profile flips User.role to AGENT.
        additive: false,
        code: "TOUR_OPERATOR",
        label: "Tour operator",
        scope: operatorName || "Operator name not set",
        status: status || "UNKNOWN",
        active: status === "ACTIVE",
        since: iso(tourOperator.createdAt),
        detail: null,
      });
    }

    if (Number(ownedProperties) > 0) {
      roles.push({
        source: "PROPERTY_OWNER",
        // Owning property normally means role = OWNER. It is only additive in
        // the anomalous case flagged in `detail` below.
        additive: accountRole !== "OWNER",
        code: "PROPERTY_OWNER",
        label: "Property owner",
        scope: `${ownedProperties} ${Number(ownedProperties) === 1 ? "property" : "properties"}`,
        status: "ACTIVE",
        active: true,
        since: null,
        detail: accountRole === "OWNER" ? null : "Holds properties without the owner account role",
      });
    }

    for (const row of merchants as any[]) {
      const status = String(row.status || "DRAFT").toUpperCase();
      roles.push({
        source: "MERCHANT_ADMIN",
        // In practice the administering user is the owner of the properties.
        additive: accountRole !== "OWNER",
        code: "MERCHANT_ADMIN",
        label: "Company administrator",
        scope: row.tradingName || row.legalName || "Company not named",
        status,
        active: status === "ACTIVE",
        since: iso(row.createdAt),
        detail: null,
      });
    }

    // Only additive roles count as "also holds". Listing a tour operator as an
    // extra role on top of Customer would describe a state this system cannot
    // produce, because that profile changes the account role.
    const additive = roles.filter(r => r.additive);

    return {
      accountRole,
      roles,
      activeCount: roles.filter(r => r.active).length,
      additiveCount: additive.length,
      hasAdditionalRoles: additive.length > 0,
      // Deduplicated labels for a compact badge row, active roles first.
      badges: [...new Set(
        [...additive].sort((a, b) => Number(b.active) - Number(a.active)).map(r => r.label),
      )].slice(0, 4),
    };
  } catch (err: any) {
    console.warn("Failed to resolve user roles:", err?.message);
    return empty;
  }
}
