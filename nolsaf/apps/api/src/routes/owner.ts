import { type Express, type RequestHandler } from "express";
import requireRole from "../middleware/auth";
import { router as ownerBookingsRouter } from "./owner.booking";
import { router as ownerEmail } from "./owner.email.verify";
import ownerGroupStaysClaimsRouter from "./owner.groupStays.claims";
import ownerGroupStaysRouter from "./owner.groupStays";
import ownerInvoicesRouter from "./owner.invoices";
import ownerNotificationsRouter from "./owner.notifications";
import { router as ownerPhone } from "./owner.phone.verify";
import { router as ownerProperties } from "./owner.properties";
import { router as ownerPropLayout } from "./owner.properties.layout";
import { router as ownerReports } from "./owner.reports";
import { router as ownerRevenue } from "./owner.revenue";
import ownerAvailabilityRouter from "./owner.availability";
import ownerNrmsRouter from "./owner.nrms";
import ownerNrmsRoomsRouter from "./owner.nrms.rooms";
import ownerNrmsCalendarRouter from "./owner.nrms.calendar";
import ownerNrmsReservationsRouter from "./owner.nrms.reservations";
import ownerNrmsGuestsRouter from "./owner.nrms.guests";
import ownerNrmsSmsRouter from "./owner.nrms.sms";
import ownerNrmsBillingRouter from "./owner.nrms.billing";
import ownerNrmsReportsRouter from "./owner.nrms.reports";
import ownerNrmsFinanceRouter from "./owner.nrms.finance";
import nrmsPaymentsRouter from "./nrms.payments";
import nrmsOperationsRouter from "./nrms.operations";

export function registerOwnerPropertyRoutes(app: Express): void {
  app.use("/owner/properties", ownerProperties);
  app.use("/owner/properties", ownerPropLayout);
  app.use("/api/owner/properties", ownerProperties);
  app.use("/api/owner/properties", ownerPropLayout);
}

export function registerOwnerReportsRoute(app: Express): void {
  app.use("/api/owner/reports", requireRole("OWNER") as RequestHandler, ownerReports);
}

export function registerOwnerBusinessRoutes(app: Express): void {
  app.use("/api/nrms/payments", nrmsPaymentsRouter as RequestHandler);
  app.use("/api/nrms/operations", nrmsOperationsRouter as RequestHandler);
  app.use("/api/owner/revenue", requireRole("OWNER") as RequestHandler, ownerRevenue);
  app.use("/api/owner/notifications", requireRole("OWNER") as RequestHandler, ownerNotificationsRouter as RequestHandler);
  app.use("/api/owner/availability", ownerAvailabilityRouter as RequestHandler);
  // NRMS (doc section 12): rooms router mounted first so /nrms/rooms/* never
  // falls through to the enrollment router's parameterized routes.
  app.use("/api/owner/nrms/rooms", ownerNrmsRoomsRouter as RequestHandler);
  app.use("/api/owner/nrms/calendar", ownerNrmsCalendarRouter as RequestHandler);
  app.use("/api/owner/nrms/reservations", ownerNrmsReservationsRouter as RequestHandler);
  app.use("/api/owner/nrms/guests", ownerNrmsGuestsRouter as RequestHandler);
  app.use("/api/owner/nrms/sms", ownerNrmsSmsRouter as RequestHandler);
  app.use("/api/owner/nrms/billing", ownerNrmsBillingRouter as RequestHandler);
  app.use("/api/owner/nrms/reports", ownerNrmsReportsRouter as RequestHandler);
  app.use("/api/owner/nrms/finance", ownerNrmsFinanceRouter as RequestHandler);
  app.use("/api/owner/nrms", ownerNrmsRouter as RequestHandler);
}

export function registerOwnerContactRoutes(app: Express): void {
  app.use("/api/owner/phone", ownerPhone);
  app.use("/api/owner/email", ownerEmail);
}

export function registerOwnerBookingRoutes(app: Express): void {
  app.use("/owner/bookings", ownerBookingsRouter);
  app.use("/api/owner/bookings", ownerBookingsRouter);
  app.use("/owner/invoices", ownerInvoicesRouter as RequestHandler);
  app.use("/api/owner/invoices", ownerInvoicesRouter as RequestHandler);
  app.use("/owner/group-stays", ownerGroupStaysRouter as RequestHandler);
  app.use("/api/owner/group-stays", ownerGroupStaysRouter as RequestHandler);
  app.use("/owner/group-stays/claims", ownerGroupStaysClaimsRouter as RequestHandler);
  app.use("/api/owner/group-stays/claims", ownerGroupStaysClaimsRouter as RequestHandler);
}
