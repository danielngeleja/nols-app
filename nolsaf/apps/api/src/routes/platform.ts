import { type Express, type RequestHandler } from "express";
import requireRole, { maybeAuth } from "../middleware/auth";
import { router as account } from "./account";
import authRoutes from "./auth";
import azampayPaymentsRouter from "./payments.azampay.js";
import azampayDisbursementRouter from "./payments.azampay.disbursement.js";
import azampayBankRouter     from "./payments.azampay.bank.js";
import azampayCardRouter     from "./payments.azampay.card.js";
import coralCommerceCardRouter from "./payments.coralcommerce.card.js";
import bookingsRoutes from "./bookings";
import chatbotRouter from "./chatbot";
import conversationsRoutes from "./conversations";
import { router as fxRouter } from "./fx";
import geocodingRouter from "./geocoding";
import groupBookingsRouter from "./groupBookings.js";
import propertyReviewsRouter from "./property.reviews";
import reportSealRouter from "./reports.seal";
import { handoffRouter as agentReportHandoffRouter } from "./agent.reports";
import { router as upCld } from "./uploads.cloudinary";
import { router as upS3 } from "./uploads.s3";
import paymentWebhooksRouter from "./webhooks.payments";
import expediaWebhooksRouter from "./webhooks.expedia.js";

export function registerUploadRoutes(app: Express): void {
  app.use("/uploads/cloudinary", upCld);
  app.use("/api/uploads/cloudinary", upCld);
  app.use("/uploads/s3", upS3);
  app.use("/api/uploads/s3", upS3);
}

export function registerAccountAuthRoutes(app: Express): void {
  app.use("/account", account as RequestHandler);
  app.use("/api/account", account as RequestHandler);
  app.use("/api/auth", authRoutes);
  app.use("/api/auth", agentReportHandoffRouter);
}

export function registerConversationBookingRoutes(app: Express): void {
  app.use("/api/conversations", requireRole() as RequestHandler, conversationsRoutes);
  app.use("/api/bookings", requireRole() as RequestHandler, bookingsRoutes);
}

export function registerPaymentRoutes(app: Express): void {
  app.use("/webhooks/expedia", expediaWebhooksRouter);
  app.use("/webhooks/coralcommerce/card", coralCommerceCardRouter); // Coral callback/postback aliases
  app.use("/webhooks", paymentWebhooksRouter);
  app.use("/api/payments/azampay/disbursement", azampayDisbursementRouter); // Disbursement callback (money OUT)
  app.use("/api/payments/azampay", azampayPaymentsRouter);       // MNO: Airtel, M-Pesa, Mixx, HaloPesa
  app.use("/api/payments/azampay/bank", azampayBankRouter);      // Bank: CRDB, NMB, NBC, etc.
  app.use("/api/payments/azampay/card", azampayCardRouter);      // Card: Visa / Mastercard
  app.use("/api/payments/coralcommerce/card", coralCommerceCardRouter); // Card: CoralCommerce hosted checkout
}

export function registerGeocodingRoute(app: Express): void {
  app.use("/api/geocoding", geocodingRouter as RequestHandler);
}

export function registerFxRoutes(app: Express): void {
  // Display-currency layer (presentation only; TZS is the money of record).
  app.use("/api/fx", fxRouter as RequestHandler);
}

export function registerChatbotRoute(app: Express): void {
  app.use("/api/chatbot", chatbotRouter as RequestHandler);
}

export function registerReportSealRoute(app: Express): void {
  // Any authenticated user (admin, owner, operator) can seal their own printed
  // report. The route enforces login internally.
  app.use("/api/reports", reportSealRouter);
}

export function registerGroupAndReviewRoutes(app: Express): void {
  app.use("/api/group-bookings", requireRole() as RequestHandler, groupBookingsRouter);
  app.use("/api/property-reviews", maybeAuth as RequestHandler, propertyReviewsRouter);
}
