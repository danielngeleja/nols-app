// Owner-activated TRA fiscal receipting: identity, credentials, activation.
// See docs/NRMS_FISCAL_RECEIPTS.md.
//
// NoLSAF is not the taxpayer and is not an approved VFD supplier. Each property
// registers with TRA under its own TIN and VRN, obtains its own credentials and
// signing certificate, and enters them here. Every endpoint in this file is
// therefore about holding someone else's tax credentials safely, which is why
// nothing in it ever returns a secret and why activation cannot happen without a
// recorded acknowledgement that the property, not NoLSAF, is responsible.

import { Router, type RequestHandler, type Response } from "express";
import { z } from "zod";
import { prisma } from "@nolsaf/prisma";
import { type AuthedRequest, blockImpersonated, requireAuth } from "../middleware/auth.js";
import { auditOrThrow } from "../lib/audit.js";
import { encrypt } from "../lib/crypto.js";
import { canIssueOnRequest, enqueueFiscalReceipt, fiscalErrorMessage, fiscalSourceKey, resolveFiscalSource } from "../lib/nrmsFiscal.js";
import { loadNrmsPropertyAccess, type NrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { nextShiftDayKey, shiftDateOnly, shiftDayKey } from "../lib/nrmsShifts.js";

export const router = Router();
router.use(requireAuth as RequestHandler);
// Tax credentials are in the same class as payout details: a support session
// impersonating an owner must never be able to stage, rotate or revoke them.
router.use(blockImpersonated as RequestHandler);

const db = prisma as any;

/** Only the owner or a manager touches a property's tax registration. */
async function loadFiscalAccess(req: AuthedRequest, res: Response, propertyId: number): Promise<NrmsPropertyAccess | null> {
  return loadNrmsPropertyAccess(req, res, propertyId, ["OWNER", "MANAGER"]);
}

function requireFiscalOwner(access: NrmsPropertyAccess, res: Response): boolean {
  if (access.role === "OWNER") return true;
  res.status(403).json({ error: "Only the property owner can change taxpayer identity, credentials or activation", code: "FISCAL_OWNER_REQUIRED" });
  return false;
}

/** The acknowledgement text an owner accepts. Bump when the wording changes. */
export const FISCAL_ACKNOWLEDGEMENT_VERSION = "2026-08-28";

const identitySchema = z.object({
  tin: z.string().trim().min(6).max(20),
  vrn: z.string().trim().min(4).max(20),
  businessName: z.string().trim().min(2).max(180),
  taxOffice: z.string().trim().max(120).optional().nullable(),
});

const credentialSchema = z.object({
  username: z.string().trim().min(1).max(120),
  password: z.string().min(1).max(200),
  /** PKCS12 bundle, base64. Every TRA document is signed with its private key. */
  certificate: z.string().min(1),
  certificatePassphrase: z.string().max(200).optional().nullable(),
});

const activateSchema = z.object({
  mode: z.enum(["ON_REQUEST", "ALWAYS"]),
  acknowledge: z.literal(true),
});

/**
 * Never returns a secret. Mirrors the channel credential rule: the owner can see
 * that a credential exists, which version is live, whether it validated and when
 * it expires, and nothing else.
 */
function presentConnection(connection: any) {
  if (!connection) {
    return { enabled: false, mode: "OFF", status: "DISABLED", identity: null, credential: null, health: null, acknowledgement: null };
  }
  const active = (connection.credentialVersions ?? []).find((version: any) => version.status === "ACTIVE") ?? null;
  const staged = (connection.credentialVersions ?? []).find((version: any) => version.status === "STAGED") ?? null;
  return {
    enabled: connection.mode !== "OFF",
    mode: connection.mode,
    status: connection.status,
    regime: connection.regime,
    canIssueOnRequest: canIssueOnRequest(connection),
    identity: {
      tin: connection.tin,
      vrn: connection.vrn,
      businessName: connection.businessName,
      taxOffice: connection.taxOffice,
      regId: connection.regId,
      serialNumber: connection.serialNumber,
    },
    credential: active
      ? { version: active.version, validationStatus: active.validationStatus, validatedAt: active.validatedAt, expiresAt: active.expiresAt, activatedAt: active.activatedAt }
      : null,
    staged: staged ? { version: staged.version, validationStatus: staged.validationStatus, validationError: fiscalErrorMessage(staged.validationError), expiresAt: staged.expiresAt } : null,
    activatesOnBusinessDate: connection.activatesOnBusinessDate,
    deactivatesOnBusinessDate: connection.deactivatesOnBusinessDate,
    health: {
      lastSuccessAt: connection.lastSuccessAt,
      lastErrorAt: connection.lastErrorAt,
      lastError: fiscalErrorMessage(connection.lastError),
      escalatedAt: connection.escalatedAt,
      pending: connection.pending ?? 0,
      failed: connection.failed ?? 0,
      deadLettered: connection.deadLettered ?? 0,
    },
    acknowledgement: connection.acknowledgedAt
      ? { acceptedAt: connection.acknowledgedAt, version: connection.acknowledgementVersion }
      : null,
  };
}

const connectionInclude = { credentialVersions: { where: { status: { in: ["ACTIVE", "STAGED"] } }, orderBy: { version: "desc" } } };

async function loadConnection(propertyId: number) {
  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, include: connectionInclude });
  if (!connection) return null;
  // Counts drive the health strip and the escalation banner. Cheap: the
  // (connectionId, status, nextAttemptAt) index covers all three.
  const [pending, failed, deadLettered] = await Promise.all([
    db.nrmsFiscalReceipt.count({ where: { connectionId: connection.id, status: "PENDING" } }),
    db.nrmsFiscalReceipt.count({ where: { connectionId: connection.id, status: "FAILED" } }),
    db.nrmsFiscalReceipt.count({ where: { connectionId: connection.id, status: "DEAD_LETTER" } }),
  ]);
  return { ...connection, pending, failed, deadLettered };
}

