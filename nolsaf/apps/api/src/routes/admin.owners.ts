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

    // Return flat structure matching frontend expectations
    return res.status(200).json({
      "": total,
      "ACTIVE": active,
      "SUSPENDED": suspended,
      "PENDING_KYC": pendingKYC,
      "APPROVED_KYC": approvedKYC,
      "REJECTED_KYC": rejectedKYC,
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
    const { q = "", status = "", page = "1", pageSize, limit, from, to, propertiesMin, propertiesMax } = req.query as any;
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
          
          // Merge data
          items = users.map(user => ({
            ...user,
            _propertyCount: countMap.get(user.id) || 0,
            _firstProperty: propertyMap.get(user.id) || null,
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

    // Transform and filter by property count
    let rows = owners.map((owner: any) => {
      const propCount = countMap.get(owner.id) || 0;
      return {
        id: owner.id,
        name: owner.name ?? "",
        email: owner.email ?? "",
        phone: owner.phone ?? "",
        propertiesCount: propCount,
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
      "id", "name", "email", "phone", "propertiesCount", "kycStatus", "accountStatus", "joinedAt", "suspendedAt"
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

    const [props, money, invoices] = await Promise.all([
      prisma.property.findMany({
        where: { ownerId: id },
        select: { id: true, title: true, status: true, type: true, createdAt: true },
        orderBy: { id: "desc" },
        take: 10,
      }),
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

    const propertiesWithDates = props.map(p => ({
      ...p,
      createdAt: p.createdAt ? new Date(p.createdAt).toISOString() : new Date().toISOString(),
    }));

    return res.json({
      owner: ownerWithDates,
      snapshot: {
        propertiesRecent: propertiesWithDates,
        invoicesCount: invoices,
        revenue: {
          netSum: Number(money._sum.netPayable ?? 0),
          grossSum: Number(money._sum.total ?? 0),
          commissionSum: Number(money._sum.commissionAmount ?? 0),
          paidCount: money._count._all,
        },
      },
    });
  } catch (err: any) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && (err.code === 'P2021' || err.code === 'P2022')) {
      console.warn('Prisma schema mismatch when querying owner by id:', err.message);
      return res.status(200).json({ owner: null, snapshot: { propertiesRecent: [], invoicesCount: 0, revenue: { netSum: 0, grossSum: 0, commissionSum: 0, paidCount: 0 } } });
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
