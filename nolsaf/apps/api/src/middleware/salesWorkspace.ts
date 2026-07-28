// apps/api/src/middleware/salesWorkspace.ts
//
// Entitlement gate for the Sales Partner Workspace.
//
// A sales partner is an ordinary NoLSAF user. There is no SALES role and
// User.role is never changed to grant access: the entitlement lives in
// UserWorkspaceAccess and is checked here, on the server, on every request.
// A workspace value supplied by the client is never trusted on its own.
//
// See docs/SALES_PARTNER_WORKSPACE.md sections 4 and 11.
import type { Response, NextFunction, RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import type { AuthedRequest } from "./auth.js";
import {
  CONTRACT_EARNING_STATUSES,
  isContractEarning,
  type ContractStatus,
  type WorkspaceType,
} from "../lib/salesPartner.js";

const db = prisma as any;

/** Resolved sales context, attached to the request once the gate passes. */
export interface SalesPartnerContext {
  partnerId: number;
  agentCode: string;
  status: string;
  level: string;
  region: string | null;
  /** The contract governing access and rates right now, if there is one. */
  contract: {
    id: number;
    status: string;
    startsAt: Date;
    expiresAt: Date;
    nrmsCommissionRate: number;
    marketplaceRevenueRate: number;
  } | null;
}

export interface SalesAuthedRequest extends AuthedRequest {
  salesPartner?: SalesPartnerContext;
}

/**
 * Load a user's sales partner profile together with the contract that governs
 * it. The contract chosen is the one currently in an earning status, so access
 * checks and commission accrual can never disagree about which contract is
 * live.
 */
export async function loadSalesPartnerContext(userId: number): Promise<SalesPartnerContext | null> {
  const profile = await db.salesPartnerProfile.findUnique({
    where: { userId },
    select: {
      id: true,
      agentCode: true,
      status: true,
      level: true,
      region: true,
      contracts: {
        where: { status: { in: CONTRACT_EARNING_STATUSES as unknown as ContractStatus[] } },
        orderBy: { expiresAt: "desc" },
        take: 1,
        select: {
          id: true,
          status: true,
          startsAt: true,
          expiresAt: true,
          nrmsCommissionRate: true,
          marketplaceRevenueRate: true,
        },
      },
    },
  });

  if (!profile) return null;

  const contract = profile.contracts?.[0] || null;
  return {
    partnerId: profile.id,
    agentCode: profile.agentCode,
    status: profile.status,
    level: profile.level,
    region: profile.region ?? null,
    contract: contract
      ? {
          id: contract.id,
          status: contract.status,
          startsAt: contract.startsAt,
          expiresAt: contract.expiresAt,
          nrmsCommissionRate: Number(contract.nrmsCommissionRate),
          marketplaceRevenueRate: Number(contract.marketplaceRevenueRate),
        }
      : null,
  };
}

/**
 * True when the user holds an ACTIVE, unexpired entitlement to `workspace`.
 * Cheap enough to call on every request: it reads one indexed row.
 */
export async function hasWorkspaceAccess(userId: number, workspace: WorkspaceType): Promise<boolean> {
  if (workspace === "NORMAL") return true;

  const access = await db.userWorkspaceAccess.findUnique({
    where: { userId_workspace: { userId, workspace } },
    select: { status: true, expiresAt: true },
  });

  if (!access) return false;
  if (String(access.status).toUpperCase() !== "ACTIVE") return false;
  // expiresAt mirrors the contract expiry as a fast path. The contract itself
  // is still re-read by requireActivePartnerContract before any money moves.
  if (access.expiresAt && access.expiresAt.getTime() <= Date.now()) return false;
  return true;
}

/** Every workspace the user may currently enter, for the selector screen. */
export async function listWorkspaces(userId: number, _role: string): Promise<WorkspaceType[]> {
  const workspaces: WorkspaceType[] = ["NORMAL"];
  // Discovery lists only workspaces genuinely attached to this account.
  // Admin authorization remains available on server routes, but an admin with
  // no partner profile must not be offered a broken personal Sales workspace.
  if (await hasWorkspaceAccess(userId, "SALES")) {
    workspaces.push("SALES");
  }
  return workspaces;
}

/**
 * Gate a route on holding a workspace entitlement. Must run after requireAuth.
 *
 * Admins pass without an entitlement row so they can administer and test the
 * workspace, but they get no salesPartner context unless they genuinely have a
 * profile, which keeps partner-scoped queries from silently returning
 * everything.
 */
export function requireWorkspaceAccess(workspace: WorkspaceType): RequestHandler {
  return (async (req: SalesAuthedRequest, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user?.id) return res.status(401).json({ error: "Authentication required" });

    const isAdmin = String(user.role).toUpperCase() === "ADMIN";
    if (!isAdmin && !(await hasWorkspaceAccess(user.id, workspace))) {
      return res.status(403).json({ error: "Sales workspace access required", workspace });
    }

    const context = await loadSalesPartnerContext(user.id);
    if (context) req.salesPartner = context;
    if (!isAdmin && !context) {
      return res.status(403).json({ error: "Sales partner profile not found" });
    }

    return next();
  }) as RequestHandler;
}

/**
 * Gate a route on a live contract. Apply to everything that reads earnings or
 * moves money, so an expired or terminated partner cannot accrue, view or
 * withdraw. Admins are exempt because they administer other people's records.
 */
export const requireActivePartnerContract: RequestHandler = ((
  req: SalesAuthedRequest,
  res: Response,
  next: NextFunction,
) => {
  if (String(req.user?.role).toUpperCase() === "ADMIN") return next();

  const contract = req.salesPartner?.contract;
  if (!isContractEarning(contract)) {
    return res.status(403).json({
      error: "An active sales partner contract is required",
      code: "CONTRACT_NOT_ACTIVE",
    });
  }
  return next();
}) as RequestHandler;

/**
 * Resolve the partner id a request may act on. Always derived from the session,
 * never from a route or query parameter, which is what stops one partner from
 * reading another partner's portfolio.
 */
export function partnerIdFor(req: SalesAuthedRequest): number | null {
  return req.salesPartner?.partnerId ?? null;
}
