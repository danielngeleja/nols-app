import { type Express, type RequestHandler } from "express";
import { adminAllowlist } from "../middleware/adminAllowlist";
import requireRole from "../middleware/auth";
import admin2faRouter from "./admin.2fa.js";
import adminAgentsRouter from "./admin.agents";
import adminActionCenterRouter from "./admin.actionCenter";
import adminAuditRetentionRouter from "./admin.auditRetention";
import adminAuditsRouter from "./admin.audits";
import { router as adminEmail } from "./admin.auth.email";
import adminBonusesRouter from "./admin.bonuses";
import adminBookingsRouter from "./admin.bookings";
import adminCancellationsRouter from "./admin.cancellations";
import adminCareersApplicationsRouter from "./admin.careers.applications";
import adminCareersStatsRouter from "./admin.careers.stats";
import { router as adminCareersRouter } from "./admin.careers";
import adminChatbotRouter from "./admin.chatbot";
import adminContractTemplatesRouter from "./admin.contractTemplates";
import adminDriversLevelMessagesRouter from "./admin.drivers.level-messages";
import adminDriversLevelsRouter from "./admin.drivers.levels";
import adminDriversSummaryRouter from "./admin.drivers.summary";
import adminDriversRouter from "./admin.drivers";
import adminDisbursementsRouter from "./admin.disbursements.js";
import adminGroupStaysArrangementsRouter from "./admin.groupStays.arrangements";
import adminGroupStaysAssignmentsRouter from "./admin.groupStays.assignments";
import adminGroupStaysBookingsAuditRouter from "./admin.groupStays.bookings.audit";
import adminGroupStaysBookingsRouter from "./admin.groupStays.bookings";
import adminGroupStaysClaimsRouter from "./admin.groupStays.claims";
import adminGroupStaysPassengersRouter from "./admin.groupStays.passengers";
import adminGroupStaysRecommendationsRouter from "./admin.groupStays.recommendations";
import adminGroupStaysRequestsRouter from "./admin.groupStays.requests";
import adminGroupStaysRevenueRouter from "./admin.groupStays.revenue";
import adminGroupStaysSummaryRouter from "./admin.groupStays.summary";
import adminHelpOwnersRouter from "./admin.helpOwners";
import adminIntegrationsRouter from "./admin.integrations";
import adminLifecycleHealthRouter from "./admin.lifecycleHealth";
import adminInvoicesRouter from "./admin.invoices";
import { router as adminNolScopeRouter } from "./admin.nolscope";
import adminNo4pOtpRouter from "./admin.no4pOtp";
import adminNotificationsRouter from "./admin.notifications";
import adminOwnersRouter from "./admin.owners.js";
import adminObservabilityRouter from "./admin.observability";
import adminPaymentsRouter from "./admin.payments";
import adminPerformanceHighlightsRouter from "./admin.performance.highlights";
import adminPickupPointsRouter from "./admin.pickupPoints";
import adminPlanWithUsRequestsRouter from "./admin.planWithUs.requests";
import adminPlanWithUsSummaryRouter from "./admin.planWithUs.summary";
import adminPodcastsRouter from "./admin.podcasts";
import adminPropertiesRouter from "./admin.properties.js";
import adminReferralEarningsRouter from "./admin.referral-earnings";
import adminReportsRouter from "./admin.reports";
import adminRevenueRouter from "./admin.revenue";
import adminFinanceOverviewRouter from "./admin.financeOverview";
import adminNrmsRouter from "./admin.nrms";
import adminNrmsEnforceRouter from "./admin.nrms.enforce";
import adminNrmsCommercialRouter from "./admin.nrms.commercial.js";
import adminNrmsReconcileRouter from "./admin.nrms.reconcile.js";
import adminNrmsIntegrityRouter from "./admin.nrms.integrity.js";
import adminNrmsSupportRouter from "./admin.nrms.support.js";
import adminNrmsSystemRouter from "./admin.nrms.system.js";
import adminNrmsChannelsRouter from "./admin.nrms.channels.js";
import adminFxRouter from "./admin.fx";
import adminSettingsRouter from "./admin.settings";
import adminStatsRouter from "./admin.stats";
import adminSummaryRouter from "./admin.summary";
import adminTrustPartnersRouter from "./admin.trustPartners";
import adminTourCommerceRouter from "./admin.tourCommerce";
import adminTourExperienceRouter from "./admin.tourExperience";
import adminTourRevenueRouter from "./admin.tourRevenue";
import adminUpdatesRouter from "./admin.updates";
import adminUsersSummaryRouter from "./admin.users.summary";
import adminUsersTransportBookingsRouter from "./admin.users.transportBookings";
import adminUsersRouter from "./admin.users";

