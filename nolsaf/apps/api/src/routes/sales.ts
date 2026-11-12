// Sales Partner Workspace route registration.
//
// Partner routes gate on the workspace entitlement inside each router; admin
// routes gate on requireRole("ADMIN") plus blockImpersonated. Nothing here
// depends on User.role carrying a sales value, because it never does.
//
// See docs/SALES_PARTNER_WORKSPACE.md section 10.
import { type Express, type RequestHandler } from "express";
import adminSalesPartnersRouter from "./admin.sales.partners.js";
import adminSalesAttributionsRouter from "./admin.sales.attributions.js";
import adminSalesFinanceRouter from "./admin.sales.finance.js";
import salesContractsRouter from "./sales.contracts.js";
import salesLeadsRouter from "./sales.leads.js";
import salesVisitsRouter from "./sales.visits.js";
import salesCardRouter from "./sales.card.js";
import salesLeaderboardRouter from "./sales.leaderboard.js";
import salesTeamRouter from "./sales.team.js";
import adminSalesTeamsRouter from "./admin.sales.teams.js";
import salesPropertiesRouter from "./sales.properties.js";
import { adminSalesMaterialsRouter, salesMaterialsRouter } from "./sales.materials.js";
import salesEarningsRouter from "./sales.earnings.js";
import salesPayoutsRouter from "./sales.payouts.js";
import salesWorkspaceRouter from "./sales.workspace.js";
import salesStatementsRouter from "./sales.statements.js";
import salesJoinRouter from "./sales.join.js";
import salesAgencyRouter from "./sales.agency.js";
import salesAgencyGroupsRouter from "./sales.agency.groups.js";
import salesAgencyToursRouter from "./sales.agency.tours.js";
import agencyGroupConfirmRouter from "./agency.groupConfirm.js";
import adminSalesAgencyRouter from "./admin.sales.agency.js";

export function registerSalesRoutes(app: Express): void {
  // Workspace discovery and selection live under /api/me/* because they are
  // account-level concerns, not sales-specific ones: a user with no sales
  // access still calls /api/me/workspaces and simply gets one workspace back.
  app.use("/api", salesWorkspaceRouter as RequestHandler);
  // A team invite's recruit is not a partner yet, so this sits outside /api/sales.
  app.use("/api/sales-join", salesJoinRouter as RequestHandler);
  app.use("/api/sales", salesContractsRouter as RequestHandler);
  app.use("/api/sales", salesLeadsRouter as RequestHandler);
  app.use("/api/sales", salesVisitsRouter as RequestHandler);
  app.use("/api/sales", salesCardRouter as RequestHandler);
  // Leaderboard first: it answers /team/status for every partner, before the
  // team router, which admits team leads only.
  app.use("/api/sales", salesLeaderboardRouter as RequestHandler);
  app.use("/api/sales", salesTeamRouter as RequestHandler);
  app.use("/api/sales", salesPropertiesRouter as RequestHandler);
  app.use("/api/sales", salesMaterialsRouter as RequestHandler);
  app.use("/api/sales", salesEarningsRouter as RequestHandler);
  app.use("/api/sales", salesPayoutsRouter as RequestHandler);
  app.use("/api/sales", salesStatementsRouter as RequestHandler);
  // Agency Desk: admin-granted only, 404 to everyone else (see sales.agency.ts).
  app.use("/api/sales", salesAgencyRouter as RequestHandler);
  app.use("/api/sales", salesAgencyGroupsRouter as RequestHandler);
  app.use("/api/sales", salesAgencyToursRouter as RequestHandler);
  // The client confirming a partner's group request: any signed-in customer, phone must match.
  app.use("/api/agency-group", agencyGroupConfirmRouter as RequestHandler);

  app.use("/admin/sales", adminSalesPartnersRouter);
  app.use("/admin/sales", adminSalesAttributionsRouter);
  app.use("/admin/sales", adminSalesMaterialsRouter);
  app.use("/admin/sales", adminSalesFinanceRouter);
  app.use("/api/admin/sales", adminSalesPartnersRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesAttributionsRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesMaterialsRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesFinanceRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesTeamsRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesAgencyRouter as RequestHandler);
}
