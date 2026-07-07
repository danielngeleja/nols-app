import { Router } from "express";
import jwt from "jsonwebtoken";
import { AuthedRequest, requireAuth } from "../middleware/auth.js";
import { setAuthCookie, signUserJwt } from "../lib/sessionManager.js";
import { prisma } from "@nolsaf/prisma";

const JWT_SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV !== "production"
    ? (process.env.DEV_JWT_SECRET || "dev_jwt_secret")
    : "");

const PRINT_TOKEN_EXPIRY_SEC = 300;

export const printTokenRouter = Router();

printTokenRouter.post("/print-token", requireAuth as any, async (req: any, res) => {
  try {
    const user = (req as AuthedRequest).user;
    if (!user?.id) return res.status(401).json({ ok: false, error: "Unauthorized" });

    const token = jwt.sign(
      {
        sub: String(user.id),
        role: "AGENT",
        purpose: "agent-report-print",
        iat: Math.floor(Date.now() / 1000),
      },
      JWT_SECRET,
      { expiresIn: PRINT_TOKEN_EXPIRY_SEC }
    );

    return res.json({ ok: true, token, expiresInSeconds: PRINT_TOKEN_EXPIRY_SEC });
  } catch (err: any) {
    console.error("POST /api/agent/reports/print-token error:", err?.message || err);
    return res.status(500).json({ ok: false, error: "Failed to generate print token" });
  }
});

export const handoffRouter = Router();

handoffRouter.get("/agent-report-print-handoff", async (req: any, res) => {
  try {
    const printToken = String(req.query.token || "");
    const next = String(req.query.next || "/account/agent/reports");

    if (!printToken) return res.status(400).send("Missing token");

    let payload: any;
    try {
      payload = jwt.verify(printToken, JWT_SECRET);
    } catch {
      return res.status(401).send("Invalid or expired print token");
    }

    if (payload.purpose !== "agent-report-print") {
      return res.status(403).send("Invalid token purpose");
    }

    const userId = Number(payload.sub);
    if (!userId || !Number.isFinite(userId)) {
      return res.status(401).send("Invalid token subject");
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, email: true },
    });

    if (!user || String(user.role).toUpperCase() !== "AGENT") {
      return res.status(403).send("User is not an agent");
    }

    const sessionToken = await signUserJwt({ id: user.id, role: user.role, email: user.email });
    await setAuthCookie(res, sessionToken, user.role);

    const safePath = next.startsWith("/") ? next : "/account/agent/reports";
    return res.redirect(302, safePath);
  } catch (err: any) {
    console.error("GET /api/auth/agent-report-print-handoff error:", err?.message || err);
    return res.status(500).send("Handoff failed");
  }
});
