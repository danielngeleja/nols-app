import { Router, type RequestHandler } from "express";
import { prisma } from "@nolsaf/prisma";
import { requireAuth, requireRole } from "../middleware/auth.js";

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

    // Helper function to extract account number from various sources
    const extractAccountNumber = (inv: any, paymentEvent: any): string | null => {
      // First try: paymentEvent payload (most reliable for actual payment)
      if (paymentEvent?.payload) {
        const payload = paymentEvent.payload as any;
        // Common field names in payment payloads
        const accountFields = ['phoneNumber', 'phone', 'accountNumber', 'account', 'msisdn', 'sourcePhone', 'destinationPhone'];
        for (const field of accountFields) {
          if (payload[field]) {
            return String(payload[field]);
          }
        }
      }
      
      // Second try: paymentRef might contain account info
      if (inv.paymentRef) {
        // Check if paymentRef looks like a phone number (starts with 0, 255, or +255)
        const ref = String(inv.paymentRef);
        if (/^(0|255|\+255|254|\+254)\d{6,}/.test(ref)) {
          return ref;
        }
      }
      
      // Third try: owner's payout info (from JSON payout field)
      // This would require additional query, but for now we'll skip as it's expensive
      // Owner phone as fallback
      if (inv.owner?.phone) {
        return inv.owner.phone;
      }
      
      return null;
    };

    // Transform to payment-like format
    const transformed = items.map((inv) => {
      const paymentEvent = inv.paymentEvents?.[0] || null;
      const accountNumber = extractAccountNumber(inv, paymentEvent);
      
      return {
        id: inv.id,
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber || `INV-${inv.id}`,
        receiptNumber: inv.receiptNumber,
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
    // Count APPROVED invoices (waiting for payment)
    const waitingCount = await prisma.invoice.count({ where: { status: "APPROVED" } });
    
    // Count PAID invoices (paid history)
    const paidCount = await prisma.invoice.count({ where: { status: "PAID" } });
    
    // Payment event aggregates (for reference)
    const byStatus = await prisma.paymentEvent.groupBy({ by: ["status"], _count: { _all: true } });
    const byProvider = await prisma.paymentEvent.groupBy({ by: ["provider"], _count: { _all: true } });
    
    res.json({ 
      waiting: waitingCount,
      paid: paidCount,
      byStatus, 
      byProvider 
    });
  } catch (err: any) {
    console.error("Error in GET /admin/payments/summary:", err);
    res.json({ waiting: 0, paid: 0, byStatus: [], byProvider: [] });
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
router.get("/export.csv", async (req, res) => {
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
          select: { provider: true, payload: true },
        },
      },
      orderBy: tab === "paid" ? { paidAt: "desc" } : { approvedAt: "desc" },
    });

    // Extract account number helper (same as in GET /invoices)
    const extractAccountNumber = (inv: any, paymentEvent: any): string | null => {
      if (paymentEvent?.payload) {
        const payload = paymentEvent.payload as any;
        const accountFields = ['phoneNumber', 'phone', 'accountNumber', 'account', 'msisdn', 'sourcePhone', 'destinationPhone'];
        for (const field of accountFields) {
          if (payload[field]) return String(payload[field]);
        }
      }
      if (inv.paymentRef && /^(0|255|\+255|254|\+254)\d{6,}/.test(String(inv.paymentRef))) {
        return String(inv.paymentRef);
      }
      if (inv.owner?.phone) return inv.owner.phone;
      return null;
    };

    // Generate CSV
    const headers = [
      'Invoice ID',
      'Invoice Number',
      'Receipt Number',
      'Status',
      'Date',
      'Amount (TZS)',
      'Owner Name',
      'Owner Email',
      'Owner Phone',
      'Property Title',
      'Property Type',
      'Payment Method',
      'Payment Reference',
      'Account Number',
      'Approved By',
      'Approved At',
      'Paid At',
    ];

    const rows = items.map((inv) => {
      const paymentEvent = inv.paymentEvents?.[0] || null;
      const accountNumber = extractAccountNumber(inv, paymentEvent);
      const date = tab === "paid" ? (inv.paidAt || inv.updatedAt) : (inv.approvedAt || inv.updatedAt);

      return {
        'Invoice ID': inv.id,
        'Invoice Number': inv.invoiceNumber || `INV-${inv.id}`,
        'Receipt Number': inv.receiptNumber || '',
        'Status': inv.status,
        'Date': date ? new Date(date).toLocaleString() : '',
        'Amount (TZS)': Number(inv.netPayable || inv.total || 0),
        'Owner Name': inv.owner.name || '',
        'Owner Email': inv.owner.email || '',
        'Owner Phone': inv.owner.phone || '',
        'Property Title': inv.booking?.property?.title || '',
        'Property Type': inv.booking?.property?.type || '',
        'Payment Method': inv.paymentMethod || paymentEvent?.provider || '',
        'Payment Reference': inv.paymentRef || '',
        'Account Number': accountNumber || '',
        'Approved By': inv.approvedByUser?.name || '',
        'Approved At': inv.approvedAt ? new Date(inv.approvedAt).toLocaleString() : '',
        'Paid At': inv.paidAt ? new Date(inv.paidAt).toLocaleString() : '',
      };
    });

    const csvContent = toCsv(rows, headers);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="payments-${tab}-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csvContent);
  } catch (err: any) {
    console.error('Error in GET /admin/payments/export.csv:', err);
    res.status(500).json({ error: 'Internal server error', message: err?.message || 'Unknown error' });
  }
});

export default router;