export function registerAdminGuards(app: Express): void {
  // Optional but recommended: protect all admin endpoints behind IP allowlist (no-op unless configured).
  app.use("/api/admin", adminAllowlist as RequestHandler);
  app.use("/admin", adminAllowlist as RequestHandler);
}

export function registerAdminPrimaryRoutes(app: Express): void {
  app.use("/admin/bookings", adminBookingsRouter);
  app.use("/api/admin/bookings", adminBookingsRouter as RequestHandler);
  app.use("/admin/invoices", adminInvoicesRouter);
  app.use("/api/admin/invoices", adminInvoicesRouter as RequestHandler);
  app.use("/admin/revenue", adminRevenueRouter);
  app.use("/api/admin/revenue", adminRevenueRouter as RequestHandler);
  app.use("/admin/finance", adminFinanceOverviewRouter);
  app.use("/api/admin/finance", adminFinanceOverviewRouter as RequestHandler);
  app.use("/admin/nrms/enforce", adminNrmsEnforceRouter);
  app.use("/api/admin/nrms/enforce", adminNrmsEnforceRouter as RequestHandler);
  app.use("/admin/nrms/commercial", adminNrmsCommercialRouter);
  app.use("/api/admin/nrms/commercial", adminNrmsCommercialRouter as RequestHandler);
  app.use("/admin/nrms/reconcile", adminNrmsReconcileRouter);
  app.use("/api/admin/nrms/reconcile", adminNrmsReconcileRouter as RequestHandler);
  app.use("/admin/nrms/integrity", adminNrmsIntegrityRouter);
  app.use("/api/admin/nrms/integrity", adminNrmsIntegrityRouter as RequestHandler);
  app.use("/admin/nrms/support", adminNrmsSupportRouter);
  app.use("/api/admin/nrms/support", adminNrmsSupportRouter as RequestHandler);
  app.use("/admin/nrms/system", adminNrmsSystemRouter);
  app.use("/api/admin/nrms/system", adminNrmsSystemRouter as RequestHandler);
  app.use("/admin/nrms/channels", adminNrmsChannelsRouter);
  app.use("/api/admin/nrms/channels", adminNrmsChannelsRouter as RequestHandler);
  app.use("/admin/nrms", adminNrmsRouter);
  app.use("/api/admin/nrms", adminNrmsRouter as RequestHandler);
  app.use("/admin/payments", adminPaymentsRouter);
  app.use("/api/admin/payments", adminPaymentsRouter as RequestHandler);
  app.use("/admin/settings", adminSettingsRouter);
  app.use("/api/admin/settings", adminSettingsRouter as RequestHandler);
  app.use("/admin/fx", adminFxRouter);
  app.use("/api/admin/fx", adminFxRouter as RequestHandler);
  app.use("/admin/drivers/summary", adminDriversSummaryRouter);
  app.use("/api/admin/drivers/summary", adminDriversSummaryRouter as RequestHandler);
  app.use("/admin/drivers/levels", adminDriversLevelsRouter);
  app.use("/api/admin/drivers/levels", adminDriversLevelsRouter as RequestHandler);
  app.use("/api/admin/drivers", adminDriversRouter as RequestHandler);
  app.use("/admin/drivers", adminDriversRouter);
  app.use("/api/admin/disbursements", adminDisbursementsRouter as RequestHandler);
  app.use("/admin/disbursements", adminDisbursementsRouter as RequestHandler);
  app.use("/api/admin/drivers/level-messages", requireRole("ADMIN") as RequestHandler, adminDriversLevelMessagesRouter);
  app.use("/admin/group-stays/summary", adminGroupStaysSummaryRouter);
  app.use("/api/admin/group-stays/summary", adminGroupStaysSummaryRouter);
  app.use("/admin/group-stays/bookings", adminGroupStaysBookingsRouter);
  app.use("/api/admin/group-stays/bookings", adminGroupStaysBookingsRouter);
  app.use("/admin/group-stays/bookings", adminGroupStaysBookingsAuditRouter);
  app.use("/api/admin/group-stays/bookings", adminGroupStaysBookingsAuditRouter);
  app.use("/admin/group-stays/requests", adminGroupStaysRequestsRouter);
  app.use("/api/admin/group-stays/requests", adminGroupStaysRequestsRouter);
  app.use("/admin/group-stays/passengers", adminGroupStaysPassengersRouter);
  app.use("/api/admin/group-stays/passengers", adminGroupStaysPassengersRouter);
  app.use("/admin/group-stays/arrangements", adminGroupStaysArrangementsRouter);
  app.use("/api/admin/group-stays/arrangements", adminGroupStaysArrangementsRouter);
  app.use("/admin/group-stays/recommendations", adminGroupStaysRecommendationsRouter);
  app.use("/api/admin/group-stays/recommendations", adminGroupStaysRecommendationsRouter);
  app.use("/admin/group-stays/assignments", adminGroupStaysAssignmentsRouter);
  app.use("/api/admin/group-stays/assignments", adminGroupStaysAssignmentsRouter);
  app.use("/admin/group-stays/claims", adminGroupStaysClaimsRouter);
  app.use("/api/admin/group-stays/claims", adminGroupStaysClaimsRouter);
  app.use("/admin/group-stays/revenue", adminGroupStaysRevenueRouter);
  app.use("/api/admin/group-stays/revenue", adminGroupStaysRevenueRouter);
  app.use("/admin/plan-with-us/summary", adminPlanWithUsSummaryRouter);
  app.use("/api/admin/plan-with-us/summary", adminPlanWithUsSummaryRouter);
  app.use("/admin/plan-with-us/requests", adminPlanWithUsRequestsRouter);
  app.use("/api/admin/plan-with-us/requests", adminPlanWithUsRequestsRouter);
  app.use("/admin/agents", adminAgentsRouter);
  app.use("/api/admin/agents", adminAgentsRouter);
  app.use("/admin/tour-commerce", adminTourCommerceRouter);
  app.use("/api/admin/tour-commerce", adminTourCommerceRouter as RequestHandler);
  app.use("/admin/tour-experience", adminTourExperienceRouter as RequestHandler);
  app.use("/api/admin/tour-experience", adminTourExperienceRouter as RequestHandler);
  app.use("/admin/agents/tour-revenue", adminTourRevenueRouter as RequestHandler);
  app.use("/api/admin/tour-revenue", adminTourRevenueRouter as RequestHandler);
  app.use("/admin/trust-partners", adminTrustPartnersRouter);
  app.use("/api/admin/trust-partners", adminTrustPartnersRouter as RequestHandler);
  app.use("/admin/stats", adminStatsRouter);
  app.use("/api/admin/stats", adminStatsRouter);
  app.use("/admin/users/summary", adminUsersSummaryRouter);
  app.use("/api/admin/users/summary", adminUsersSummaryRouter as RequestHandler);
  app.use("/admin/users/transport-bookings", adminUsersTransportBookingsRouter);
  app.use("/api/admin/users/transport-bookings", adminUsersTransportBookingsRouter as RequestHandler);
  app.use("/admin/users", adminUsersRouter);
  app.use("/api/admin/users", adminUsersRouter as RequestHandler);
  app.use("/admin/help-owners", adminHelpOwnersRouter);
  app.use("/api/admin/help-owners", adminHelpOwnersRouter as RequestHandler);
  app.use("/admin/bonuses", adminBonusesRouter);
  app.use("/api/admin/bonuses", adminBonusesRouter as RequestHandler);
  app.use("/admin/referral-earnings", adminReferralEarningsRouter);
  app.use("/api/admin/referral-earnings", adminReferralEarningsRouter as RequestHandler);
}