/** GET /property/:id — current state. Safe for a property that has never enabled it. */
router.get("/property/:id", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  const connection = await loadConnection(propertyId);
  res.json({ fiscal: presentConnection(connection) });
}) as RequestHandler);

/**
 * PUT /property/:id/identity — the taxpayer's own TIN, VRN and registered name.
 *
 * Editable while the connection is not live. Changing the TIN of a property that
 * is already issuing receipts would silently move a numbered series onto a
 * different taxpayer, so that is refused.
 */
router.put("/property/:id/identity", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  if (!requireFiscalOwner(access, res)) return;
  const parsed = identitySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the TIN, VRN and registered business name exactly as TRA holds them" });

  const existing = await db.nrmsFiscalConnection.findUnique({
    where: { propertyId },
    select: { id: true, propertyId: true, status: true, tin: true, vrn: true, businessName: true, taxOffice: true, globalCounter: true },
  });
  const identityChanged = existing && (existing.tin !== parsed.data.tin || existing.vrn !== parsed.data.vrn);
  if (identityChanged && Number(existing.globalCounter ?? 0) > 0) {
    return res.status(409).json({
      error: "The TIN and VRN are locked because this registration already owns fiscal receipt numbers. Create a controlled new registration instead.",
      code: "FISCAL_IDENTITY_LOCKED",
    });
  }

  const data = { ...parsed.data, taxOffice: parsed.data.taxOffice || null };
  const connection = await db.$transaction(async (tx: any) => {
    const changed = existing
      ? await tx.nrmsFiscalConnection.update({ where: { id: existing.id }, data })
      : await tx.nrmsFiscalConnection.create({ data: { propertyId, ...data, mode: "OFF", status: "DISABLED" } });
    await auditOrThrow(tx, req, "NRMS_FISCAL_IDENTITY_SAVED", "PROPERTY", existing ? {
      tin: existing.tin, vrn: existing.vrn, businessName: existing.businessName, taxOffice: existing.taxOffice,
    } : null, data, propertyId);
    return changed;
  });

  res.json({ fiscal: presentConnection(await loadConnection(connection.propertyId ?? propertyId)) });
}) as RequestHandler);

/**
 * POST /property/:id/credentials — stage a new credential version.
 *
 * Staged, never live on arrival. Same two-step as channel credentials: the owner
 * enters them, a validation call proves they work, and only then do they take
 * over from whatever is currently active.
 */
