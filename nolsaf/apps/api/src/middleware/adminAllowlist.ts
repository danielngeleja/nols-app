import { Request, Response, NextFunction } from "express";
import { prisma } from "@nolsaf/prisma";
import ipaddr from "ipaddr.js";
import { raiseSecurityAlert } from "../lib/securityAlerts.js";

const CACHE_TTL_MS = 30_000;
let cachedList: string[] | null = null;
let cachedEnabled = false;
let cachedAtMs = 0;

// Helper: get client IP
// Use req.ip (respects Express `trust proxy` setting — strips spoofed leading
// X-Forwarded-For entries) rather than reading the header directly.
function getIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "";
}

function normalizeIp(value: string): string {
  try {
    const addr = ipaddr.parse(value);
    if (addr.kind() === "ipv6" && (addr as any).isIPv4MappedAddress && (addr as any).isIPv4MappedAddress()) {
      return (addr as any).toIPv4Address().toString();
    }
    return addr.toString();
  } catch {
    return value;
  }
}

function cidrContains(cidrStr: string, ip: string): boolean {
  try {
    const [range, prefix] = ipaddr.parseCIDR(String(cidrStr || "").trim());
    const parsedIp = ipaddr.parse(ip);

    if (parsedIp.kind() === range.kind()) {
      return parsedIp.match(range, prefix);
    }

    if (parsedIp.kind() === "ipv6" && (parsedIp as any).isIPv4MappedAddress && (parsedIp as any).isIPv4MappedAddress() && range.kind() === "ipv4") {
      return (parsedIp as any).toIPv4Address().match(range as any, prefix);
    }

    if (parsedIp.kind() === "ipv4" && range.kind() === "ipv6" && (range as any).isIPv4MappedAddress && (range as any).isIPv4MappedAddress()) {
      return parsedIp.match((range as any).toIPv4Address(), prefix);
    }

    return false;
  } catch {
    return false;
  }
}

export async function adminAllowlist(req: Request, res: Response, next: NextFunction) {
  try {
    const now = Date.now();
    if (cachedList && now - cachedAtMs < CACHE_TTL_MS) {
      // Use cached allowlist
      if (!cachedEnabled || cachedList.length === 0) return next();
      const list = cachedList;

      const ip = getIp(req);
      if (!ip) return res.status(403).json({ error: "IP blocked" });

      // Normalize IPv6/IPv4
      const normalized = normalizeIp(ip);
      const ok: boolean = list.some((cidrStr: string): boolean => cidrContains(cidrStr, normalized));

      if (!ok) {
        void raiseSecurityAlert("security_admin_ip_blocked", normalized, { ip: normalized, path: req.originalUrl });
        return res.status(403).json({ error: "IP not allowed" });
      }
      return next();
    }

    const s = await prisma.systemSetting.findUnique({ where: { id: 1 } });
    interface SystemSetting {
      id: number;
      ipAllowlist?: string | null;
      enableIpAllowlist?: boolean | null;
    }

    const list: string[] =
      ((s as SystemSetting | null)?.ipAllowlist
      // Entries may be separated by commas or new lines (the IP allowlist page
      // saves one per line); splitting on commas alone merged them into one
      // unparseable entry and locked every admin out.
      ?.split(/[s,]+/)
      .map((x: string) => x.trim())
      .filter((v: string) => v !== "")) || [];

    cachedList = list;
    cachedEnabled = Boolean((s as SystemSetting | null)?.enableIpAllowlist);
    cachedAtMs = now;
    if (!cachedEnabled || list.length === 0) return next(); // not configured/enabled

    const ip = getIp(req);
    if (!ip) return res.status(403).json({ error: "IP blocked" });

    // Normalize IPv6/IPv4
    const normalized = normalizeIp(ip);
    const ok: boolean = list.some((cidrStr: string): boolean => cidrContains(cidrStr, normalized));

    if (!ok) {
      void raiseSecurityAlert("security_admin_ip_blocked", normalized, { ip: normalized, path: req.originalUrl });
      return res.status(403).json({ error: "IP not allowed" });
    }
    next();
  } catch (err: any) {
    if (process.env.NODE_ENV !== "test") {
      const cause = err?.cause;
      console.error("[adminAllowlist] unavailable", {
        name: err?.name,
        code: err?.code,
        clientVersion: err?.clientVersion,
        message: String(err?.message || err || "unknown").slice(0, 500),
        cause: cause
          ? {
              code: cause?.code,
              state: cause?.state,
              message: String(cause?.message || cause || "unknown").slice(0, 500),
              cause: String(cause?.cause || "").slice(0, 300),
            }
          : undefined,
      });
    }
    // In production, fail-closed to preserve admin perimeter security.
    if (process.env.NODE_ENV === "production") {
      return res.status(503).json({ error: "Admin allowlist unavailable" });
    }
    // Non-production: fail-open to avoid blocking local/dev environments.
    return next();
  }
}
