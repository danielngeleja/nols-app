import { type Express, type RequestHandler } from "express";
import requireRole from "../middleware/auth";
import agentAssignmentsRouter from "./agent.assignments";
import agentNotificationsRouter from "./agent.notifications";
import { printTokenRouter } from "./agent.reports";
import nrmsAgentPortalRouter from "./agent.portal";

export function registerAgentRoutes(app: Express): void {
  // NRMS Agent B2B portal — role NRMS_AGENT, guarded inside the router (distinct
  // from the tour-operator AGENT routes below, which this must not fall under).
  app.use("/api/agent-portal", nrmsAgentPortalRouter as RequestHandler);
  app.use("/api/agent/notifications", requireRole("AGENT") as RequestHandler, agentNotificationsRouter as RequestHandler);
  app.use("/api/agent/reports", requireRole("AGENT") as RequestHandler, printTokenRouter as RequestHandler);
  app.use("/api/agent", requireRole("AGENT") as RequestHandler, agentAssignmentsRouter as RequestHandler);
}
