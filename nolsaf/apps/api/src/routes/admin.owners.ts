// apps/api/src/routes/admin.owners.ts
import { Router, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { signUserJwt } from "../lib/sessionManager.js";
import { Prisma } from "@prisma/client";
import { toCsv } from "../lib/csv.js";
import { sanitizeUserDocument } from "../lib/userDocumentSecurity.js";
import { revokeUserAuthorization } from "../lib/authorizationInvalidation.js";

export const router = Router();
router.use(requireAuth as unknown as RequestHandler, requireRole("ADMIN") as unknown as RequestHandler);

/** A live merchant link whose merchant holds an ACTIVE provider account. This
 *  is the only state in which money can actually move, so it is what
 *  "has a payment method" means everywhere in this file. */
const LIVE_PAYMENT_LINK = {
  effectiveTo: null,
  merchant: { providerAccounts: { some: { status: "ACTIVE" } } },
} as const;

/** Prisma `where` fragments for the NRMS and Payments capability filters.
 *  `yes` means at least one property qualifies; `no` means none does. Any
 *  other value (including absent) means no filter. */
function capabilityWhere(nrms: unknown, payments: unknown): any[] {
  const clauses: any[] = [];

  const nrmsValue = String(nrms ?? "").toLowerCase();
  if (nrmsValue === "yes" || nrmsValue === "no") {
    const match = { nrmsActivatedAt: { not: null } };
    clauses.push({ properties: nrmsValue === "yes" ? { some: match } : { none: match } });
  }

  const paymentsValue = String(payments ?? "").toLowerCase();
  if (paymentsValue === "yes" || paymentsValue === "no") {
    const match = { merchantLinks: { some: LIVE_PAYMENT_LINK } };
    clauses.push({ properties: paymentsValue === "yes" ? { some: match } : { none: match } });
  }

  return clauses;
}

/** GET /admin/owners/counts */
router.get("/counts", async (req, res) => {
  try {
    // Get total count first (this should always work)
    const total = await prisma.user.count({ where: { role: "OWNER" } }).catch(() => 0);
    
    // Try to get other counts, but handle cases where fields might not exist
    let active = 0;
    let suspended = 0;
    let pendingKYC = 0;
    let approvedKYC = 0;
    let rejectedKYC = 0;

    try {
      // Try suspendedAt field - if it doesn't exist, all are "active"
      const [activeCount, suspendedCount] = await Promise.all([
        prisma.user.count({ where: { role: "OWNER", suspendedAt: null } }).catch(() => total),
        prisma.user.count({ where: { role: "OWNER", suspendedAt: { not: null } } }).catch(() => 0),
      ]);
      active = activeCount;
      suspended = suspendedCount;
    } catch (e) {
      // If suspendedAt field doesn't exist, assume all are active
      active = total;
      suspended = 0;
    }

    try {
      // Try kycStatus field - if it doesn't exist, all are 0
      const [pending, approved, rejected] = await Promise.all([
        prisma.user.count({ where: { role: "OWNER", kycStatus: "PENDING_KYC" } }).catch(() => 0),
        prisma.user.count({ where: { role: "OWNER", kycStatus: "APPROVED_KYC" } }).catch(() => 0),
        prisma.user.count({ where: { role: "OWNER", kycStatus: "REJECTED_KYC" } }).catch(() => 0),
      ]);
      pendingKYC = pending;
      approvedKYC = approved;
      rejectedKYC = rejected;
    } catch (e) {
      // If kycStatus field doesn't exist, all are 0
      pendingKYC = 0;
      approvedKYC = 0;
      rejectedKYC = 0;
    }

    // Capability counts, so the NRMS and Payments filter chips carry numbers
    // the way the status chips do. Same definitions the list filter uses.
    let nrmsYes = 0;
    let paymentsYes = 0;
    let nrmsNoPayments = 0;
    try {
      const [a, b, c] = await Promise.all([
        prisma.user.count({ where: { role: "OWNER", properties: { some: { nrmsActivatedAt: { not: null } } } } }),
        prisma.user.count({ where: { role: "OWNER", properties: { some: { merchantLinks: { some: LIVE_PAYMENT_LINK } } } } }),
        // The one that actually drives a sales call: running the system with no
        // way to take money.
        prisma.user.count({
          where: {
            role: "OWNER",
            AND: [
              { properties: { some: { nrmsActivatedAt: { not: null } } } },
              { properties: { none: { merchantLinks: { some: LIVE_PAYMENT_LINK } } } },
            ],
          },
        }),
      ]);
      nrmsYes = a;
      paymentsYes = b;
      nrmsNoPayments = c;
    } catch (e) {
      // Capability counts are optional; the chips fall back to zero.
    }

    // Return flat structure matching frontend expectations
    return res.status(200).json({
      "": total,
      "ACTIVE": active,
      "SUSPENDED": suspended,
      "PENDING_KYC": pendingKYC,
      "APPROVED_KYC": approvedKYC,
      "REJECTED_KYC": rejectedKYC,
      "NRMS_ACTIVE": nrmsYes,
      "PAYMENTS_ACTIVE": paymentsYes,
      "NRMS_NO_PAYMENTS": nrmsNoPayments,
    });
  } catch (err: any) {
    console.error('Unhandled error in GET /admin/owners/counts:', err);
    // Always return JSON, never HTML
    return res.status(500).json({ 
      error: 'Internal server error',
      message: err?.message || 'Unknown error',
      // Return default counts on error so frontend doesn't break
      "": 0,
      "ACTIVE": 0,
      "SUSPENDED": 0,
      "PENDING_KYC": 0,
      "APPROVED_KYC": 0,
      "REJECTED_KYC": 0,
    });
  }
});

/** GET /admin/owners?q=&status=&page=&pageSize= or &limit= */
router.get("/", async (req, res) => {
  // Wrap everything in try-catch at the very top level
  try {
    const { q = "", status = "", page = "1", pageSize, limit, from, to, propertiesMin, propertiesMax, nrms, payments } = req.query as any;
    const pageSizeValue = pageSize || limit || "50";
    const pageNum = Number(page) || 1;
    const skip = (pageNum - 1) * Number(pageSizeValue);
    const take = Math.min(Number(pageSizeValue), 100);

    // Build where clause safely
    const where: any = { role: "OWNER" };
    
    if (q && String(q).trim()) {
      const searchTerm = String(q).trim();
      where.OR = [
        { name: { contains: searchTerm } },
        { email: { contains: searchTerm } },
        { phone: { contains: searchTerm } },
      ];
    }
    
    if (status) {
      const statusStr = String(status);
      if (statusStr === "SUSPENDED") {
        where.suspendedAt = { not: null };
      } else if (statusStr === "ACTIVE") {
        where.suspendedAt = null;
      } else if (["PENDING_KYC", "APPROVED_KYC", "REJECTED_KYC"].includes(statusStr)) {
        where.kycStatus = statusStr;
      }
    }
    
    // Date range filter (joined date)
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(String(from));
      if (to) where.createdAt.lte = new Date(String(to));
    }

    // Capability filters. Applied to the main query, not to the enriched page,
    // so "owners running NRMS with no way to take payment" is answerable across
    // the whole table rather than only within the current 50 rows.
    // Both are property-level facts, so they filter through User.properties.
    const capabilityClauses = capabilityWhere(nrms, payments);
    if (capabilityClauses.length === 1) {
      Object.assign(where, capabilityClauses[0]);
    } else if (capabilityClauses.length > 1) {
      // Two independent `properties` conditions must both hold, and they may be
      // satisfied by different properties, so they cannot be merged into one.
      where.AND = [...(where.AND ?? []), ...capabilityClauses];
    }

    // Simplified query - no relations first, just basic data
    let items: any[] = [];
    let total = 0;
    
    try {
      // First try: basic query with count
      const [users, countResult] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            suspendedAt: true,
            kycStatus: true,
            createdAt: true,
          },
          orderBy: { id: "desc" },
          skip,
          take,
        }),
        prisma.user.count({ where }),
      ]);
      
      items = users;
      total = countResult;
      
      // Now try to get property counts separately (non-blocking)
      try {
        const userIds = users.map(u => u.id);
        if (userIds.length > 0) {
          const propertyCounts = await prisma.property.groupBy({
            by: ['ownerId'],
            where: { ownerId: { in: userIds } },
            _count: { _all: true },
          });
          
          const countMap = new Map(propertyCounts.map(p => [p.ownerId, p._count._all]));
          
          // Try to get region/district from first property
          const firstProperties = await prisma.property.findMany({
            where: { ownerId: { in: userIds } },
            select: {
              ownerId: true,
              regionName: true,
              regionId: true,
              district: true,
            },
            distinct: ['ownerId'],
            orderBy: { id: 'asc' },
          });
          
          const propertyMap = new Map(firstProperties.map(p => [p.ownerId, p]));

          // Which owners actually run NRMS, and which can take payment. Both
          // are per-property facts rolled up to the owner: an owner counts as
          // activated when any one of their properties is.
          const nrmsRows = await prisma.property.findMany({
            where: { ownerId: { in: userIds }, nrmsActivatedAt: { not: null } },
            select: { ownerId: true },
            distinct: ['ownerId'],
          });
          const nrmsOwners = new Set(nrmsRows.map(row => row.ownerId));

          // A live link plus an ACTIVE provider account is the only state that
          // means money can actually move. A draft or queued application is
          // setup in progress, not a payment method.
          const payingRows = await (prisma as any).merchantPropertyLink.findMany({
            where: {
              effectiveTo: null,
              property: { ownerId: { in: userIds } },
              merchant: { providerAccounts: { some: { status: "ACTIVE" } } },
            },
            select: { property: { select: { ownerId: true } } },
          });
          const payingOwners = new Set<number>(payingRows.map((row: any) => row.property.ownerId));

          // Merge data. The capability flags are only meaningful because the
          // queries above succeeded; if they had not, this line is never
          // reached and the flags stay absent rather than false.
          items = users.map(user => ({
            ...user,
            _propertyCount: countMap.get(user.id) || 0,
            _firstProperty: propertyMap.get(user.id) || null,
            _nrmsActive: nrmsOwners.has(user.id),
            _paymentsActive: payingOwners.has(user.id),
            _capabilitiesResolved: true,
          }));
        }
      } catch (propError: any) {
        console.warn('Failed to fetch property data, continuing without it:', propError?.message);
        // Continue without property data
      }
      
    } catch (dbError: any) {
      console.error('Database query failed:', dbError);
      console.error('Error details:', {
        code: dbError?.code,
        message: dbError?.message,
        meta: dbError?.meta,
      });
      
      // Return empty result instead of crashing
      return res.json({
        total: 0,
        page: pageNum,
        pageSize: take,
        items: [],
      });
    }

    // Transform to frontend format
    const transformedItems = items.map((item: any) => ({
      id: item.id,
      name: item.name ?? null,
      email: item.email ?? null,
      phone: item.phone ?? null,
      createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString(),
      suspendedAt: item.suspendedAt ? new Date(item.suspendedAt).toISOString() : null,
      kycStatus: item.kycStatus ?? null,
      _count: {
        properties: item._propertyCount ?? 0,
      },
      // null, not false, when the capability lookup did not run. "We do not
      // know" and "they do not have it" are different answers, and rendering
      // the first as the second is a silent lie on a sales-facing column.
      nrmsActive: item._capabilitiesResolved ? item._nrmsActive === true : null,
      paymentsActive: item._capabilitiesResolved ? item._paymentsActive === true : null,
      // Additional fields for detail view
      region: item._firstProperty?.regionName ?? item._firstProperty?.regionId ?? null,
      district: item._firstProperty?.district ?? null,
    }));

    return res.json({
      total,
      page: pageNum,
      pageSize: take,
      items: transformedItems,
    });
    
  } catch (err: any) {
    // Ultimate fallback - catch ANY error
    console.error('CRITICAL ERROR in GET /admin/owners:', err);
    console.error('Error type:', typeof err);
    console.error('Error constructor:', err?.constructor?.name);
    console.error('Error message:', err?.message);
    console.error('Error stack:', err?.stack);
    
    // Always return valid JSON response
    const pageNum = Number((req.query as any)?.page) || 1;
    const pageSizeNum = Math.min(Number((req.query as any)?.pageSize || (req.query as any)?.limit || 50), 100);
    
    return res.json({
      total: 0,
      page: pageNum,
      pageSize: pageSizeNum,
      items: [],
    });
  }
});

