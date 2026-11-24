import { prisma } from "@nolsaf/prisma";
import type { RequestHandler } from "express";
import type { AuthedRequest } from "../../middleware/auth.js";
import { asyncHandler } from "../../middleware/errorHandler.js";
import { generateCustomerBookingReceiptPdf } from "../pdfDocuments.js";
import { generateBookingPDF } from "../pdfGenerator.js";
import { loadOwnTenancy, TenancyError, tenancyReceiptAmount } from "./tenancyService.js";

export function longStayReceipt(format: "html" | "pdf"): RequestHandler {
  return asyncHandler(async (req: AuthedRequest, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    try {
      const tenancy = await loadOwnTenancy(prisma, String(req.params.ref), "TENANT", req.user!.id);
      const amount = tenancyReceiptAmount(tenancy);
      if (amount == null) return res.status(404).json({ error: "Payment receipt is not available yet." });

      const [home, tenant] = await Promise.all([
        prisma.property.findUnique({ where: { id: tenancy.propertyId }, select: { title: true, district: true, regionName: true } }),
        prisma.user.findUnique({ where: { id: tenancy.tenantId }, select: { fullName: true, name: true } }),
      ]);
      const filename = `Long-Stay-Receipt-${tenancy.publicRef}.pdf`;
      const receiptNumber = tenancy.paymentRef || tenancy.publicRef;
      const guestName = tenant?.fullName || tenant?.name || "Tenant";
      const propertyName = home?.title || "Long-stay home";
      const propertyLocation = [home?.district, home?.regionName].filter(Boolean).join(", ");
      const term = tenancy.termMonths;
      const leaseLength = term ? `${term} month${term === 1 ? "" : "s"}` : "Long stay";
      const checkIn = tenancy.moveInDate ?? tenancy.paidAt;
      const checkOut = tenancy.endDate ?? tenancy.paidAt;
      const confirmationCopy = "NoLSAF received this card payment for the first month's rent and service fee. Any amount payable to the landlord is shown separately in your lease. This document is not a fiscal tax receipt.";
      const document = {
        title: "LONG-STAY PAYMENT RECEIPT",
        lineTitle: "First month and service fee",
        lineSub: "Card payment to NoLSAF",
        confirmationTitle: "CARD PAYMENT RECEIVED",
        confirmationCopy,
        referenceLabel: "Ref",
        hideBalance: true,
        watermark: "NoLSAF",
      };

      if (format === "pdf") {
        const pdf = await generateCustomerBookingReceiptPdf({
          receiptNumber, bookingCode: tenancy.publicRef, paidAt: tenancy.paidAt,
          guestName, propertyName, propertyLocation,
          checkIn, checkOut, totalAmount: amount, currency: tenancy.currency,
          document: { ...document, reservationLabel: "LONG-STAY RESERVATION", periodLabel: "LEASE TERM", periodText: leaseLength },
        });
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        return res.type("application/pdf").send(pdf);
      }

      const { html } = await generateBookingPDF({
        bookingId: tenancy.id, bookingCode: tenancy.publicRef, guestName,
        property: { title: propertyName, type: "Long stay", district: home?.district ?? undefined, regionName: home?.regionName ?? undefined },
        checkIn, checkOut, totalAmount: amount,
        invoice: { receiptNumber, paidAt: tenancy.paidAt },
        document: { ...document, periodColumn: "Lease term", periodTitle: leaseLength, periodSub: "", currency: tenancy.currency, hideVerificationQr: true },
      });
      res.setHeader("X-NoLSAF-Filename", filename);
      res.setHeader("Content-Security-Policy", "script-src 'none'; object-src 'none'; base-uri 'none'");
      return res.type("html").send(html);
    } catch (error) {
      if (error instanceof TenancyError) return res.status(error.status).json({ error: error.message });
      throw error;
    }
  }) as RequestHandler;
}