router.post("/property/:id/credentials", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  if (!requireFiscalOwner(access, res)) return;
  const parsed = credentialSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Enter the username, password and certificate TRA issued for this business" });

  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, select: { id: true, mode: true, status: true } });
  if (!connection) return res.status(409).json({ error: "Enter the TRA registration details first", code: "FISCAL_IDENTITY_MISSING" });

  // One encrypted blob, one decrypt at use. The certificate is a credential, not
  // a setting, so it lives in here rather than in a column of its own.
  const payload = JSON.stringify({
    username: parsed.data.username,
    password: parsed.data.password,
    certificate: parsed.data.certificate,
    certificatePassphrase: parsed.data.certificatePassphrase || null,
  });

  await db.$transaction(async (tx: any) => {
    // Lock the connection while allocating a credential version. This prevents
    // two simultaneous rotations choosing the same version number.
    await tx.nrmsFiscalConnection.update({ where: { id: connection.id }, data: { updatedAt: new Date() } });
    const latest = await tx.nrmsFiscalCredentialVersion.findFirst({ where: { connectionId: connection.id }, orderBy: { version: "desc" }, select: { version: true } });
    const version = Number(latest?.version ?? 0) + 1;
    await tx.nrmsFiscalCredentialVersion.updateMany({
      where: { connectionId: connection.id, status: "STAGED" },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    await tx.nrmsFiscalCredentialVersion.create({
      data: {
        connectionId: connection.id,
        version,
        status: "STAGED",
        encryptedData: encrypt(payload),
        // Never trust a browser-supplied expiry. Validation must derive this
        // from the signed PKCS12 certificate before activation is possible.
        expiresAt: null,
        createdById: req.user!.id,
      },
    });
    // Rotation must not take a working connection offline. PENDING describes
    // only an initial, currently-OFF setup.
    if (connection.mode === "OFF" && connection.status !== "SUSPENDED") {
      await tx.nrmsFiscalConnection.update({ where: { id: connection.id }, data: { status: "PENDING" } });
    }
    await auditOrThrow(tx, req, "NRMS_FISCAL_CREDENTIAL_STAGED", "PROPERTY", null, { connectionId: connection.id, version }, propertyId);
  });

  res.status(201).json({ fiscal: presentConnection(await loadConnection(propertyId)) });
}) as RequestHandler);

/**
 * POST /property/:id/credentials/validate — prove the staged credentials work.
 *
 * The adapter is not built yet (it waits on TRA's own specification), so this
 * currently records a truthful failure rather than pretending to have verified
 * anything. It must never mark a credential VALIDATED without a real response.
 */
router.post("/property/:id/credentials/validate", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  if (!requireFiscalOwner(access, res)) return;
  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, select: { id: true } });
  if (!connection) return res.status(404).json({ error: "This property has no TRA registration on file" });
  const staged = await db.nrmsFiscalCredentialVersion.findFirst({ where: { connectionId: connection.id, status: "STAGED" }, orderBy: { version: "desc" } });
  if (!staged) return res.status(409).json({ error: "There are no new credentials waiting to be checked", code: "FISCAL_NO_STAGED_CREDENTIAL" });

  await db.$transaction(async (tx: any) => {
    await tx.nrmsFiscalCredentialVersion.update({
      where: { id: staged.id },
      data: {
        validationStatus: "FAILED",
        validatedAt: new Date(),
        validationError: "FISCAL_ADAPTER_UNAVAILABLE",
        expiresAt: null,
      },
    });
    await auditOrThrow(tx, req, "NRMS_FISCAL_CREDENTIAL_VALIDATION_FAILED", "PROPERTY", null, {
      connectionId: connection.id, version: staged.version, errorCode: "FISCAL_ADAPTER_UNAVAILABLE",
    }, propertyId);
  });
  res.status(503).json({
    error: "TRA checking is not switched on yet. Your details are saved and encrypted, and we will verify them as soon as it is.",
    code: "FISCAL_ADAPTER_UNAVAILABLE",
    fiscal: presentConnection(await loadConnection(propertyId)),
  });
}) as RequestHandler);

/**
 * POST /property/:id/activate — switch fiscal receipting on.
 *
 * Takes effect at the next business day, never mid-day: a fiscal series has a
 * daily close, and flipping this at 15:00 would end the day half fiscalised.
 * Requires a validated credential and a recorded acknowledgement.
 */