/** GET /admin/owners/export.csv?status=...&from=...&to=...&q=...&propertiesMin=...&propertiesMax=...
 * Exports owners to CSV.
 */
router.get("/export.csv", async (req, res) => {
  try {
    const { status, from, to, q, propertiesMin, propertiesMax } = req.query as any;

    const where: any = { role: "OWNER" };
    
    if (q && String(q).trim()) {
      // MySQL doesn't support `mode: "insensitive"`; rely on default CI collations.
      const searchTerm = String(q).trim().slice(0, 120);
      where.OR = [
        { name: { contains: searchTerm } },
        { email: { contains: searchTerm } },
        { phone: { contains: searchTerm } },
      ];
    }
    
    if (status) {
      const statusStr = String(status);
      if (statusStr === "SUSPENDED") {
        where.suspendedAt = { not: null };
      } else if (statusStr === "ACTIVE") {
        where.suspendedAt = null;
      } else if (["PENDING_KYC", "APPROVED_KYC", "REJECTED_KYC"].includes(statusStr)) {
        where.kycStatus = statusStr;
      }
    }
    
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(String(from));
      if (to) where.createdAt.lte = new Date(String(to));
    }

    const owners = await prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        createdAt: true,
        suspendedAt: true,
        kycStatus: true,
      },
      orderBy: { id: "desc" },
      take: 10000,
    });

    // Get property counts
    const userIds = owners.map(u => u.id);
    const propertyCounts = await prisma.property.groupBy({
      by: ['ownerId'],
      where: { ownerId: { in: userIds } },
      _count: { _all: true },
    });
    const countMap = new Map(propertyCounts.map(p => [p.ownerId, p._count._all]));

    // Same two capability roll-ups the list view shows, so the export and the
    // table never disagree.
    const nrmsRows = await prisma.property.findMany({
      where: { ownerId: { in: userIds }, nrmsActivatedAt: { not: null } },
      select: { ownerId: true },
      distinct: ['ownerId'],
    });
    const nrmsOwners = new Set(nrmsRows.map(row => row.ownerId));

    const payingRows = await (prisma as any).merchantPropertyLink.findMany({
      where: {
        effectiveTo: null,
        property: { ownerId: { in: userIds } },
        merchant: { providerAccounts: { some: { status: "ACTIVE" } } },
      },
      select: { property: { select: { ownerId: true } } },
    });
    const payingOwners = new Set<number>(payingRows.map((row: any) => row.property.ownerId));

    // Transform and filter by property count
    let rows = owners.map((owner: any) => {
      const propCount = countMap.get(owner.id) || 0;
      return {
        id: owner.id,
        name: owner.name ?? "",
        email: owner.email ?? "",
        phone: owner.phone ?? "",
        propertiesCount: propCount,
        nrmsActive: nrmsOwners.has(owner.id) ? "Yes" : "No",
        paymentsActive: payingOwners.has(owner.id) ? "Yes" : "No",
        kycStatus: owner.kycStatus ?? "",
        accountStatus: owner.suspendedAt ? "Suspended" : "Active",
        joinedAt: owner.createdAt.toISOString(),
        suspendedAt: owner.suspendedAt ? owner.suspendedAt.toISOString() : "",
      };
    });

    // Filter by property count range
    if (propertiesMin || propertiesMax) {
      const min = propertiesMin ? Number(propertiesMin) : 0;
      const max = propertiesMax ? Number(propertiesMax) : Infinity;
      rows = rows.filter(r => r.propertiesCount >= min && r.propertiesCount <= max);
    }

    const csv = toCsv(rows, [
      "id", "name", "email", "phone", "propertiesCount", "nrmsActive", "paymentsActive",
      "kycStatus", "accountStatus", "joinedAt", "suspendedAt"
    ]);

    const filename = `owners_export_${new Date().toISOString().split('T')[0]}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csv);
  } catch (err: any) {
    console.error("Error in GET /admin/owners/export.csv:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

type OwnerCapabilities = {
  nrms: {
    active: boolean;
    /** Earliest activation across the owner's properties, ISO or null. */
    activatedAt: string | null;
    activeProperties: number;
    totalProperties: number;
  };
  payments: {
    /** True only when a provider account is ACTIVE, i.e. money can move. */
    active: boolean;
    activatedAt: string | null;
    /** Where onboarding has actually reached, even when not yet active. */
    stage: string | null;
    merchantName: string | null;
    providerName: string | null;
  };
};

/** Both capability roll-ups for one owner. Never throws: a failure here must
 *  not take down the owner detail page, so it degrades to "unknown = off". */
async function ownerCapabilities(ownerId: number): Promise<OwnerCapabilities> {
  const empty: OwnerCapabilities = {
    nrms: { active: false, activatedAt: null, activeProperties: 0, totalProperties: 0 },
    payments: { active: false, activatedAt: null, stage: null, merchantName: null, providerName: null },
  };

  try {
    const [totalProperties, nrmsProps, links] = await Promise.all([
      prisma.property.count({ where: { ownerId } }),
      prisma.property.findMany({
        where: { ownerId, nrmsActivatedAt: { not: null } },
        select: { nrmsActivatedAt: true },
        orderBy: { nrmsActivatedAt: "asc" },
      }),
      (prisma as any).merchantPropertyLink.findMany({
        where: { effectiveTo: null, property: { ownerId } },
        select: {
          merchant: {
            select: {
              legalName: true,
              tradingName: true,
              providerAccounts: {
                select: {
                  status: true,
                  activatedAt: true,
                  connection: { select: { displayName: true, provider: true } },
                },
              },
            },
          },
        },
      }),
    ]);

    const nrms = {
      active: nrmsProps.length > 0,
      activatedAt: nrmsProps[0]?.nrmsActivatedAt
        ? new Date(nrmsProps[0].nrmsActivatedAt as any).toISOString()
        : null,
      activeProperties: nrmsProps.length,
      totalProperties,
    };

    // Prefer an ACTIVE account. If none is active, still report the furthest
    // stage reached so "not active" is not confused with "never started".
    let best: any = null;
    let merchantName: string | null = null;
    for (const link of links as any[]) {
      const merchant = link?.merchant;
      if (!merchant) continue;
      for (const account of merchant.providerAccounts ?? []) {
        const isActive = account?.status === "ACTIVE";
        if (!best || (isActive && best.status !== "ACTIVE")) {
          best = account;
          merchantName = merchant.tradingName || merchant.legalName || null;
        }
      }
      if (!best && !merchantName) merchantName = merchant.tradingName || merchant.legalName || null;
    }

    const payments = {
      active: best?.status === "ACTIVE",
      activatedAt: best?.activatedAt ? new Date(best.activatedAt).toISOString() : null,
      stage: best?.status ?? null,
      merchantName,
      providerName: best?.connection?.displayName ?? best?.connection?.provider ?? null,
    };

    return { nrms, payments };
  } catch (err: any) {
    console.warn("Failed to compute owner capabilities:", err?.message);
    return empty;
  }
}

type OwnerNrmsBilling = {
  /** Money NoLSAF has actually collected for NRMS from this owner. */
  collected: number;
  paymentsCount: number;
  /** Statements closed and issued, whether or not they have been paid. */
  billed: number;
  statementsCount: number;
  /** Closed statements still PAYABLE. Reported for context; it is not revenue. */
  outstanding: number;
  outstandingCount: number;
  /** Billable usage recorded but not yet closed into a statement. */
  unbilledUsage: number;
  /** Accounts backing these figures, one per NRMS-enabled property. */
  accountsCount: number;
  currency: string;
};

/** NRMS pay-as-you-go billing for one owner, across all of their properties.
 *  Realized revenue is provider-verified plus administrator-reconciled
 *  payments, exactly as admin.financeOverview counts the subscriptions stream.
 *  Never throws: the owner page must still render if billing is unavailable. */
async function ownerNrmsBilling(ownerId: number): Promise<OwnerNrmsBilling> {
  const empty: OwnerNrmsBilling = {
    collected: 0, paymentsCount: 0,
    billed: 0, statementsCount: 0,
    outstanding: 0, outstandingCount: 0,
    unbilledUsage: 0, accountsCount: 0,
    currency: "TZS",
  };

  try {
    const [paid, allStatements, payable, unbilled, accounts] = await Promise.all([
      prisma.nrmsServicePayment.aggregate({
        where: {
          status: { in: ["VERIFIED", "MANUALLY_VERIFIED"] },
          token: { statement: { account: { ownerId } } },
        },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.nrmsBillingStatement.aggregate({
        where: { account: { ownerId } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      prisma.nrmsBillingStatement.aggregate({
        where: { status: "PAYABLE", account: { ownerId } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      // Usage earned but not yet closed into a statement. Filtered exactly as
      // nrmsBilling's statement close does (amount > 0, no statement item), so
      // this is what the next statement would actually pick up.
      prisma.nrmsUsageEvent.aggregate({
        where: { account: { ownerId }, amount: { gt: 0 }, statementItem: { is: null } },
        _sum: { amount: true },
      }),
      prisma.ownerPaygAccount.count({ where: { ownerId } }),
    ]);

    return {
      collected: Number(paid._sum.amount ?? 0),
      paymentsCount: paid._count._all,
      billed: Number(allStatements._sum.amount ?? 0),
      statementsCount: allStatements._count._all,
      outstanding: Number(payable._sum.amount ?? 0),
      outstandingCount: payable._count._all,
      unbilledUsage: Number(unbilled._sum.amount ?? 0),
      accountsCount: accounts,
      // NRMS policies are TZS-only today; kept explicit so the client never
      // has to guess the unit.
      currency: "TZS",
    };
  } catch (err: any) {
    console.warn("Failed to compute owner NRMS billing:", err?.message);
    return empty;
  }
}

type OwnerPartners = {
  /** Legal entities that operate this owner's properties and receive payment. */
  merchants: {
    id: number;
    /** null when the company has not been named yet (draft application). */
    name: string | null;
    legalName: string | null;
    registrationNumber: string | null;
    tin: string | null;
    country: string | null;
    status: string;
    /** Start of the earliest live link to one of this owner's properties. */
    since: string | null;
    /** When the company record was created on NoLSAF, not incorporation date. */
    registeredAt: string | null;
    propertyCount: number;
    properties: string[];
  }[];
  merchantCount: number;
  /** Abandoned draft companies excluded from `merchants`: no name, no
   *  registration number, no TIN. Reported so the properties they hold are
   *  not silently unaccounted for. */
  hiddenDraftCount: number;
  hiddenDraftProperties: number;
  /** Travel agencies that sell this owner's rooms. */
  agents: {
    id: number;
    name: string | null;
    legalName: string | null;
    status: string;
    verificationStatus: string;
    since: string | null;
    propertyCount: number;
  }[];
  agentCount: number;
  activeAgentCount: number;
};

/** Whitespace-only strings are absent data, not content. */
function blankToNull(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : null;
}

/** Everyone this owner does business through: the companies that operate their
 *  properties, and the agencies that sell their rooms. Never throws. */
async function ownerPartners(ownerId: number): Promise<OwnerPartners> {
  const empty: OwnerPartners = {
    merchants: [], merchantCount: 0,
    hiddenDraftCount: 0, hiddenDraftProperties: 0,
    agents: [], agentCount: 0, activeAgentCount: 0,
  };

  try {
    const [merchantLinks, agentLinks] = await Promise.all([
      (prisma as any).merchantPropertyLink.findMany({
        where: { effectiveTo: null, property: { ownerId } },
        select: {
          effectiveFrom: true,
          property: { select: { title: true } },
          merchant: {
            select: {
              id: true, legalName: true, tradingName: true,
              registrationNumber: true, tin: true, country: true,
              status: true, createdAt: true,
            },
          },
        },
        orderBy: { effectiveFrom: "asc" },
      }),
      prisma.nrmsAgentPropertyLink.findMany({
        where: { property: { ownerId }, status: { notIn: ["TERMINATED", "REJECTED"] } },
        select: {
          status: true,
          activatedAt: true,
          createdAt: true,
          agentAccount: {
            select: {
              id: true, legalName: true, tradingName: true,
              status: true, verificationStatus: true,
            },
          },
        },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // One row per company, not per property link.
    const byMerchant = new Map<number, OwnerPartners["merchants"][number]>();
    for (const link of merchantLinks as any[]) {
      const m = link?.merchant;
      if (!m) continue;
      const existing = byMerchant.get(m.id);
      const since = link.effectiveFrom ? new Date(link.effectiveFrom).toISOString() : null;
      if (existing) {
        existing.propertyCount += 1;
        if (link.property?.title) existing.properties.push(link.property.title);
        if (since && (!existing.since || since < existing.since)) existing.since = since;
        continue;
      }
      // A draft application can exist before the company is named, so these
      // come back as null rather than as an empty string the UI would render
      // as a blank heading.
      byMerchant.set(m.id, {
        id: m.id,
        name: blankToNull(m.tradingName) ?? blankToNull(m.legalName),
        legalName: blankToNull(m.legalName),
        registrationNumber: blankToNull(m.registrationNumber),
        tin: blankToNull(m.tin),
        country: blankToNull(m.country),
        status: m.status,
        since,
        registeredAt: m.createdAt ? new Date(m.createdAt).toISOString() : null,
        propertyCount: 1,
        properties: link.property?.title ? [link.property.title] : [],
      });
    }

    // One row per agency, across however many of the owner's properties it sells.
    const byAgent = new Map<number, OwnerPartners["agents"][number]>();
    for (const link of agentLinks as any[]) {
      const a = link?.agentAccount;
      if (!a) continue;
      const since = link.activatedAt ? new Date(link.activatedAt).toISOString() : null;
      const existing = byAgent.get(a.id);
      if (existing) {
        existing.propertyCount += 1;
        // An agency counts as active here if any one link is live.
        if (link.status === "ACTIVE") existing.status = "ACTIVE";
        if (since && (!existing.since || since < existing.since)) existing.since = since;
        continue;
      }
      byAgent.set(a.id, {
        id: a.id,
        name: blankToNull(a.tradingName) ?? blankToNull(a.legalName),
        legalName: blankToNull(a.legalName),
        status: link.status,
        verificationStatus: a.verificationStatus,
        since,
        propertyCount: 1,
      });
    }

    // An abandoned draft carries no identity at all: no trading name, no legal
    // name, no registration number, no TIN. Listing it adds a blank row that
    // tells an administrator nothing. It is counted rather than dropped, so the
    // properties it still holds are not silently unaccounted for.
    const allMerchants = [...byMerchant.values()];
    const isAbandonedDraft = (m: OwnerPartners["merchants"][number]) =>
      m.status === "DRAFT" && !m.name && !m.legalName && !m.registrationNumber && !m.tin;

    const merchants = allMerchants.filter(m => !isAbandonedDraft(m));
    const hidden = allMerchants.filter(isAbandonedDraft);
    const agents = [...byAgent.values()];

    return {
      merchants,
      merchantCount: merchants.length,
      hiddenDraftCount: hidden.length,
      hiddenDraftProperties: hidden.reduce((sum, m) => sum + m.propertyCount, 0),
      agents,
      agentCount: agents.length,
      activeAgentCount: agents.filter(a => a.status === "ACTIVE").length,
    };
  } catch (err: any) {
    console.warn("Failed to compute owner partners:", err?.message);
    return empty;
  }
}

/** GET /admin/owners/:id */
router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid owner id" });
    const owner = await prisma.user.findFirst({
      where: { id, role: "OWNER" },
      select: {
        id: true, name: true, email: true, phone: true,
        suspendedAt: true, kycStatus: true, createdAt: true,
        _count: { select: { properties: true } },
      },
    });
    if (!owner) return res.status(404).json({ error: "Owner not found" });

    const [money, invoices] = await Promise.all([
      prisma.invoice.aggregate({
        where: { ownerId: id, status: "PAID" },
        _sum: { netPayable: true, total: true, commissionAmount: true },
        _count: { _all: true },
      }),
      prisma.invoice.count({ where: { ownerId: id } }),
    ]);

    // Convert dates to ISO strings
    const ownerWithDates = {
      ...owner,
      createdAt: owner.createdAt ? new Date(owner.createdAt).toISOString() : new Date().toISOString(),
      suspendedAt: owner.suspendedAt ? new Date(owner.suspendedAt).toISOString() : null,
    };

    // Capability roll-ups: is NRMS switched on for this owner, and can they
    // actually take payment. Both carry the date it happened, so an admin can
    // see how long each has been live rather than only that it is.
    const capabilities = await ownerCapabilities(id);

    // NRMS PAYG billing across every property this owner runs. This is a
    // separate revenue stream from booking commission: the owner pays NoLSAF
    // directly for the tool, so the whole amount is NoLSAF revenue with no
    // partner split. Definitions match admin.financeOverview so the owner page
    // and the platform finance page never disagree.
    const nrmsBilling = await ownerNrmsBilling(id);

    // Who this owner does business through.
    const partners = await ownerPartners(id);

    return res.json({
      owner: ownerWithDates,
      capabilities,
      partners,
      snapshot: {
        invoicesCount: invoices,
        revenue: {
          netSum: Number(money._sum.netPayable ?? 0),
          grossSum: Number(money._sum.total ?? 0),
          commissionSum: Number(money._sum.commissionAmount ?? 0),
          paidCount: money._count._all,
        },
        nrmsBilling,
      },
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying owner by id:', err.message);
      return res.status(200).json({ owner: null, capabilities: null, partners: null, snapshot: { invoicesCount: 0, revenue: { netSum: 0, grossSum: 0, commissionSum: 0, paidCount: 0 }, nrmsBilling: null } });
    }
    console.error('Unhandled error in GET /admin/owners/:id', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/** POST /admin/owners/:id/suspend {reason} */
router.post("/:id/suspend", async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "");
  const me = (req.user as any).id;

  const updated = await prisma.user.update({
    where: { id },
    data: { suspendedAt: new Date() },
  });
  await prisma.adminAudit.create({
    data: { adminId: me, targetUserId: id, action: "SUSPEND_OWNER", details: reason },
  });
  await revokeUserAuthorization(id);

  req.app.get("io")?.emit?.("admin:owner:updated", { ownerId: id });
  res.json({ ok: true, ownerId: updated.id, suspendedAt: updated.suspendedAt });
});

/** POST /admin/owners/:id/unsuspend */
router.post("/:id/unsuspend", async (req, res) => {
  const id = Number(req.params.id);
  const me = (req.user as any).id;
  const updated = await prisma.user.update({
    where: { id },
    data: { suspendedAt: null },
  });
  await prisma.adminAudit.create({
    data: { adminId: me, targetUserId: id, action: "UNSUSPEND_OWNER" },
  });

  req.app.get("io")?.emit?.("admin:owner:updated", { ownerId: id });
  res.json({ ok: true, ownerId: updated.id });
});

/** POST /admin/owners/:id/kyc/approve {note?} */
router.post("/:id/kyc/approve", async (req, res) => {
  const id = Number(req.params.id);
  const me = (req.user as any).id;
  const note = String(req.body?.note ?? "");

  const updated = await prisma.user.update({
    where: { id },
    data: { kycStatus: "APPROVED_KYC" },
  });
  await prisma.adminAudit.create({
    data: { adminId: me, targetUserId: id, action: "KYC_APPROVE", details: note },
  });

  req.app.get("io")?.emit?.("admin:kyc:updated", { ownerId: id, status: "APPROVED_KYC" });
  res.json({ ok: true });
});

/** POST /admin/owners/:id/kyc/reject {reason} */
router.post("/:id/kyc/reject", async (req, res) => {
  const id = Number(req.params.id);
  const me = (req.user as any).id;
  const reason = String(req.body?.reason ?? "");

  const updated = await prisma.user.update({
    where: { id },
    data: { kycStatus: "REJECTED_KYC" },
  });
  await prisma.adminAudit.create({
    data: { adminId: me, targetUserId: id, action: "KYC_REJECT", details: reason },
  });

  req.app.get("io")?.emit?.("admin:kyc:updated", { ownerId: id, status: "REJECTED_KYC" });
  res.json({ ok: true });
});

/** GET /admin/owners/:id/statement?from=&to=
 *
 * Everything one owner did on the platform over a period, assembled into a
 * single document an administrator can print and file. Built for the case
 * where an owner disputes what they were paid: every money line carries the
 * reference an administrator can trace externally.
 *
 * Read-only. `from`/`to` are optional; omitting both gives the whole history.
 */
router.get("/:id/statement", async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Invalid owner id" });

    const owner = await prisma.user.findFirst({
      where: { id, role: "OWNER" },
      select: {
        id: true, name: true, email: true, phone: true,
        kycStatus: true, suspendedAt: true, createdAt: true,
      },
    });
    if (!owner) return res.status(404).json({ error: "Owner not found" });

    const { from, to } = req.query as Record<string, string | undefined>;
    const fromDate = from ? new Date(String(from)) : null;
    const toDate = to ? new Date(String(to)) : null;
    if (fromDate && Number.isNaN(fromDate.getTime())) return res.status(400).json({ error: "Invalid from date" });
    if (toDate && Number.isNaN(toDate.getTime())) return res.status(400).json({ error: "Invalid to date" });
    // An inclusive end date: "to 30 Sept" must include everything on the 30th.
    if (toDate) toDate.setHours(23, 59, 59, 999);

    const range = (field: string) => {
      if (!fromDate && !toDate) return {};
      const clause: any = {};
      if (fromDate) clause.gte = fromDate;
      if (toDate) clause.lte = toDate;
      return { [field]: clause };
    };

    const [properties, invoices, adminActions] = await Promise.all([
      prisma.property.findMany({
        where: { ownerId: id },
        select: {
          id: true, title: true, status: true, type: true,
          regionName: true, district: true, nrmsActivatedAt: true, createdAt: true,
        },
        orderBy: { id: "asc" },
      }),
      prisma.invoice.findMany({
        where: { ownerId: id, ...range("issuedAt") },
        select: {
          id: true, invoiceNumber: true, receiptNumber: true, status: true,
          total: true, commissionAmount: true, netPayable: true,
          issuedAt: true, paidAt: true, paymentMethod: true, paymentRef: true,
          booking: { select: { id: true, property: { select: { title: true } } } },
        },
        orderBy: { issuedAt: "desc" },
      }),
      prisma.adminAudit.findMany({
        where: { targetUserId: id, ...range("createdAt") },
        select: {
          id: true, action: true, details: true, createdAt: true,
          admin: { select: { id: true, name: true, email: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 500,
      }),
    ]);

    // Payouts reach an owner through Disbursement rows keyed to their invoices,
    // so scope by this owner's invoice ids rather than by any owner column.
    //
    // Deliberately keyed to EVERY invoice this owner has ever had, not just the
    // ones issued inside the period: a payout settled in September against an
    // invoice issued in March belongs in a September statement. Restricting to
    // period invoices would silently drop exactly the payouts an owner is most
    // likely to be disputing. The period is then applied to the payout's own
    // timeline instead.
    const ownedInvoiceIds = (await prisma.invoice.findMany({
      where: { ownerId: id },
      select: { id: true },
    })).map(row => row.id);

    const periodInvoiceIds = new Set(invoices.map(inv => inv.id));

    const payoutWhere: any = { sourceType: "OWNER_INVOICE", sourceId: { in: ownedInvoiceIds } };
    if (fromDate || toDate) {
      const clause: any = {};
      if (fromDate) clause.gte = fromDate;
      if (toDate) clause.lte = toDate;
      // Raised, settled, or failed inside the period, or attached to an invoice
      // the period already covers.
      payoutWhere.OR = [
        { createdAt: clause },
        { paidAt: clause },
        { failedAt: clause },
        { sourceId: { in: [...periodInvoiceIds] } },
      ];
    }

    const disbursements = ownedInvoiceIds.length
      ? await prisma.disbursement.findMany({
          where: payoutWhere,
          select: {
            id: true, sourceId: true, status: true, amount: true, currency: true,
            provider: true, bankName: true, operator: true,
            externalReferenceId: true, pgReferenceId: true, fspReferenceId: true,
            approvedAt: true, submittedAt: true, paidAt: true, failedAt: true, createdAt: true,
            // Why a payout is not where the owner expects it to be.
            providerMessage: true, remarks: true, securityReviewReason: true, riskLevel: true,
            batch: { select: { batchReference: true } },
            // Where the money was actually sent.
            payoutAccount: {
              select: { type: true, provider: true, accountName: true, accountNumber: true, isVerified: true },
            },
            // The provider's own trail, newest first, for "what happened to my money".
            events: {
              select: { eventType: true, status: true, message: true, createdAt: true },
              orderBy: { id: "desc" },
              take: 5,
            },
          },
          orderBy: { id: "desc" },
        })
      : [];

    const num = (v: any) => Number(v ?? 0);
    const iso = (d: any) => (d ? new Date(d).toISOString() : null);
    // Destination accounts are masked. The statement can be handed to someone,
    // and the last four digits are enough to confirm which account was paid.
    const maskAccount = (value: string | null | undefined) => {
      const text = String(value ?? "").trim();
      if (!text) return null;
      return text.length <= 4 ? `****${text}` : `****${text.slice(-4)}`;
    };

    // Totals are computed from the same rows the document lists, so the
    // summary and the line items can never disagree.
    const paidInvoices = invoices.filter(inv => inv.status === "PAID");
    const bookings = {
      invoiceCount: invoices.length,
      paidCount: paidInvoices.length,
      gross: paidInvoices.reduce((sum, inv) => sum + num(inv.total), 0),
      commission: paidInvoices.reduce((sum, inv) => sum + num(inv.commissionAmount), 0),
      net: paidInvoices.reduce((sum, inv) => sum + num(inv.netPayable), 0),
    };

    // The payout state machine has more outcomes than paid/failed. Lumping
    // recovery and security holds into "in progress" would tell a disputing
    // owner their money is on its way when it is actually being clawed back or
    // held for review.
    const paidOut = disbursements.filter(d => d.status === "PAID");
    const inRecovery = disbursements.filter(d => d.status === "RECOVERY_PENDING" || d.status === "RECOVERED");
    const onHold = disbursements.filter(d => d.status === "SECURITY_REVIEW");
    const failed = disbursements.filter(d => d.status === "FAILED");
    const settledOrTerminal = new Set(["PAID", "FAILED", "RECOVERY_PENDING", "RECOVERED", "SECURITY_REVIEW"]);

    const payouts = {
      count: disbursements.length,
      paidCount: paidOut.length,
      paidAmount: paidOut.reduce((sum, d) => sum + num(d.amount), 0),
      inFlightCount: disbursements.filter(d => !settledOrTerminal.has(d.status)).length,
      inFlightAmount: disbursements
        .filter(d => !settledOrTerminal.has(d.status))
        .reduce((sum, d) => sum + num(d.amount), 0),
      failedCount: failed.length,
      failedAmount: failed.reduce((sum, d) => sum + num(d.amount), 0),
      recoveryCount: inRecovery.length,
      recoveryAmount: inRecovery.reduce((sum, d) => sum + num(d.amount), 0),
      securityHoldCount: onHold.length,
      securityHoldAmount: onHold.reduce((sum, d) => sum + num(d.amount), 0),
    };

    const capabilities = await ownerCapabilities(id);
    const partners = await ownerPartners(id);
    // NRMS billing is lifetime, not period-scoped: statements close on their
    // own cycle and slicing them by date would misrepresent the balance.
    const nrmsBilling = await ownerNrmsBilling(id);

    // The session carries only id/role/email, so name the generating admin
    // from the database. A statement that cannot say who produced it is not
    // worth filing.
    const adminId = (req.user as any)?.id ?? null;
    const generatedByUser = adminId
      ? await prisma.user.findUnique({
          where: { id: adminId },
          select: { id: true, name: true, email: true },
        }).catch(() => null)
      : null;

    const generatedAt = new Date();

    return res.json({
      generatedAt: generatedAt.toISOString(),
      generatedBy: {
        id: generatedByUser?.id ?? adminId,
        name: generatedByUser?.name ?? null,
        email: generatedByUser?.email ?? (req.user as any)?.email ?? null,
      },
      // `period` is what the administrator asked for; either end may be open.
      // `coverage` is the window the document actually spans, with the open
      // ends resolved, so a reference can encode real dates rather than "ALL".
      period: { from: iso(fromDate), to: iso(toDate) },
      coverage: {
        from: iso(fromDate ?? owner.createdAt),
        to: iso(toDate ?? generatedAt),
      },
      owner: {
        ...owner,
        createdAt: iso(owner.createdAt),
        suspendedAt: iso(owner.suspendedAt),
      },
      capabilities,
      partners,
      properties: properties.map(p => ({
        ...p,
        nrmsActivatedAt: iso(p.nrmsActivatedAt),
        createdAt: iso(p.createdAt),
      })),
      bookings,
      invoices: invoices.map(inv => ({
        id: inv.id,
        invoiceNumber: inv.invoiceNumber,
        receiptNumber: inv.receiptNumber,
        status: inv.status,
        total: num(inv.total),
        commissionAmount: num(inv.commissionAmount),
        netPayable: num(inv.netPayable),
        issuedAt: iso(inv.issuedAt),
        paidAt: iso(inv.paidAt),
        paymentMethod: inv.paymentMethod,
        paymentRef: inv.paymentRef,
        bookingId: inv.booking?.id ?? null,
        propertyTitle: inv.booking?.property?.title ?? null,
      })),
      payouts,
      disbursements: disbursements.map(d => ({
        id: d.id,
        invoiceId: d.sourceId,
        status: d.status,
        amount: num(d.amount),
        currency: d.currency,
        provider: d.provider,
        bankName: d.bankName,
        operator: d.operator,
        externalReferenceId: d.externalReferenceId,
        pgReferenceId: d.pgReferenceId,
        fspReferenceId: d.fspReferenceId,
        batchReference: d.batch?.batchReference ?? null,
        raisedAt: iso(d.createdAt),
        approvedAt: iso(d.approvedAt),
        submittedAt: iso(d.submittedAt),
        paidAt: iso(d.paidAt),
        failedAt: iso(d.failedAt),
        riskLevel: d.riskLevel,
        // The single most useful line when an owner says the money never came.
        reason: d.providerMessage || d.securityReviewReason || d.remarks || null,
        destination: d.payoutAccount
          ? {
              type: d.payoutAccount.type,
              provider: d.payoutAccount.provider,
              accountName: d.payoutAccount.accountName,
              accountNumberMasked: maskAccount(d.payoutAccount.accountNumber),
              isVerified: d.payoutAccount.isVerified,
            }
          : null,
        events: (d.events ?? []).map(e => ({
          eventType: e.eventType,
          status: e.status,
          message: e.message,
          at: iso(e.createdAt),
        })),
      })),
      nrmsBilling,
      adminActions: adminActions.map(a => ({
        id: a.id,
        action: a.action,
        details: a.details ?? null,
        createdAt: iso(a.createdAt),
        adminName: a.admin?.name ?? a.admin?.email ?? null,
      })),
    });
  } catch (err: any) {
    console.error("Error in GET /admin/owners/:id/statement:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/** GET /admin/owners/:id/documents */
router.get("/:id/documents", async (req, res) => {
  const id = Number(req.params.id);
  const docs = await prisma.userDocument.findMany({
    where: { userId: id },
    orderBy: { id: "desc" },
  });
  res.json({ items: docs.map((doc: any) => sanitizeUserDocument(doc, "OWNER")) });
});

/** POST /admin/owners/:id/documents/:docId/approve */
router.post("/:id/documents/:docId/approve", async (req, res) => {
  const id = Number(req.params.id);
  const docId = Number(req.params.docId);
  const me = (req.user as any).id;
  
  const doc = await prisma.userDocument.findUnique({ where: { id: docId } });
  if (!doc || Number((doc as any).userId) !== id) return res.status(404).json({ error: "Document not found" });
  
  await prisma.userDocument.update({
    where: { id: docId },
    data: { status: "APPROVED" },
  });
  
  await prisma.adminAudit.create({
    data: {
      adminId: me,
      targetUserId: id,
      action: "DOCUMENT_APPROVE",
      details: JSON.stringify({ documentId: docId, documentType: doc.type || "Unknown" }),
    },
  });
  
  req.app.get("io")?.emit?.("admin:kyc:updated", { ownerId: id });
  res.json({ ok: true });
});

/** POST /admin/owners/:id/documents/:docId/reject {reason} */
router.post("/:id/documents/:docId/reject", async (req, res) => {
  const id = Number(req.params.id);
  const docId = Number(req.params.docId);
  const reason = String(req.body?.reason ?? "");
  const me = (req.user as any).id;
  
  const doc = await prisma.userDocument.findUnique({ where: { id: docId } });
  if (!doc || Number((doc as any).userId) !== id) return res.status(404).json({ error: "Document not found" });
  
  await prisma.userDocument.update({
    where: { id: docId },
    data: { status: "REJECTED", reason },
  });
  
  await prisma.adminAudit.create({
    data: {
      adminId: me,
      targetUserId: id,
      action: "DOCUMENT_REJECT",
      details: JSON.stringify({ documentId: docId, documentType: doc.type || "Unknown", reason }),
    },
  });
  
  req.app.get("io")?.emit?.("admin:kyc:updated", { ownerId: id });
  res.json({ ok: true });
});

/** POST /admin/owners/:id/impersonate {reason} -> short-lived owner JWT */
router.post("/:id/impersonate", async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason ?? "");
  
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: "Reason is required for impersonation" });
  }

  const owner = await prisma.user.findUnique({ where: { id } });
  if (!owner || owner.role !== "OWNER") {
    return res.status(404).json({ error: "Owner not found" });
  }

  const ttlSec = 10 * 60; // 10 minutes
  const token = await signUserJwt(
    { id: owner.id, role: "OWNER", email: owner.email },
    { impersonated: true, expiresInSeconds: ttlSec },
  );
  
  await prisma.adminAudit.create({
    data: { 
      adminId: (req.user as any).id, 
      targetUserId: id, 
      action: "IMPERSONATE_ISSUE",
      details: reason.trim()
    },
  });
  
  res.json({ token, expiresIn: ttlSec });
});

/** POST /admin/owners/:id/notes {text} */
router.post("/:id/notes", async (req, res) => {
  const id = Number(req.params.id);
  const text = String(req.body?.text ?? "");
  const me = (req.user as any).id;
  
  if (!text.trim()) return res.status(400).json({ error: "Note required" });
  
  const note = await prisma.adminNote.create({
    data: { ownerId: id, adminId: me, text },
  });
  
  await prisma.adminAudit.create({
    data: {
      adminId: me,
      targetUserId: id,
      action: "ADD_NOTE",
      details: `Note added: ${text.substring(0, 100)}${text.length > 100 ? '...' : ''}`,
    },
  });
  
  res.json({ ok: true, note });
});

/** POST /admin/owners/:id/notify {subject, message} - Send notification to owner */
router.post("/:id/notify", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { subject, message } = req.body as { subject?: string; message?: string };
    
    if (!subject || !subject.trim()) {
      return res.status(400).json({ error: "Subject is required" });
    }
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "Message is required" });
    }

    const owner = await prisma.user.findUnique({ where: { id } });
    if (!owner || owner.role !== "OWNER") {
      return res.status(404).json({ error: "Owner not found" });
    }

    // Create admin audit log
    await prisma.adminAudit.create({
      data: {
        adminId: (req.user as any).id,
        targetUserId: id,
        action: "NOTIFY_OWNER",
        details: `Subject: ${subject.trim()}\nMessage: ${message.trim()}`,
      },
    });

    // Emit socket event for real-time notification (if owner is online)
    req.app.get("io")?.emit?.("admin:owner:notification", {
      ownerId: id,
      subject: subject.trim(),
      message: message.trim(),
      adminId: (req.user as any).id,
    });

    // TODO: In the future, you can add email/SMS sending here
    // For now, we just log it and emit a socket event

    res.json({ ok: true, message: "Notification sent successfully" });
  } catch (err: any) {
    console.error("Error sending notification:", err);
    res.status(500).json({ error: "Failed to send notification" });
  }
});

/** POST /admin/owners/:id/payouts/preview - Preview payout calculation */
router.post("/:id/payouts/preview", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const owner = await prisma.user.findFirst({
      where: { id, role: "OWNER" },
    });
    if (!owner) return res.status(404).json({ error: "Owner not found" });

    // Get pending invoices for this owner
    const invoices = await prisma.invoice.findMany({
      where: {
        ownerId: id,
        status: { in: ["SUBMITTED", "VERIFIED", "APPROVED"] },
      },
      include: {
        booking: {
          select: { id: true },
        },
      },
    });

    // Calculate totals
    const gross = invoices.reduce((sum, inv) => sum + Number(inv.total || 0), 0);
    const commissionPercent = 10; // Default commission, could come from system settings
    const taxPercent = 18; // Default tax, could come from system settings
    const commissionAmount = (gross * commissionPercent) / 100;
    const taxAmount = (commissionAmount * taxPercent) / 100;
    const net = gross - commissionAmount - taxAmount;

    const rows = invoices.map((inv) => ({
      bookingId: inv.bookingId,
      amount: Number(inv.total || 0),
    }));

    res.json({
      gross,
      commissionPercent,
      taxPercent,
      net,
      rows,
    });
  } catch (err: any) {
    console.error("Error in POST /admin/owners/:id/payouts/preview:", err);
    res.status(500).json({ error: "Internal server error", detail: err?.message || String(err) });
  }
});

// The manual "grant payout" action (POST /:id/payouts) that used to mark
// invoices PAID directly has been retired. Owner invoices are now paid
// exclusively through the AzamPay Disbursement ledger — see
// services/payouts/ledger.ts and routes/admin.disbursements.ts. The write-
// back in ledger.ts sets Invoice.status = "PAID" once AzamPay confirms.

export default router;
