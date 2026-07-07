import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { audit } from "../lib/audit.js";
import { resolveTierLadder, defaultTierLadderConfig, validateTierLadder } from "../lib/agentLevel.js";

/** Convert a resolved tier-spec list back to the editable {TIER:{thresholds}} config. */
function tierLadderToConfig(raw: unknown) {
  const tiers = resolveTierLadder(raw);
  const out: Record<string, { minTours: number; minRevenue: number; minRating: number; minReviews: number }> = {};
  for (const t of tiers) {
    if (t.level === "BRONZE") continue;
    out[t.level] = { minTours: t.minTours, minRevenue: t.minRevenue, minRating: t.minRating, minReviews: t.minReviews };
  }
  return out;
}

export const router = Router();
router.use(requireAuth, requireRole("ADMIN"));

let roleTtlColumnsAvailable: boolean | null = null;
async function hasRoleTtlColumns(): Promise<boolean> {
  if (roleTtlColumnsAvailable !== null) return roleTtlColumnsAvailable;
  try {
    await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { sessionMaxMinutesAdmin: true, sessionMaxMinutesAgent: true } as any,
    });
    roleTtlColumnsAvailable = true;
    return true;
  } catch (err: any) {
    if (err?.code === "P2022" || String(err?.message || "").includes("ColumnNotFound")) {
      roleTtlColumnsAvailable = false;
      return false;
    }
    throw err;
  }
}

let currencyColumnAvailable: boolean | null = null;
async function hasCurrencyColumn(): Promise<boolean> {
  if (currencyColumnAvailable !== null) return currencyColumnAvailable;
  try {
    await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { currency: true } as any,
    });
    currencyColumnAvailable = true;
    return true;
  } catch (err: any) {
    // If DB isn't migrated yet (or schema/client drift), don't crash the API.
    if (
      err?.code === "P2022" ||
      String(err?.message || "").includes("ColumnNotFound") ||
      String(err?.message || "").includes("Unknown field")
    ) {
      currencyColumnAvailable = false;
      return false;
    }
    throw err;
  }
}

let supportColumnsAvailable: boolean | null = null;
async function hasSupportColumns(): Promise<boolean> {
  if (supportColumnsAvailable !== null) return supportColumnsAvailable;
  try {
    await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { supportEmail: true } as any,
    });
    supportColumnsAvailable = true;
    return true;
  } catch (err: any) {
    if (
      err?.code === "P2022" ||
      String(err?.message || "").includes("ColumnNotFound") ||
      String(err?.message || "").includes("Unknown field")
    ) {
      supportColumnsAvailable = false;
      return false;
    }
    throw err;
  }
}

let tierLadderColumnAvailable: boolean | null = null;
async function hasTierLadderColumn(): Promise<boolean> {
  // Only cache the POSITIVE result. Caching a negative for the process lifetime
  // means a column added mid-run (e.g. migration applied after boot) is never
  // picked up until restart — which silently breaks the settings save path.
  if (tierLadderColumnAvailable === true) return true;
  try {
    await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: { agentTierLadder: true } as any,
    });
    tierLadderColumnAvailable = true;
    return true;
  } catch (err: any) {
    if (
      err?.code === "P2022" ||
      String(err?.message || "").includes("ColumnNotFound") ||
      String(err?.message || "").includes("Unknown field")
    ) {
      return false; // not cached — re-check next time
    }
    throw err;
  }
}

