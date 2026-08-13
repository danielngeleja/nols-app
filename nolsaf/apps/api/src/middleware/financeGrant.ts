// apps/api/src/middleware/financeGrant.ts
import type { Request, Response, NextFunction } from "express";
import { hasFinanceGrant } from "../lib/financeGrantStore.js";

function configuredApproverIds(): Set<number> {
  return new Set(String(process.env.NRMS_FINANCE_APPROVER_IDS || "").split(",").map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value > 0));
}

export function hasNrmsFinanceRole(req: Request, minimum: "OPERATOR" | "APPROVER" = "OPERATOR"): boolean {
  const role = String((req.user as any)?.nrmsFinanceRole || "NONE").toUpperCase();
  if (minimum === "APPROVER" && configuredApproverIds().has(Number((req.user as any)?.id))) return true;
  return minimum === "APPROVER" ? role === "APPROVER" : ["OPERATOR", "APPROVER"].includes(role) || configuredApproverIds().has(Number((req.user as any)?.id));
}

declare global {
  namespace Express {
    interface User {
      id: any;
      role?: string;
    }
    interface Request {
      user?: User;
      session?: any;
    }
  }
}

// Use for endpoints that must return UNMASKED numbers
export function requireNrmsFinanceRole(minimum: "OPERATOR" | "APPROVER" = "OPERATOR") {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
    if (!hasNrmsFinanceRole(req, minimum)) return res.status(403).json({ error: "NRMS finance permission required", requiredRole: minimum });
    return next();
  };
}

export const requireNrmsFinanceApprover = requireNrmsFinanceRole("APPROVER");

export async function requireFinanceGrant(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
  if (!hasNrmsFinanceRole(req)) {
    return res.status(403).json({ error: "NRMS finance permission required", requiredRole: "OPERATOR" });
  }
  if (!(await hasFinanceGrant(req))) {
    return res.status(403).json({ error: "OTP required", require2fa: true });
  }
  return next();
}

/**
 * General admin finance re-authentication. Sales attribution activation,
 * revocation and reassignment affect future earnings but are not NRMS-only
 * operations, so they must not inherit the separate NRMS operator role gate.
 */
export async function requireAdminFinanceGrant(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role !== "ADMIN") return res.status(403).json({ error: "Admin only" });
  if (!(await hasFinanceGrant(req))) {
    return res.status(403).json({ error: "OTP required", require2fa: true });
  }
  return next();
}

export { hasFinanceGrant } from "../lib/financeGrantStore.js";
