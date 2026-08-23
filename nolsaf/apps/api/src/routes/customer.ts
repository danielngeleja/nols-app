import { type Express, type RequestHandler } from "express";
import customerBookingsRouter from "./customer.bookings";
import customerCancellationsRouter from "./customer.cancellations";
import customerGroupStaysRouter from "./customer.groupStays";
import customerNotificationsRouter from "./customer.notifications";
import customerNrmsRouter from "./customer.nrms";
import customerPlanRequestsRouter from "./customer.planRequests";
import customerReferralsRouter from "./customer.referrals";
import customerRidesRouter from "./customer.rides";
import customerSavedPropertiesRouter from "./customer.savedProperties";
import customerPropertySharesRouter from "./customer.propertyShares.js";
import customerTourBookingsRouter from "./customer.tourBookings";

export function registerCustomerRoutes(app: Express): void {
  app.use("/api/customer/bookings", customerBookingsRouter as RequestHandler);
  app.use("/api/customer/cancellations", customerCancellationsRouter as RequestHandler);
  app.use("/api/customer/rides", customerRidesRouter as RequestHandler);
  app.use("/api/customer/group-stays", customerGroupStaysRouter as RequestHandler);
  app.use("/api/customer/notifications", customerNotificationsRouter as RequestHandler);
  app.use("/api/customer/nrms", customerNrmsRouter as RequestHandler);
  app.use("/api/customer/property-shares", customerPropertySharesRouter as RequestHandler);
  app.use("/api/customer/saved-properties", customerSavedPropertiesRouter as RequestHandler);
  app.use("/api/customer/plan-requests", customerPlanRequestsRouter as RequestHandler);
  app.use("/api/customer/referrals", customerReferralsRouter as RequestHandler);
  app.use("/api/customer/tour-bookings", customerTourBookingsRouter as RequestHandler);
}
