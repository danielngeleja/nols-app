import { type Express } from "express";
import {
  registerAdminCareerRoutes,
  registerAdmin2faRoute,
  registerAdminChatbotReportsRoutes,
  registerAdminEmailRoute,
  registerAdminGuards,
  registerAdminNolScopeRoute,
  registerAdminPostPaymentRoutes,
  registerAdminPrimaryRoutes,
} from "./admin";
import { registerAgentRoutes } from "./agent";
import { registerCustomerRoutes } from "./customer";
import { registerDriverRoutes } from "./driver";
import {
  registerOwnerBookingRoutes,
  registerOwnerBusinessRoutes,
  registerOwnerContactRoutes,
  registerOwnerPropertyRoutes,
  registerOwnerReportsRoute,
} from "./owner";
import {
  registerAccountAuthRoutes,
  registerChatbotRoute,
  registerConversationBookingRoutes,
  registerFxRoutes,
  registerGeocodingRoute,
  registerGroupAndReviewRoutes,
  registerPaymentRoutes,
  registerReportSealRoute,
  registerUploadRoutes,
} from "./platform";
import {
  registerPublicAvailabilityRoute,
  registerPublicCareerRoutes,
  registerPublicContentRoutes,
  registerPublicEmailVerifyRoute,
  registerPublicPlanRequestRoute,
} from "./public";
import { registerSalesRoutes } from "./sales";
import { registerEarlyRoutes, registerFallbackHandlers, registerRouteBodyParsers } from "./system";
import { registerTransportRoutes } from "./transport";

export { registerEarlyRoutes, registerFallbackHandlers, registerRouteBodyParsers };

export function registerApiRoutes(app: Express): void {
  // Keep this sequence behavior-preserving. Express route order matters.
  registerUploadRoutes(app);
  registerOwnerPropertyRoutes(app);
  registerAccountAuthRoutes(app);
  registerPublicEmailVerifyRoute(app);
  registerOwnerReportsRoute(app);
  registerAdminGuards(app);
  registerConversationBookingRoutes(app);
  registerAdminPrimaryRoutes(app);
  registerPaymentRoutes(app);
  registerAdminPostPaymentRoutes(app);
  registerAdminCareerRoutes(app);
  registerPublicCareerRoutes(app);
  registerOwnerBusinessRoutes(app);
  registerAdminEmailRoute(app);
  registerDriverRoutes(app);
  registerOwnerContactRoutes(app);
  registerAdmin2faRoute(app);
  registerOwnerBookingRoutes(app);
  registerPublicContentRoutes(app);
  registerAdminNolScopeRoute(app);
  registerPublicPlanRequestRoute(app);
  registerCustomerRoutes(app);
  registerAgentRoutes(app);
  registerTransportRoutes(app);
  registerGeocodingRoute(app);
  registerFxRoutes(app);
  registerPublicAvailabilityRoute(app);
  registerChatbotRoute(app);
  registerReportSealRoute(app);
  registerAdminChatbotReportsRoutes(app);
  registerGroupAndReviewRoutes(app);
  registerSalesRoutes(app);
}
