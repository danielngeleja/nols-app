import { type Express, type RequestHandler } from "express";
import requireRole from "../middleware/auth";
import agentAssignmentsRouter from "./agent.assignments";
import agentNotificationsRouter from "./agent.notifications";
import { printTokenRouter } from "./agent.reports";

export function registerAgentRoutes(app: Express): void {
  app.use("/api/agent/notifications", requireRole("AGENT") as RequestHandler, agentNotificationsRouter as RequestHandler);
  app.use("/api/agent/reports", requireRole("AGENT") as RequestHandler, printTokenRouter as RequestHandler);
  app.use("/api/agent", requireRole("AGENT") as RequestHandler, agentAssignmentsRouter as RequestHandler);
}
