import crypto from "node:crypto";
import { Router, type RequestHandler, type Request, type Response } from "express";
import { enqueueMetaWebhookEvents } from "../lib/nrmsMetaWebhookJobs.js";
import { parseMetaWebhook, verifyMetaWebhookSignature } from "../lib/nrmsMetaMessaging.js";

export const router = Router();

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.get("/", ((req: Request, res: Response) => {
  const expected = String(process.env.META_WEBHOOK_VERIFY_TOKEN || "");
  const mode = String(req.query["hub.mode"] || "");
  const supplied = String(req.query["hub.verify_token"] || "");
  const challenge = String(req.query["hub.challenge"] || "");
  if (!expected || mode !== "subscribe" || !secureEqual(supplied, expected)) return res.sendStatus(403);
  return res.status(200).send(challenge);
}) as RequestHandler);

/** Verify, durably persist, then acknowledge. Processing is asynchronous. */
router.post("/", (async (req: Request, res: Response) => {
  const appSecrets = [...new Set([process.env.META_APP_SECRET, process.env.META_INSTAGRAM_APP_SECRET].map((value) => String(value || "")).filter(Boolean))];
  if (!appSecrets.length) return res.status(503).json({ error: "Meta webhook is not configured" });
  const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}));
  const signature = req.header("x-hub-signature-256");
  if (!appSecrets.some((secret) => verifyMetaWebhookSignature(rawBody, signature, secret))) {
    console.warn(JSON.stringify({ level: "warn", event: "meta_webhook_signature_rejected", signaturePresent: Boolean(signature), timestamp: new Date().toISOString() }));
    return res.sendStatus(401);
  }
  let payload: unknown;
  try { payload = JSON.parse(rawBody.toString("utf8")); }
  catch { return res.status(400).json({ error: "Invalid Meta webhook payload" }); }
  try {
    const events = parseMetaWebhook(payload);
    const result = await enqueueMetaWebhookEvents(events);
    const accountIds = [...new Set(events.map((event) => event.accountId))];
    console.info(JSON.stringify({ level: "info", event: "meta_webhook_received", object: typeof payload === "object" && payload && "object" in payload ? String((payload as { object?: unknown }).object || "unknown") : "unknown", parsedEvents: events.length, acceptedEvents: result.accepted, accountIds, timestamp: new Date().toISOString() }));
    return res.status(202).json({ received: true, accepted: result.accepted, events: events.length });
  } catch (error) {
    console.error("[webhooks.meta] durable enqueue failed", error);
    // Non-2xx deliberately asks Meta to retry; no event is acknowledged before storage.
    return res.status(503).json({ error: "Meta webhook could not be stored" });
  }
}) as RequestHandler);

export default router;