router.post("/property/:id/activate", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  if (!requireFiscalOwner(access, res)) return;
  const parsed = activateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Choose when receipts are issued and confirm that this business is the registered taxpayer", code: "FISCAL_ACKNOWLEDGEMENT_REQUIRED" });
  }

  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, include: connectionInclude });
  if (!connection) return res.status(409).json({ error: "Enter the TRA registration details first", code: "FISCAL_IDENTITY_MISSING" });
  if (connection.status === "SUSPENDED") {
    return res.status(409).json({ error: "This connection is suspended. Contact NoLSAF support.", code: "FISCAL_SUSPENDED" });
  }

  const usable = (connection.credentialVersions ?? []).find((version: any) =>
    ["STAGED", "ACTIVE"].includes(version.status) && version.validationStatus === "VALIDATED",
  );
  if (!usable) {
    return res.status(409).json({ error: "Your TRA details have not been verified yet, so receipts cannot be switched on.", code: "FISCAL_CREDENTIAL_UNVERIFIED" });
  }
  if (!usable.expiresAt) {
    return res.status(409).json({ error: "The signing certificate expiry has not been verified from the certificate.", code: "FISCAL_CERTIFICATE_EXPIRY_UNVERIFIED" });
  }
  if (new Date(usable.expiresAt) <= new Date()) {
    return res.status(409).json({ error: "The verified signing certificate has expired. Stage and validate a replacement before activation.", code: "FISCAL_CERTIFICATE_EXPIRED" });
  }

  // Tomorrow in Tanzanian time, so the switch lands on a boundary the property
  // recognises rather than on a UTC midnight in the middle of its evening.
  const activatesOn = nextShiftDayKey(shiftDayKey(new Date()));
  const wasLive = ["ACTIVE", "FAILED"].includes(connection.status) && connection.mode !== "OFF";
  const needsBoundary = !wasLive || connection.mode !== parsed.data.mode;
  await db.$transaction(async (tx: any) => {
    if (usable.status === "STAGED") {
      await tx.nrmsFiscalCredentialVersion.updateMany({
        where: { connectionId: connection.id, status: "ACTIVE", id: { not: usable.id } },
        data: { status: "REVOKED", revokedAt: new Date() },
      });
      await tx.nrmsFiscalCredentialVersion.update({
        where: { id: usable.id },
        data: { status: "ACTIVE", activatedAt: new Date(), validationError: null },
      });
    }
    await tx.nrmsFiscalConnection.update({
      where: { id: connection.id },
      data: {
        pendingMode: needsBoundary ? parsed.data.mode : null,
        status: wasLive ? connection.status : "VALIDATED",
        activatesOnBusinessDate: needsBoundary ? shiftDateOnly(activatesOn) : null,
        deactivatesOnBusinessDate: null,
        acknowledgedAt: new Date(),
        acknowledgedById: req.user!.id,
        acknowledgementVersion: FISCAL_ACKNOWLEDGEMENT_VERSION,
      },
    });
    await auditOrThrow(tx, req, usable.status === "STAGED" ? "NRMS_FISCAL_CREDENTIAL_ACTIVATED" : "NRMS_FISCAL_ACTIVATION_SCHEDULED", "PROPERTY", {
      mode: connection.mode, status: connection.status,
    }, { mode: needsBoundary ? parsed.data.mode : connection.mode, credentialVersion: usable.version, activatesOnBusinessDate: needsBoundary ? activatesOn : null }, propertyId);
  });

  res.json({ activatesOnBusinessDate: needsBoundary ? activatesOn : null, fiscal: presentConnection(await loadConnection(propertyId)) });
}) as RequestHandler);

/**
 * POST /property/:id/deactivate — switch it off at the close of the current day.
 *
 * Symmetric with activation and equally not retroactive, so the day in progress
 * still closes complete rather than half fiscalised.
 */
router.post("/property/:id/deactivate", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  if (!requireFiscalOwner(access, res)) return;
  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, select: { id: true, mode: true } });
  if (!connection) return res.status(404).json({ error: "This property has no TRA registration on file" });
  if (connection.mode === "OFF") return res.status(409).json({ error: "Fiscal receipting is already off", code: "FISCAL_ALREADY_OFF" });

  const today = shiftDayKey(new Date());
  await db.$transaction(async (tx: any) => {
    await tx.nrmsFiscalConnection.update({
      where: { id: connection.id },
      data: { deactivatesOnBusinessDate: shiftDateOnly(today), activatesOnBusinessDate: null, pendingMode: null },
    });
    await auditOrThrow(tx, req, "NRMS_FISCAL_DEACTIVATION_SCHEDULED", "PROPERTY", { mode: connection.mode }, { deactivatesOnBusinessDate: today }, propertyId);
  });
  res.json({ deactivatesOnBusinessDate: today, fiscal: presentConnection(await loadConnection(propertyId)) });
}) as RequestHandler);

/**
 * POST /property/:id/credentials/revoke — kill the active credential now.
 *
 * Unlike deactivation this is immediate and takes the connection down with it,
 * because the reason to revoke is that the credential is compromised. Receipts
 * already queued stay queued; they simply cannot be delivered until a new
 * credential is staged and validated.
 */
