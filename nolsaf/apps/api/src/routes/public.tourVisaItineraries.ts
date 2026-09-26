import { Router } from "express";
import { prisma } from "@nolsaf/prisma";
import { parseTourVisaVerificationToken } from "../lib/tourVisaVerification.js";

const router = Router();

router.get("/:token", async (req, res) => {
  try {
    const bookingId = parseTourVisaVerificationToken(req.params.token);
    if (!bookingId) return res.status(404).json({ verified: false, error: "Document not found" });

    const booking = await prisma.tourBooking.findUnique({
      where: { id: bookingId },
      select: {
        bookingCode: true,
        title: true,
        destination: true,
        startDate: true,
        endDate: true,
        travelerCount: true,
        guestName: true,
        nationality: true,
        status: true,
        paymentStatus: true,
        operatorSnapshot: true,
        // Names and nationalities only; travel document numbers never leave the printed copy.
        travelers: { where: { status: "ACTIVE" }, select: { fullName: true, nationality: true }, orderBy: { createdAt: "asc" } },
        _count: { select: { cases: { where: { status: { in: ["OPEN", "ACKNOWLEDGED", "ESCALATED", "UNDER_REVIEW", "ELIGIBLE"] } } } } },
      },
    });
    const paid = booking && ["PAID", "APPROVED", "DISBURSED", "SETTLED"].includes(String(booking.paymentStatus || "").toUpperCase());
    if (!booking || !paid) return res.status(404).json({ verified: false, error: "Document not found" });

    const status = String(booking.status || "").toUpperCase();
    const documentStatus = ["CANCELED", "CANCELLED", "REFUNDED"].includes(status)
      ? "CANCELLED"
      : booking._count.cases > 0
        ? "UNDER_REVIEW"
        : "VERIFIED";
    const operator = booking.operatorSnapshot && typeof booking.operatorSnapshot === "object" && !Array.isArray(booking.operatorSnapshot)
      ? booking.operatorSnapshot as Record<string, any>
      : {};

    res.setHeader("Cache-Control", "public, max-age=60, must-revalidate");
    return res.json({
      // An open case still means the booking exists; the page says it is under review.
      verified: documentStatus !== "CANCELLED",
      documentStatus,
      documentNumber: `NLSAF-VI-${String(booking.bookingCode || "").replace(/^TOUR-/i, "")}`,
      bookingCode: booking.bookingCode,
      title: booking.title,
      destination: booking.destination,
      startDate: booking.startDate,
      endDate: booking.endDate,
      travelerCount: booking.travelerCount,
      leadTraveller: booking.guestName,
      nationality: booking.nationality,
      operatorName: String(operator.companyName || operator.name || "NoLSAF tour operator"),
      travellers: booking.travelers.map((t) => ({ name: t.fullName, nationality: t.nationality || null })),
    });
  } catch (error) {
    console.error("GET /public/tour-visa-itineraries/:token error:", error);
    return res.status(500).json({ verified: false, error: "Verification is temporarily unavailable" });
  }
});

export default router;