/** GET current settings */
router.get("/", async (_req, res) => {
  const roleCols = await hasRoleTtlColumns();
  const currencyCol = await hasCurrencyColumn();
  const supportCols = await hasSupportColumns();
  const tierCol = await hasTierLadderColumn();
  const s =
    (await prisma.systemSetting.findUnique({
      where: { id: 1 },
      select: {
        commissionPercent: true,
        commissionCurrency: true,
        driverCommissionPercent: true,
        driverCommissionCurrency: true,
        agentCommissionPercent: true,
        agentCommissionCurrency: true,
        ...(tierCol ? { agentTierLadder: true } : {}),
        // Driver level + referral business config (baseline columns — always present).
        referralCreditPercent: true,
        driverLevelGoldThreshold: true,
        driverLevelDiamondThreshold: true,
        taxPercent: true,
        ...(currencyCol ? { currency: true } : {}),
        invoicePrefix: true,
        receiptPrefix: true,
        emailEnabled: true,
        smsEnabled: true,
        requireAdmin2FA: true,
        minPasswordLength: true,
        requirePasswordUppercase: true,
        requirePasswordLowercase: true,
        requirePasswordNumber: true,
        requirePasswordSpecial: true,
        sessionIdleMinutes: true,
        maxSessionDurationHours: true,
        forceLogoutOnPasswordChange: true,
        ipAllowlist: true,
        enableIpAllowlist: true,
        apiRateLimitPerMinute: true,
        maxLoginAttempts: true,
        accountLockoutDurationMinutes: true,
        enableSecurityAuditLogging: true,
        logFailedLoginAttempts: true,
        alertOnSuspiciousActivity: true,
        ...(supportCols ? { supportEmail: true, supportPhone: true } : {}),
        ...(roleCols
          ? {
              sessionMaxMinutesAdmin: true,
              sessionMaxMinutesOwner: true,
              sessionMaxMinutesDriver: true,
              sessionMaxMinutesCustomer: true,
              sessionMaxMinutesAgent: true,
            }
          : {}),
      } as any,
    })) ??
    (await prisma.systemSetting.create({ data: { id: 1 } }));

  // If DB is missing role TTL columns, ensure the response still includes them (as null) for UI consistency.
  const out: any = { ...s };
  if (!roleCols) {
    out.sessionMaxMinutesAdmin = null;
    out.sessionMaxMinutesOwner = null;
    out.sessionMaxMinutesDriver = null;
    out.sessionMaxMinutesCustomer = null;
    out.sessionMaxMinutesAgent = null;
  }
  if (!currencyCol) {
    // Keep UI stable even if DB isn't migrated yet.
    out.currency = out.currency ?? "TZS";
  }
  if (!supportCols) {
    out.supportEmail = out.supportEmail ?? null;
    out.supportPhone = out.supportPhone ?? null;
  }
  // Ensure new commission fields always appear in the response with safe defaults.
  out.driverCommissionPercent = out.driverCommissionPercent ?? 10;
  out.agentCommissionPercent = out.agentCommissionPercent ?? 15;
  out.commissionCurrency = out.commissionCurrency ?? "TZS";
  out.driverCommissionCurrency = out.driverCommissionCurrency ?? "TZS";
  out.agentCommissionCurrency = out.agentCommissionCurrency ?? "USD";
  // Driver level + referral business config defaults (match lib/business-config.ts).
  out.driverLevelGoldThreshold = out.driverLevelGoldThreshold ?? 500000;
  out.driverLevelDiamondThreshold = out.driverLevelDiamondThreshold ?? 2000000;
  out.referralCreditPercent = out.referralCreditPercent != null ? Number(out.referralCreditPercent) : 0.0035;
  // Operator tier ladder: return the effective (defaults merged with overrides)
  // editable config plus the pristine defaults for a "reset" affordance.
  out.agentTierLadder = tierLadderToConfig(tierCol ? (out as any).agentTierLadder : null);
  out.agentTierLadderDefaults = defaultTierLadderConfig();
  res.json(mask(out));
});