router.post("/property/:id/credentials/revoke", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  if (!requireFiscalOwner(access, res)) return;

  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, select: { id: true, status: true, mode: true } });
  if (!connection) return res.status(404).json({ error: "This property has no TRA registration on file" });

  const revoked = await db.$transaction(async (tx: any) => {
    const changed = await tx.nrmsFiscalCredentialVersion.updateMany({
      where: { connectionId: connection.id, status: { in: ["ACTIVE", "STAGED"] } },
      data: { status: "REVOKED", revokedAt: new Date() },
    });
    // Releasing SENDING claims fences any in-flight worker: its confirmation
    // compare-and-set can no longer commit after the credential is revoked.
    await tx.nrmsFiscalReceipt.updateMany({
      where: { connectionId: connection.id, status: "SENDING" },
      data: { status: "PENDING", deliveryLeaseToken: null, deliveryLeaseExpiresAt: null, nextAttemptAt: new Date(), lastError: "FISCAL_DELIVERY_INTERRUPTED" },
    });
    await tx.nrmsFiscalConnection.update({
      where: { id: connection.id },
      data: { mode: "OFF", pendingMode: null, status: "DISABLED", suspendedFromStatus: null, activatesOnBusinessDate: null, deactivatesOnBusinessDate: null },
    });
    await auditOrThrow(tx, req, "NRMS_FISCAL_CREDENTIALS_REVOKED", "PROPERTY", {
      status: connection.status, mode: connection.mode,
    }, { connectionId: connection.id, revokedVersions: changed.count, status: "DISABLED", mode: "OFF" }, propertyId);
    return changed;
  });
  res.json({ revoked: revoked.count, fiscal: presentConnection(await loadConnection(propertyId)) });
}) as RequestHandler);

/**
 * GET /property/:id/receipts — what has been filed, and what could still be.
 *
 * Two lists because they answer two different questions an owner actually has:
 * "did my receipts go through" and "this guest is standing here asking for one".
 */
router.get("/property/:id/receipts", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;

  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, select: { id: true, mode: true, status: true } });
  if (!connection) return res.json({ receipts: [], issuable: [], canIssue: false });

  const receipts = await db.nrmsFiscalReceipt.findMany({
    where: { propertyId },
    orderBy: { globalCounter: "desc" },
    take: 25,
    select: {
      id: true, kind: true, status: true, receiptNumber: true, sourceType: true, sourceId: true,
      grossAmount: true, currency: true, saleOccurredAt: true, issuedAt: true,
      fiscalReceiptNumber: true, verificationCode: true, verificationUrl: true, lastError: true, attemptCount: true,
    },
  });

  // Sales from the last fortnight with no document yet. In ON_REQUEST this is
  // the working list; in ALWAYS anything sitting here is a problem worth seeing.
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const [orders, payments, masterPayments, existing] = await Promise.all([
    db.nrmsOutletOrder.findMany({
      where: { propertyId, settlementMode: "OUTLET_PAYMENT", status: "SETTLED", settledAt: { gte: since } },
      select: { id: true, orderNumber: true, customerLabel: true, total: true, currency: true, settledAt: true },
      orderBy: { settledAt: "desc" }, take: 25,
    }),
    db.externalPaymentRecord.findMany({
      where: { voidedAt: null, createdAt: { gte: since }, reservation: { propertyId } },
      select: { id: true, amount: true, currency: true, createdAt: true, method: true, reservation: { select: { receiptNumber: true } } },
      orderBy: { createdAt: "desc" }, take: 25,
    }),
    db.nrmsMasterFolioPayment.findMany({
      where: { voidedAt: null, createdAt: { gte: since }, masterFolio: { propertyId } },
      select: { id: true, amount: true, currency: true, createdAt: true, masterFolio: { select: { billToName: true } } },
      orderBy: { createdAt: "desc" }, take: 25,
    }),
    db.nrmsFiscalReceipt.findMany({ where: { propertyId, kind: "RECEIPT", saleOccurredAt: { gte: since } }, select: { sourceKey: true } }),
  ]);
  const filed = new Set(existing.map((row: any) => row.sourceKey));

  const issuable = [
    ...orders.map((order: any) => ({
      sourceType: "OUTLET_SALE", sourceId: order.id, amount: Number(order.total), currency: order.currency, occurredAt: order.settledAt,
      label: `${order.orderNumber}${order.customerLabel ? ` · ${order.customerLabel}` : ""}`,
    })),
    ...payments.map((payment: any) => ({
      sourceType: "FOLIO_PAYMENT", sourceId: payment.id, amount: Number(payment.amount), currency: payment.currency, occurredAt: payment.createdAt,
      label: `${payment.reservation?.receiptNumber || "Reservation"} · ${String(payment.method).replace(/_/g, " ").toLowerCase()}`,
    })),
    ...masterPayments.map((payment: any) => ({
      sourceType: "MASTER_FOLIO_PAYMENT", sourceId: payment.id, amount: Number(payment.amount), currency: payment.currency, occurredAt: payment.createdAt,
      label: payment.masterFolio?.billToName || "Agency payment",
    })),
  ]
    .filter((row) => !filed.has(fiscalSourceKey(row.sourceType, propertyId, row.sourceId)))
    .sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime())
    .slice(0, 25);

  res.json({
    receipts: receipts.map((receipt: any) => ({ ...receipt, lastError: fiscalErrorMessage(receipt.lastError) })),
    issuable,
    canIssue: canIssueOnRequest(connection),
  });
}) as RequestHandler);

