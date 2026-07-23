import { type Express, type RequestHandler } from "express";
import { maybeAuth } from "../middleware/auth.js";
import clientErrorsRouter from "./clientErrors";
import publicAvailabilityRouter from "./public.availability";
import publicBookingRouter from "./public.booking";
import publicBookingsRouter from "./public.bookings";
import publicCareersApplyRouter from "./public.careers.apply";
import publicCareersRouter from "./public.careers";
import publicDriverVerificationRouter from "./public.driverVerification";
import { router as publicEmailVerify } from "./public.email.verify";
import publicGroupStayReceiptRouter from "./public.groupStayReceipt";
import publicInvoicesRouter from "./public.invoices";
import publicNolScopeRouter from "./public.nolscope";
import publicNrmsMenuRouter from "./public.nrmsMenu";
import publicNrmsGuestRouter from "./public.nrmsGuest";
import publicAgentsRouter from "./public.agents";
import publicPickupPointsRouter from "./public.pickupPoints";
import publicPlanRequestRouter from "./public.planRequest";
import publicPodcastsRouter from "./public.podcasts";
import publicPropertiesRouter from "./public.properties";
import publicReportsRouter from "./public.reports";
import publicSupportRouter from "./public.support";
import publicTourBookingsRouter from "./public.tourBookings";
import publicTourismSitesRouter from "./public.tourismSites";
import publicUpdatesRouter from "./public.updates";

export function registerPublicEmailVerifyRoute(app: Express): void {
  app.use("/api", publicEmailVerify);
}

export function registerPublicCareerRoutes(app: Express): void {
  app.use("/api/careers/apply", publicCareersApplyRouter);
  app.use("/api/public/careers", publicCareersRouter);
}

export function registerPublicContentRoutes(app: Express): void {
  app.use("/api/public", maybeAuth as RequestHandler);
  app.use("/api/client-errors", maybeAuth as RequestHandler, clientErrorsRouter);
  app.use("/api/public/support", publicSupportRouter);
  app.use("/api/public/updates", publicUpdatesRouter);
  app.use("/api/public/podcasts", publicPodcastsRouter);
  app.use("/api/public/booking", publicBookingRouter);
  app.use("/api/public/bookings", publicBookingsRouter);
  app.use("/api/public/invoices", publicInvoicesRouter);
  app.use("/api/public/reports", publicReportsRouter);
  app.use("/api/public/group-stays/receipt", publicGroupStayReceiptRouter);
  app.use("/api/public/pickup-points", publicPickupPointsRouter);
  app.use("/api/public/properties", publicPropertiesRouter);
  app.use("/api/public/tourism-sites", publicTourismSitesRouter);
  app.use("/api/public/nolscope", publicNolScopeRouter);
  app.use("/api/public/nrms/guest", publicNrmsGuestRouter);
  app.use("/api/public/nrms", publicNrmsMenuRouter);
  app.use("/api/public/agents", publicAgentsRouter);
  app.use("/api/public/tour-bookings", publicTourBookingsRouter);
  app.use("/api/public/driver-verification", publicDriverVerificationRouter);
}

export function registerPublicPlanRequestRoute(app: Express): void {
  app.use("/api/plan-request", publicPlanRequestRouter);
}

export function registerPublicAvailabilityRoute(app: Express): void {
  app.use("/api/public/availability", maybeAuth as RequestHandler, publicAvailabilityRouter as RequestHandler);
}