/** Recent session policy changes (AuditLog) */
router.get("/audit/session-policy", async (_req, res) => {
  const rows = await prisma.auditLog.findMany({
    where: {
      action: { in: ["ADMIN_SESSION_POLICY_UPDATE", "ADMIN_SETTINGS_UPDATE"] },
      entity: "settings:system",
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    include: {
      actor: { select: { id: true, email: true, name: true, role: true } },
    },
  });

  res.json(
    rows.map((r) => ({
      id: String(r.id),
      actorId: r.actorId ?? null,
      actorRole: r.actorRole ?? null,
      actor: r.actor ? { id: r.actor.id, email: r.actor.email, name: (r.actor as any).name, role: (r.actor as any).role } : null,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId ?? null,
      ip: r.ip ?? null,
      ua: r.ua ?? null,
      createdAt: r.createdAt,
      changes: (r.afterJson as any)?.changes ?? null,
    }))
  );
});

/** PUT update settings */
router.put("/", async (req, res) => {
  const roleCols = await hasRoleTtlColumns();
  const currencyCol = await hasCurrencyColumn();
  const supportCols = await hasSupportColumns();
  const tierCol = await hasTierLadderColumn();
  // Fetch full record so the audit diff covers ALL changed fields, not just session ones.
  const before = await prisma.systemSetting.findUnique({ where: { id: 1 } });

  // Server-side validation/sanitization for security/session fields.
  const body = (req.body ?? {}) as Record<string, unknown>;
  const MIN_SESSION_MINUTES = 5; // prevent accidental 1-minute TTL
  const MAX_SESSION_MINUTES_HARD = 60 * 24 * 7; // 7 days hard ceiling

  const toIntOrNull = (v: unknown): number | null | undefined => {
    if (v === undefined) return undefined;
    if (v === null) return null;
    if (typeof v === 'string' && v.trim() === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return NaN as any;
    return Math.trunc(n);
  };

  // Determine the max cap in minutes (maxSessionDurationHours * 60).
  const nextMaxHours = toIntOrNull(body.maxSessionDurationHours);
  if (nextMaxHours !== undefined && nextMaxHours !== null && (!Number.isFinite(nextMaxHours) || nextMaxHours < 1 || nextMaxHours > 24 * 30)) {
    return res.status(400).json({
      error: 'INVALID_MAX_SESSION_DURATION_HOURS',
      message: 'maxSessionDurationHours must be an integer between 1 and 720 (30 days).',
    });
  }
  const effectiveMaxHours = (nextMaxHours ?? before?.maxSessionDurationHours ?? 24) as number;
  const capMinutes = Math.min(Math.max(1, effectiveMaxHours * 60), MAX_SESSION_MINUTES_HARD);

  const sessionKeys = ([
    'sessionIdleMinutes',
    ...(roleCols
      ? ([
          'sessionMaxMinutesAdmin',
          'sessionMaxMinutesOwner',
          'sessionMaxMinutesDriver',
          'sessionMaxMinutesCustomer',
          'sessionMaxMinutesAgent',
        ] as const)
      : ([] as const)),
  ] as const);

  const sanitizedUpdate: Record<string, unknown> = { ...body };
  const errors: Array<{ field: string; message: string }> = [];

  // `agentTierLadderDefaults` is a read-only echo — never persist it.
  delete (sanitizedUpdate as any).agentTierLadderDefaults;

  // Operator tier ladder: validate (thresholds non-negative + monotonic across tiers).
  if (body.agentTierLadder !== undefined) {
    if (!tierCol) {
      delete (sanitizedUpdate as any).agentTierLadder; // column not migrated yet — ignore
    } else {
      const result = validateTierLadder(body.agentTierLadder);
      if (!result.ok) {
        return res.status(400).json({
          error: "INVALID_TIER_LADDER",
          message: "One or more operator tier thresholds are invalid.",
          details: result.errors,
        });
      }
      sanitizedUpdate.agentTierLadder = result.ladder as any;
    }
  }

  // Driver level thresholds + referral credit (business config). These are
  // baseline columns, so no migration/feature-flag guard is needed — an admin can
  // tune driver Gold/Diamond badges and referral payouts at runtime.
  const driverGold = toIntOrNull(body.driverLevelGoldThreshold);
  const driverDiamond = toIntOrNull(body.driverLevelDiamondThreshold);
  if (driverGold !== undefined) {
    if (driverGold !== null && (!Number.isFinite(driverGold) || driverGold < 0)) {
      errors.push({ field: "driverLevelGoldThreshold", message: "Must be a non-negative amount (TZS)." });
    } else {
      sanitizedUpdate.driverLevelGoldThreshold = driverGold;
    }
  }
  if (driverDiamond !== undefined) {
    if (driverDiamond !== null && (!Number.isFinite(driverDiamond) || driverDiamond < 0)) {
      errors.push({ field: "driverLevelDiamondThreshold", message: "Must be a non-negative amount (TZS)." });
    } else {
      sanitizedUpdate.driverLevelDiamondThreshold = driverDiamond;
    }
  }
  // Diamond must sit above Gold (use effective values: incoming or existing).
  const effGold = (driverGold ?? before?.driverLevelGoldThreshold ?? 0) as number;
  const effDiamond = (driverDiamond ?? before?.driverLevelDiamondThreshold ?? 0) as number;
  if (Number.isFinite(effGold) && Number.isFinite(effDiamond) && effDiamond < effGold) {
    errors.push({ field: "driverLevelDiamondThreshold", message: "Diamond threshold must be ≥ Gold threshold." });
  }
  // referralCreditPercent is stored as a decimal fraction (0.0035 = 0.35%).
  if (body.referralCreditPercent !== undefined && body.referralCreditPercent !== null && body.referralCreditPercent !== "") {
    const rc = Number(body.referralCreditPercent);
    if (!Number.isFinite(rc) || rc < 0 || rc > 1) {
      errors.push({ field: "referralCreditPercent", message: "Must be a decimal fraction between 0 and 1 (e.g. 0.0035 for 0.35%)." });
    } else {
      sanitizedUpdate.referralCreditPercent = rc;
    }
  }

  for (const k of sessionKeys) {
    const raw = body[k];
    const parsed = toIntOrNull(raw);
    if (parsed === undefined) continue; // not provided

    if (parsed !== null) {
      if (!Number.isFinite(parsed)) {
        errors.push({ field: k, message: 'Must be an integer number of minutes (or blank to use default).' });
        continue;
      }
      if (parsed < MIN_SESSION_MINUTES) {
        errors.push({ field: k, message: `Must be at least ${MIN_SESSION_MINUTES} minutes.` });
        continue;
      }
      if (parsed > capMinutes) {
        errors.push({ field: k, message: `Must be <= ${capMinutes} minutes (maxSessionDurationHours cap).` });
        continue;
      }
    }

    sanitizedUpdate[k] = parsed;
  }

  // If admin updates maxSessionDurationHours, ensure it doesn't invalidate existing/per-role TTLs.
  if (nextMaxHours !== undefined) {
    const nextCapMinutes = Math.min(Math.max(1, effectiveMaxHours * 60), MAX_SESSION_MINUTES_HARD);
    const wouldExceed = (field: string, value: unknown) => {
      const parsed = toIntOrNull(value);
      return parsed !== undefined && parsed !== null && Number.isFinite(parsed) && parsed > nextCapMinutes;
    };

    for (const k of sessionKeys) {
      if (wouldExceed(k, sanitizedUpdate[k])) {
        errors.push({ field: k, message: `Must be <= ${nextCapMinutes} minutes after maxSessionDurationHours change.` });
      }
    }
  }

  if (errors.length) {
    return res.status(400).json({
      error: 'INVALID_SETTINGS',
      message: 'One or more settings values are invalid.',
      details: errors,
    });
  }

  // If the DB isn't migrated yet, drop per-role TTL keys so the update doesn't fail.
  if (!roleCols) {
    delete (sanitizedUpdate as any).sessionMaxMinutesAdmin;
    delete (sanitizedUpdate as any).sessionMaxMinutesOwner;
    delete (sanitizedUpdate as any).sessionMaxMinutesDriver;
    delete (sanitizedUpdate as any).sessionMaxMinutesCustomer;
    delete (sanitizedUpdate as any).sessionMaxMinutesAgent;
  }

  // If the DB isn't migrated yet, drop currency so the update doesn't fail.
  if (!currencyCol) {
    delete (sanitizedUpdate as any).currency;
  }

  if (!supportCols) {
    delete (sanitizedUpdate as any).supportEmail;
    delete (sanitizedUpdate as any).supportPhone;
  }

  const s = await prisma.systemSetting.upsert({
    where: { id: 1 },
    update: sanitizedUpdate,
    create: { id: 1, ...sanitizedUpdate },
  });

  // Audit with an explicit diff over every field that was submitted.
  const changes: Record<string, { from: any; to: any }> = {};
  for (const f of Object.keys(sanitizedUpdate)) {
    const from = (before as any)?.[f];
    const to = (s as any)?.[f];
    // Use loose comparison so null vs undefined doesn't create noise.
    // eslint-disable-next-line eqeqeq
    if (from != to) changes[f] = { from: from ?? null, to: to ?? null };
  }
  const sessionPolicyFields = new Set(['sessionIdleMinutes', 'maxSessionDurationHours', 'sessionMaxMinutesAdmin', 'sessionMaxMinutesOwner', 'sessionMaxMinutesDriver', 'sessionMaxMinutesCustomer', 'sessionMaxMinutesAgent']);
  const touchedSessionPolicy = Object.keys(changes).some((k) => sessionPolicyFields.has(k));
  const action = touchedSessionPolicy ? 'ADMIN_SESSION_POLICY_UPDATE' : 'ADMIN_SETTINGS_UPDATE';

  // Write audit directly so errors surface instead of being swallowed silently.
  try {
    const actorId: number | null = (req as any).user?.id ?? null;
    const actorRole: string | null = (req as any).user?.role ?? null;
    const ip = (req.headers["x-forwarded-for"]?.toString()?.split(",")[0]?.trim() || req.socket?.remoteAddress || "").slice(0, 64);
    const ua = (req.headers["user-agent"] || "").slice(0, 255);
    const auditRow = await prisma.auditLog.create({
      data: {
        actorId,
        actorRole,
        action,
        entity: "settings:system",
        ip,
        ua,
        beforeJson: null,
        afterJson: { changes } as any,
      } as any,
    });
  } catch (auditErr: any) {
    console.error("[admin.settings] Audit write failed:", auditErr?.message ?? auditErr);
  }

  res.json(mask(s));
});

/** Numbering preview */
router.post("/numbering/preview", async (req, res) => {
  const { type } = req.body ?? {}; // "invoice"|"receipt"
  const s = await prisma.systemSetting.findUnique({ where: { id: 1 } }) ?? { invoicePrefix: "INV-", invoiceSeq: 1, receiptPrefix: "RCT-", receiptSeq: 1 } as any;
  const y = new Date().getFullYear();
  const m = String(new Date().getMonth() + 1).padStart(2, "0");
  const seq = type === "receipt" ? s.receiptSeq : s.invoiceSeq;
  const prefix = type === "receipt" ? s.receiptPrefix : s.invoicePrefix;
  const sample = `${prefix}${y}${m}-${String(seq).padStart(6, "0")}`;
  res.json({ sample });
});

/** Users & roles (list, change role, enable/disable) */
router.get("/users", async (req, res) => {
  try {
    // MySQL doesn't support `mode: "insensitive"`; rely on default CI collations.
    const q = (req.query.q as string | undefined)?.trim().slice(0, 120);
    const where: any = q ? {
      OR: [
        { email: { contains: q } },
        { name: { contains: q } }
      ] 
    } : {};
    const users = await prisma.user.findMany({ 
      where, 
      orderBy: { id: "desc" }, 
      take: 100,
      select: { id: true, email: true, name: true, role: true, twoFactorEnabled: true }
    });
    res.json(users.map((u: any) => ({ 
      id: u.id, 
      email: u.email, 
      fullName: u.name || u.email, // Map name to fullName for frontend compatibility
      role: u.role, 
      twoFactorEnabled: u.twoFactorEnabled 
    })));
  } catch (err: any) {
    console.error('Error in GET /admin/settings/users:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

router.post("/users/:id/role", async (req, res) => {
  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ error: "Invalid user id" });

  // Only allow non-privileged role changes via settings. ADMIN promotion
  // must go through the dedicated /admin/users/:id/promote-admin endpoint
  // which requires { confirm: true } and emits notifications + full audit.
  const ALLOWED_ROLES = ["OWNER", "CUSTOMER", "DRIVER"] as const;
  const role = String(req.body?.role ?? "").trim().toUpperCase();
  if (!ALLOWED_ROLES.includes(role as any)) {
    return res.status(403).json({
      error: "role_not_allowed",
      message: "Setting role to ADMIN via this endpoint is not permitted. Use POST /admin/users/:id/promote-admin instead.",
      allowed: ALLOWED_ROLES,
    });
  }

  const before = await prisma.user.findUnique({ where: { id }, select: { role: true } });
  if (!before) return res.status(404).json({ error: "User not found" });

  const u = await prisma.user.update({ where: { id }, data: { role: role as any } });
  await audit(req as any, "ADMIN_USER_ROLE_CHANGE", `user:${id}`, before, { role });
  res.json({ ok: true });
});

/** Security toggles (subset handled by main PUT) */

/** Mask secrets/toggles before returning to UI */
function mask(s: any) {
  return s; // no raw credentials stored here yet; when you add provider secrets, remove them here
}

export default router;