export function registerAdminPostPaymentRoutes(app: Express): void {
  app.use("/admin/owners", adminOwnersRouter);
  app.use("/api/admin/owners", adminOwnersRouter as RequestHandler);
  app.use("/admin/properties", adminPropertiesRouter);
  app.use("/api/admin/properties", adminPropertiesRouter as RequestHandler);
  app.use("/admin/summary", requireRole("ADMIN") as RequestHandler, adminSummaryRouter as RequestHandler);
  app.use("/api/admin/summary", requireRole("ADMIN") as RequestHandler, adminSummaryRouter as RequestHandler);
  app.use("/admin/performance", requireRole("ADMIN") as RequestHandler, adminPerformanceHighlightsRouter as RequestHandler);
  app.use("/api/admin/performance", requireRole("ADMIN") as RequestHandler, adminPerformanceHighlightsRouter as RequestHandler);
  app.use("/api/admin/integrations", adminIntegrationsRouter as RequestHandler);
  app.use("/api/admin/audits", requireRole("ADMIN") as RequestHandler, adminAuditsRouter as RequestHandler);
  app.use("/api/admin/audit-retention", requireRole("ADMIN") as RequestHandler, adminAuditRetentionRouter as RequestHandler);
  app.use("/api/admin/notifications", requireRole("ADMIN") as RequestHandler, adminNotificationsRouter as RequestHandler);
  app.use("/api/admin/observability", requireRole("ADMIN") as RequestHandler, adminObservabilityRouter as RequestHandler);
  app.use("/api/admin/action-center", adminActionCenterRouter as RequestHandler);
  app.use("/api/admin/lifecycle-health", adminLifecycleHealthRouter as RequestHandler);
  app.use("/api/admin/cancellations", requireRole("ADMIN") as RequestHandler, adminCancellationsRouter as RequestHandler);
  app.use("/api/admin/no4p-otp", requireRole("ADMIN") as RequestHandler, adminNo4pOtpRouter as RequestHandler);
  app.use("/api/admin/pickup-points", requireRole("ADMIN") as RequestHandler, adminPickupPointsRouter as RequestHandler);
  app.use("/api/admin/updates", adminUpdatesRouter as RequestHandler);
  app.use("/api/admin/podcasts", adminPodcastsRouter as RequestHandler);
  app.use("/admin/contracts/templates", adminContractTemplatesRouter as RequestHandler);
  app.use("/api/admin/contracts/templates", adminContractTemplatesRouter as RequestHandler);
}

export function registerAdminCareerRoutes(app: Express): void {
  app.use("/admin/careers/applications", adminCareersApplicationsRouter);
  app.use("/api/admin/careers/applications", adminCareersApplicationsRouter as RequestHandler);
  app.use("/admin/careers/stats", adminCareersStatsRouter);
  app.use("/api/admin/careers/stats", adminCareersStatsRouter as RequestHandler);
  app.use("/admin/careers", adminCareersRouter);
  app.use("/api/admin/careers", adminCareersRouter as RequestHandler);
}

export function registerAdminEmailRoute(app: Express): void {
  app.use("/api/admin/email", adminEmail);
}

export function registerAdmin2faRoute(app: Express): void {
  app.use("/admin/2fa", admin2faRouter);
}

export function registerAdminNolScopeRoute(app: Express): void {
  app.use("/api/admin/nolscope", adminNolScopeRouter);
}

export function registerAdminChatbotReportsRoutes(app: Express): void {
  app.use("/api/admin/chatbot", adminChatbotRouter as RequestHandler);
  app.use("/api/admin/reports", adminReportsRouter as RequestHandler);
}