const issueSchema = z.object({
  sourceType: z.enum(["OUTLET_SALE", "FOLIO_PAYMENT", "MASTER_FOLIO_PAYMENT"]),
  sourceId: z.number().int().positive(),
});

/**
 * POST /property/:id/issue — a guest asked for a receipt.
 *
 * The whole point of ON_REQUEST, and also the answer to a guest returning days
 * later for a company receipt. The document carries the date the money actually
 * moved as well as the date it was issued, so an already closed business day is
 * never touched.
 */
router.post("/property/:id/issue", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;
  const parsed = issueSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose the sale this receipt is for" });

  const connection = await db.nrmsFiscalConnection.findUnique({ where: { propertyId }, select: { id: true, mode: true, status: true } });
  if (!canIssueOnRequest(connection)) {
    return res.status(409).json({ error: "Fiscal receipts are not switched on for this property", code: "FISCAL_NOT_ACTIVE" });
  }

  const source = await resolveFiscalSource(db, propertyId, parsed.data.sourceType, parsed.data.sourceId);
  if (!source) return res.status(404).json({ error: "That sale could not be found, or it was voided" });

  const created = await db.$transaction(async (tx: any) => {
    const receipt = await enqueueFiscalReceipt(tx, {
      propertyId,
      connectionId: connection.id,
      sourceType: parsed.data.sourceType,
      sourceId: parsed.data.sourceId,
      saleOccurredAt: source.saleOccurredAt,
      currency: source.currency,
      grossAmount: source.grossAmount,
    });
    if (receipt) {
      await auditOrThrow(tx, req, "NRMS_FISCAL_RECEIPT_QUEUED", "PROPERTY", null, {
        receiptId: receipt.id, sourceType: parsed.data.sourceType, sourceId: parsed.data.sourceId,
      }, propertyId);
    }
    return receipt;
  });
  if (!created) return res.status(409).json({ error: "This sale already has a fiscal receipt", code: "FISCAL_ALREADY_ISSUED" });

  res.status(201).json({ receiptId: created.id });
}) as RequestHandler);

/**
 * POST /receipts/:receiptId/retry — push a stuck document back into the queue.
 *
 * Clears the backoff rather than resending inline: delivery stays the worker's
 * job and stays strictly in counter order. A dead letter is revivable this way,
 * which is the point of having a human able to press it after fixing whatever
 * TRA was objecting to.
 */
router.post("/property/:id/receipts/:receiptId/retry", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.id);
  const access = await loadFiscalAccess(req, res, propertyId);
  if (!access) return;

  const receipt = await db.nrmsFiscalReceipt.findFirst({
    where: { id: Number(req.params.receiptId), propertyId, status: { in: ["FAILED", "DEAD_LETTER"] } },
    select: { id: true },
  });
  if (!receipt) return res.status(404).json({ error: "That receipt is not waiting to be retried" });

  await db.$transaction(async (tx: any) => {
    await tx.nrmsFiscalReceipt.update({
      where: { id: receipt.id },
      // attemptCount is reset so the backoff table starts again from one minute
      // rather than leaving a revived dead letter waiting six hours.
      data: {
        status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), lastError: null,
        deliveryLeaseToken: null, deliveryLeaseExpiresAt: null,
      },
    });
    await auditOrThrow(tx, req, "NRMS_FISCAL_RECEIPT_RETRY_REQUESTED", "PROPERTY", null, { receiptId: receipt.id }, propertyId);
  });
  res.json({ ok: true });
}) as RequestHandler);

export default router;
