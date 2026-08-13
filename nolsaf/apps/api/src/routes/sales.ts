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
import salesPropertiesRouter from "./sales.properties.js";
import { adminSalesMaterialsRouter, salesMaterialsRouter } from "./sales.materials.js";
import salesEarningsRouter from "./sales.earnings.js";
import salesPayoutsRouter from "./sales.payouts.js";
import salesWorkspaceRouter from "./sales.workspace.js";

export function registerSalesRoutes(app: Express): void {
  // Workspace discovery and selection live under /api/me/* because they are
  // account-level concerns, not sales-specific ones: a user with no sales
  // access still calls /api/me/workspaces and simply gets one workspace back.
  app.use("/api", salesWorkspaceRouter as RequestHandler);
  app.use("/api/sales", salesContractsRouter as RequestHandler);
  app.use("/api/sales", salesLeadsRouter as RequestHandler);
  app.use("/api/sales", salesPropertiesRouter as RequestHandler);
  app.use("/api/sales", salesMaterialsRouter as RequestHandler);
  app.use("/api/sales", salesEarningsRouter as RequestHandler);
  app.use("/api/sales", salesPayoutsRouter as RequestHandler);

  app.use("/admin/sales", adminSalesPartnersRouter);
  app.use("/admin/sales", adminSalesAttributionsRouter);
  app.use("/admin/sales", adminSalesMaterialsRouter);
  app.use("/admin/sales", adminSalesFinanceRouter);
  app.use("/api/admin/sales", adminSalesPartnersRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesAttributionsRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesMaterialsRouter as RequestHandler);
  app.use("/api/admin/sales", adminSalesFinanceRouter as RequestHandler);
}
