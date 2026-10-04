import { Router, type RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { blockImpersonated, requireAuth, requireRole } from "../middleware/auth.js";
import { requireAdminFinanceGrant } from "../middleware/financeGrant.js";
import { extractPaymentMetadata, extractRecordedPayerAccount, formatPaymentExportTimestamp, maskPaymentAccount } from "../lib/adminPaymentsView.js";

const router = Router();
router.use(
  requireAuth as unknown as RequestHandler,
  requireRole("ADMIN") as unknown as RequestHandler
);

// GET /admin/payments/invoices?tab=waiting|paid&q=&page=&pageSize=
// Returns invoices based on status: APPROVED (waiting) or PAID (paid history)
router.get("/invoices", async (req, res) => {
  try {
    const { tab = "waiting", q, page = "1", pageSize = "50" } = req.query as any;
    
    const where: any = {};
    
    // Filter by tab: "waiting" = APPROVED invoices, "paid" = PAID invoices
    if (tab === "waiting") {
      where.status = "APPROVED";
    } else if (tab === "paid") {
      where.status = "PAID";
    }

    // Search query
    if (q && String(q).trim() !== '') {
      const searchTerm = String(q).trim();
      where.OR = [
        { invoiceNumber: { contains: searchTerm } },
        { receiptNumber: { contains: searchTerm } },
        { paymentRef: { contains: searchTerm } },
        { owner: { name: { contains: searchTerm } } },
        { owner: { email: { contains: searchTerm } } },
        { booking: { property: { title: { contains: searchTerm } } } },
      ];
    }

    const skip = (Number(page) - 1) * Number(pageSize);
    const take = Math.min(Number(pageSize), 100);

    const [items, total] = await Promise.all([
      prisma.invoice.findMany({
        where,
        include: {
          owner: {
            select: { id: true, name: true, email: true, phone: true },
          },
          booking: {
            include: {
              property: {
                select: { id: true, title: true, type: true },
              },
            },
          },
          approvedByUser: {
            select: { id: true, name: true },
          },
          paymentEvents: {
            where: { status: "SUCCESS" },
            orderBy: { id: "desc" },
            take: 1,
            select: {
              id: true,
              provider: true,
              eventId: true,
              amount: true,
              currency: true,
              status: true,
              phone: true,
              createdAt: true,
              payload: true, // Include payload to extract account info
            },
          },
        },
        orderBy: tab === "paid" ? { paidAt: "desc" } : { approvedAt: "desc" },
        skip,
        take,
      }),
      prisma.invoice.count({ where }),
    ]);

    // Transform to payment-like format
    const transformed = items.map((inv) => {
      const paymentEvent = inv.paymentEvents?.[0] || null;
      const accountNumber = maskPaymentAccount(extractRecordedPayerAccount(inv, paymentEvent));
      
      return {
        id: inv.id,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber || `INV-${inv.id}`,
        receiptNumber: inv.receiptNumber,
        issuedAt: inv.issuedAt,
        ...extractPaymentMetadata(paymentEvent?.payload, inv.checkoutSessionId),
        date: tab === "paid" ? (inv.paidAt || inv.updatedAt) : (inv.approvedAt || inv.updatedAt),
        amount: Number(inv.netPayable || inv.total || 0),
        currency: "TZS", // Default, can be extended if needed
        status: inv.status,
        owner: {
          id: inv.owner.id,
          name: inv.owner.name,
          email: inv.owner.email,
          phone: inv.owner.phone,
        },
        property: inv.booking?.property ? {
          id: inv.booking.property.id,
          title: inv.booking.property.title,
          type: inv.booking.property.type,
        } : null,
        paymentMethod: inv.paymentMethod || paymentEvent?.provider || null,
        paymentRef: inv.paymentRef,
        accountNumber: accountNumber, // Add account number
        approvedBy: inv.approvedByUser ? {
          id: inv.approvedByUser.id,
          name: inv.approvedByUser.name,
        } : null,
        approvedAt: inv.approvedAt,
        paidAt: inv.paidAt,
        paymentEvent: paymentEvent ? {
          provider: paymentEvent.provider,
          eventId: paymentEvent.eventId,
          status: paymentEvent.status,
          createdAt: paymentEvent.createdAt,
        } : null,
      };
    });

    res.json({ total, page: Number(page), pageSize: take, items: transformed });
  } catch (err: any) {
    console.error("Error in GET /admin/payments/invoices:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /admin/payments/events?status=&q=&page=&pageSize= (keep for backward compatibility)
router.get("/events", async (req, res) => {
  const { status, q, tab, page = "1", pageSize = "50" } = req.query as any;
  const where: any = {};
  if (status) where.status = String(status);

  // tab=unmatched: money arrived and the callback resolved to nothing. These are
  // the events where a customer was charged and no booking, tour, group stay or
  // NRMS token was advanced, so they need a human. Without this filter they were
  // only findable by scrolling the full event list.
  if (String(tab || "") === "unmatched") {
    const rows = await prisma.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM payment_events
      WHERE status = 'SUCCESS'
        AND invoiceId IS NULL
        AND tourBookingId IS NULL
        AND groupBookingId IS NULL
        AND JSON_EXTRACT(payload, '$.nrmsToken') IS NULL
      ORDER BY id DESC
      LIMIT 5000
    `;
    where.id = { in: rows.map((row) => Number(row.id)) };
  }

  // tab=variance: settled or held payments whose amount did not match what was
  // expected, including shortfalls absorbed inside the tolerance window.
  //
  // recordedAt is always an ISO timestamp written by recordPaymentVariance.
  // Filtering that scalar avoids a capped raw-ID prequery, so older variance
  // rows remain pageable instead of disappearing after the newest 5,000.
  if (String(tab || "") === "variance") {
    where.payload = {
      path: "$.variance.recordedAt",
      string_contains: "T",
    };
  }

  if (q) {
    // MySQL doesn't support `mode: "insensitive"`; rely on default CI collations.
    const search = String(q).trim().slice(0, 120);
    if (search) {
      where.OR = [
        { provider: { contains: search } },
        { eventId: { contains: search } },
        { currency: { contains: search } },
      ];
    }
  }

  const skip = (Number(page) - 1) * Number(pageSize);
  const take = Math.min(Number(pageSize), 100);

  const [items, total] = await Promise.all([
    prisma.paymentEvent.findMany({
      where,
      orderBy: { id: "desc" },
      skip,
      take,
      include: { invoice: { select: { id: true, invoiceNumber: true, ownerId: true } } },
    }),
    prisma.paymentEvent.count({ where }),
  ]);

  res.json({ total, page: Number(page), pageSize: take, items });
});

// GET /admin/payments/events/:id
router.get("/events/:id", async (req, res) => {
  const id = Number(req.params.id);
  const ev = await prisma.paymentEvent.findUnique({
    where: { id },
    include: { invoice: { include: { booking: { include: { property: true } } } } },
  });
  if (!ev) return res.status(404).json({ error: "Payment event not found" });
  res.json(ev);
});

// GET /admin/payments/summary
router.get("/summary", async (_req, res) => {
  try {
    const [waitingCount, paidCount, nrmsPayable, nrmsPaid, payoutOpen, payoutPaid, unmatchedRows, variance] = await Promise.all([
      prisma.invoice.count({ where: { status: "APPROVED" } }),
      prisma.invoice.count({ where: { status: "PAID" } }),
      prisma.nrmsBillingStatement.count({ where: { status: "PAYABLE" } }),
      prisma.nrmsBillingStatement.count({ where: { status: "PAID" } }),
      prisma.disbursement.count({ where: { status: { in: ["REQUESTED", "APPROVED", "BATCHED", "AUTHORIZED", "SUBMITTED", "PROCESSING", "SECURITY_REVIEW"] } } }),
      prisma.disbursement.count({ where: { status: "PAID" } }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM payment_events
        WHERE status = 'SUCCESS'
          AND invoiceId IS NULL
          AND tourBookingId IS NULL
          AND groupBookingId IS NULL
          AND JSON_EXTRACT(payload, '$.nrmsToken') IS NULL
      `,
      prisma.paymentEvent.count({
        where: { payload: { path: "$.variance.recordedAt", string_contains: "T" } },
      }),
    ]);
    const unmatched = Number(unmatchedRows[0]?.count ?? 0);
    res.json({
      waiting: waitingCount,
      paid: paidCount,
      booking: { waiting: waitingCount, paid: paidCount },
      nrms: { waiting: nrmsPayable, paid: nrmsPaid },
      payouts: { open: payoutOpen, paid: payoutPaid },
      exceptions: { unmatched, variance, total: unmatched + variance },
    });
  } catch (err: any) {
    console.error("Error in GET /admin/payments/summary:", err);
    res.status(500).json({ error: "Unable to load payment operations summary" });
  }
});

// CSV export helper function
function toCsv(rows: Array<Record<string, any>>, fields: string[]) {
  const esc = (v: any) => {
    if (v === null || v === undefined) return "";
    const s = String(v).replace(/"/g, '""');
    if (s.includes(',') || s.includes('\n') || s.includes('"')) return `"${s}"`;
    return s;
  };
  const header = fields.join(',');
  const lines = rows.map((r) => fields.map((f) => esc(r[f])).join(','));
  return [header, ...lines].join('\n');
}

// GET /admin/payments/export.csv
router.get("/export.csv", blockImpersonated as RequestHandler, requireAdminFinanceGrant as RequestHandler, async (req, res) => {
  try {
    const { tab = "waiting", q, selectedIds } = req.query as any;
    
    const where: any = {};
    
    // Filter by tab: "waiting" = APPROVED invoices, "paid" = PAID invoices
    if (tab === "waiting") {
      where.status = "APPROVED";
    } else if (tab === "paid") {
      where.status = "PAID";
    }

    // If specific IDs are selected, filter by those
    if (selectedIds) {
      const ids = String(selectedIds).split(',').map(Number).filter(Boolean);
      if (ids.length > 0) {
        where.id = { in: ids };
      }
    }

    // Search query
    if (q && String(q).trim() !== '') {
      const searchTerm = String(q).trim();
      where.OR = [
        { invoiceNumber: { contains: searchTerm } },
        { receiptNumber: { contains: searchTerm } },
        { paymentRef: { contains: searchTerm } },
        { owner: { name: { contains: searchTerm } } },
        { owner: { email: { contains: searchTerm } } },
        { booking: { property: { title: { contains: searchTerm } } } },
      ];
    }

    const items = await prisma.invoice.findMany({
      where,
      include: {
        owner: { select: { id: true, name: true, email: true, phone: true } },
        booking: { include: { property: { select: { id: true, title: true, type: true } } } },
        approvedByUser: { select: { id: true, name: true } },
        paymentEvents: {
          where: { status: "SUCCESS" },
          orderBy: { id: "desc" },
          take: 1,
          select: { provider: true, phone: true, payload: true, eventId: true, createdAt: true, status: true },
        },
      },
      orderBy: tab === "paid" ? { paidAt: "desc" } : { approvedAt: "desc" },
    });

    // Generate CSV
    const headers = [
      'Invoice ID',
      'Invoice Number',
      'Receipt Number',
      'Status',
      'Status Date (EAT UTC+3)',
      'Invoice Issued At (EAT UTC+3)',
      'Amount (TZS)',
      'Owner Name',
      'Owner Email',
      'Owner Phone',
      'Property Title',
      'Property Type',
      'Payment Method',
      'Bank Name',
      'Merchant Reference',
      'Bank / Provider Transaction Reference',
      'Recorded Payer Account (Masked)',
      'Provider',
      'Provider Event ID',
      'Provider Event Status',
      'Provider Event At (EAT UTC+3)',
      'Approved By',
      'Approved At (EAT UTC+3)',
      'Paid At (EAT UTC+3)',
    ];

    const rows = items.map((inv) => {
      const paymentEvent = inv.paymentEvents?.[0] || null;
      const accountNumber = maskPaymentAccount(extractRecordedPayerAccount(inv, paymentEvent));
      const date = tab === "paid" ? (inv.paidAt || inv.updatedAt) : (inv.approvedAt || inv.updatedAt);
      const metadata = extractPaymentMetadata(paymentEvent?.payload, inv.checkoutSessionId);

      return {
        'Invoice ID': inv.id,
        'Invoice Number': inv.invoiceNumber || `INV-${inv.id}`,
        'Receipt Number': inv.receiptNumber || '',
        'Status': inv.status,
        'Status Date (EAT UTC+3)': formatPaymentExportTimestamp(date),
        'Invoice Issued At (EAT UTC+3)': formatPaymentExportTimestamp(inv.issuedAt),
        'Amount (TZS)': Number(inv.netPayable || inv.total || 0),
        'Owner Name': inv.owner.name || '',
        'Owner Email': inv.owner.email || '',
        'Owner Phone': inv.owner.phone || '',
        'Property Title': inv.booking?.property?.title || '',
        'Property Type': inv.booking?.property?.type || '',
        'Payment Method': inv.paymentMethod || paymentEvent?.provider || '',
        'Bank Name': metadata.bankName || '',
        'Merchant Reference': inv.paymentRef || '',
        'Bank / Provider Transaction Reference': metadata.providerReference || '',
        'Recorded Payer Account (Masked)': accountNumber || '',
        'Provider': paymentEvent?.provider || '',
        'Provider Event ID': paymentEvent?.eventId || '',
        'Provider Event Status': paymentEvent?.status || '',
        'Provider Event At (EAT UTC+3)': formatPaymentExportTimestamp(paymentEvent?.createdAt),
        'Approved By': inv.approvedByUser?.name || '',
        'Approved At (EAT UTC+3)': formatPaymentExportTimestamp(inv.approvedAt),
        'Paid At (EAT UTC+3)': formatPaymentExportTimestamp(inv.paidAt),
      };
    });

    const csvContent = toCsv(rows, headers);

    try {
      await prisma.adminAudit.create({
        data: {
          adminId: Number((req.user as any)?.id) || null,
          targetUserId: null,
          action: "PAYMENTS_CSV_EXPORT",
          details: { tab, query: q ? String(q).slice(0, 120) : null, selectedCount: selectedIds ? String(selectedIds).split(",").filter(Boolean).length : 0, rows: rows.length },
        },
      });
    } catch (auditError) {
      console.warn("Failed to audit payments CSV export", auditError);
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments-${tab}-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    console.error('Error in GET /admin/payments/export.csv:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

export default router;
