import { type Express, type RequestHandler } from "express";
import requireRole from "../middleware/auth";
import { requireApprovedDriver } from "../middleware/requireApprovedDriver.js";
import driverBonusRouter from "./driver.bonus";
import driverLicenseRouter from "./driver.license";
import driverMatchingRouter from "./driver.matching";
import driverMessagesRouter from "./driver.messages";
import driverNotificationsRouter from "./driver.notifications";
import driverPerformanceRouter from "./driver.performance";
import { router as driverProfileRouter } from "./driver.profile";
import driverReferralEarningsRouter from "./driver.referral-earnings";
import driverReferralPerformanceRouter from "./driver.referral-performance";
import driverReferralRouter from "./driver.referral";
import driverRemindersRouter from "./driver.reminders";
import driverScheduledRouter from "./driver.scheduled";
import driverRouter from "./driver.stats";
import driverLevelRouter from "./driver.level";
import driverPushDevicesRouter from "./driver.pushDevices";

export function registerDriverRoutes(app: Express): void {
  // Driver profile update must be mounted BEFORE the catch-all "/api/driver" mount.
  app.use("/api/driver/profile", requireRole("DRIVER") as RequestHandler, driverProfileRouter as RequestHandler);
  app.use("/api/driver/push-devices", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverPushDevicesRouter as RequestHandler);
  app.use("/api/driver", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverRouter as RequestHandler);
  app.use("/api/driver/reminders", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverRemindersRouter as RequestHandler);
  app.use("/api/driver/bonus", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverBonusRouter as RequestHandler);
  app.use("/api/driver/level", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverLevelRouter as RequestHandler);
  app.use("/api/driver/referral", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverReferralRouter as RequestHandler);
  app.use("/api/driver/referral-earnings", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverReferralEarningsRouter as RequestHandler);
  app.use("/api/driver/referral/performance", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverReferralPerformanceRouter as RequestHandler);
  app.use("/api/driver/messages", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverMessagesRouter as RequestHandler);
  app.use("/api/driver/matching", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverMatchingRouter as RequestHandler);
  app.use("/api/driver/performance", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverPerformanceRouter as RequestHandler);
  app.use("/api/driver/notifications", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverNotificationsRouter as RequestHandler);
  app.use("/api/driver/license", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverLicenseRouter as RequestHandler);
  app.use("/api/driver/trips", requireRole("DRIVER") as RequestHandler, requireApprovedDriver as RequestHandler, driverScheduledRouter as RequestHandler);
}
