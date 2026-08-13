import "dotenv/config";
import { prisma } from "@nolsaf/prisma";
import { syncOperatorTourPackages } from "../apps/api/src/lib/tourPackageSync.js";

function requireSafeTarget() {
  const raw = process.env.DATABASE_URL || "";
  const url = new URL(raw);
  const local = ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  if (!local && !process.argv.includes("--allow-non-local")) {
    throw new Error(`Refusing non-local backfill target: ${url.hostname}. Pass --allow-non-local only in an approved environment.`);
  }
  return { host: url.hostname, database: url.pathname.replace(/^\//, "") };
}

function object(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}

async function main() {
  const target = requireSafeTarget();
  let packages = 0;
  let travelers = 0;
  let payments = 0;

  const agents = await prisma.agent.findMany({ where: { operatorProfile: { not: null } }, select: { id: true, operatorProfile: true } });
  for (const agent of agents) {
    const source = object(agent.operatorProfile);
    const approved = object(source.approvedSnapshot);
    const profile = Object.keys(approved).length ? approved : source;
    const packageItems = Array.isArray(profile.packageItems) ? profile.packageItems : [];
    if (!packageItems.length) continue;
    const reviewStatus = String(source.reviewStatus || object(source.review).status || "").toUpperCase();
    await syncOperatorTourPackages(agent.id, packageItems, reviewStatus === "APPROVED" ? "PUBLISHED" : "DRAFT");
    packages += packageItems.length;
  }

  const bookings = await prisma.tourBooking.findMany({
    select: { id: true, paymentStatus: true, paidAt: true, customerPaymentRef: true, paymentRef: true, paymentProvider: true, currency: true, grossAmount: true, metadata: true },
  });
  for (const booking of bookings) {
    const reference = booking.customerPaymentRef || booking.paymentRef;
    if ((String(booking.paymentStatus).toUpperCase() === "PAID" || booking.paidAt) && reference) {
      await prisma.tourFinancialTransaction.upsert({
        where: { reference },
        create: { tourBookingId: booking.id, kind: "PAYMENT", status: "PAID", provider: booking.paymentProvider, reference, currency: booking.currency, amount: booking.grossAmount, metadata: { source: "LEGACY_TOUR_BOOKING_BACKFILL" } },
        update: { status: "PAID", provider: booking.paymentProvider },
      });
      payments += 1;
    }

    const members = Array.isArray(object(booking.metadata).groupMembers) ? object(booking.metadata).groupMembers : [];
    for (let index = 0; index < members.length; index += 1) {
      const member = object(members[index]);
      const fullName = String(member.fullName || member.name || "").trim();
      if (!fullName) continue;
      const legacyMemberId = String(member.id || index).slice(0, 120);
      await prisma.tourTraveler.upsert({
        where: { tourBookingId_legacyMemberId: { tourBookingId: booking.id, legacyMemberId } },
        create: {
          tourBookingId: booking.id, legacyMemberId, fullName, email: String(member.email || "").trim() || null,
          phone: String(member.phone || "").trim() || null, nationality: String(member.nationality || "").trim() || null,
          documentType: String(member.documentType || "").trim() || null, documentNumber: String(member.documentNumber || "").trim() || null,
          documentUrl: String(member.documentUrl || "").trim() || null, permitStatus: String(member.permitStatus || "NOT_REQUIRED").toUpperCase(), metadata: member,
        },
        update: { fullName, permitStatus: String(member.permitStatus || "NOT_REQUIRED").toUpperCase(), metadata: member },
      });
      travelers += 1;
    }
  }

  const normalized = {
    packages: await prisma.tourPackage.count(),
    travelers: await prisma.tourTraveler.count(),
    financialTransactions: await prisma.tourFinancialTransaction.count(),
    cases: await prisma.tourCase.count(),
  };
  console.log(JSON.stringify({ target, processed: { agents: agents.length, packages, bookings: bookings.length, travelers, payments }, normalized }));
}

main().finally(async () => prisma.$disconnect());
