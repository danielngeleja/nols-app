import { Router, type RequestHandler, type Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { loadNrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { instagramOAuthConfig, signNrmsMetaOAuthState } from "../lib/nrmsMetaOAuth.js";
import { decrypt, encrypt } from "../lib/crypto.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

async function access(req: AuthedRequest, res: Response, propertyId: number) {
  return loadNrmsPropertyAccess(req, res, propertyId, ["OWNER", "MANAGER"]);
}

const publicConnection = (connection: any) => connection ? {
  provider: connection.provider,
  status: connection.provider === "WHATSAPP" && connection.status === "CONNECTED" && !connection.metadata?.phoneRegisteredAt ? "PENDING" : connection.status,
  displayName: connection.displayName,
  externalAccountId: connection.externalAccountId,
  phoneRegistrationComplete: connection.provider === "WHATSAPP" ? Boolean(connection.metadata?.phoneRegisteredAt) : null,
  tokenExpiresAt: connection.tokenExpiresAt,
  webhookSubscribedAt: connection.webhookSubscribedAt,
  lastWebhookAt: connection.lastWebhookAt,
  lastOutboundAt: connection.lastOutboundAt,
  lastError: connection.lastError,
  version: connection.version,
} : null;

async function metaJson(response: globalThis.Response) {
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok || body.error) throw new Error(String(body.error?.message || `Meta request failed (${response.status})`));
  return body;
}

type DiagnosticStatus = "PASS" | "WARN" | "FAIL";
type DiagnosticCheck = { id: string; label: string; status: DiagnosticStatus; detail: string };

function diagnosticCheck(id: string, label: string, status: DiagnosticStatus, detail: string): DiagnosticCheck {
  return { id, label, status, detail };
}

function safeDiagnosticError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || "Unknown error").slice(0, 300);
}

function workerExpectedToRun(): boolean {
  const configured = String(process.env.RUN_BACKGROUND_WORKERS || "").trim().toLowerCase();
  return configured ? ["1", "true", "yes", "on"].includes(configured) : process.env.NODE_ENV === "production";
}

router.get("/property/:propertyId", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const connections = await prisma.nrmsMessagingConnection.findMany({ where: { propertyId }, orderBy: { provider: "asc" } });
  res.json({
    connections: connections.map(publicConnection),
    readiness: {
      instagramOAuthConfigured: Boolean(instagramOAuthConfig().appId && instagramOAuthConfig().appSecret && instagramOAuthConfig().redirectUri),
      whatsappEmbeddedSignupConfigured: Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_WHATSAPP_CONFIG_ID),
      webhookConfigured: Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN),
      whatsappAppId: process.env.META_APP_ID || null,
      whatsappConfigId: process.env.META_WHATSAPP_CONFIG_ID || null,
      graphVersion: process.env.META_GRAPH_API_VERSION || "v23.0",
    },
  });
}) as RequestHandler);

/**
 * Performs a live, property-scoped WhatsApp diagnostic without returning any
 * access token or secret. Unlike the lightweight readiness badges, this route
 * verifies Meta and the asynchronous ingestion path independently.
 */
router.post("/property/:propertyId/whatsapp/diagnose", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const checkedAt = new Date();
  const checks: DiagnosticCheck[] = [];
  const graphVersion = String(process.env.META_GRAPH_API_VERSION || "v23.0");
  const appId = String(process.env.META_APP_ID || "");
  const appSecret = String(process.env.META_APP_SECRET || "");
  const verifyTokenConfigured = Boolean(process.env.META_WEBHOOK_VERIFY_TOKEN);
  const connection = await prisma.nrmsMessagingConnection.findFirst({ where: { propertyId, provider: "WHATSAPP" } });

  checks.push(diagnosticCheck(
    "server_configuration",
    "NoLSAF server configuration",
    appId && appSecret && verifyTokenConfigured ? "PASS" : "FAIL",
    appId && appSecret && verifyTokenConfigured ? "App credentials and webhook verification token are configured." : "META_APP_ID, META_APP_SECRET or META_WEBHOOK_VERIFY_TOKEN is missing.",
  ));
  checks.push(diagnosticCheck(
    "connection_record",
    "Property connection",
    connection?.status === "CONNECTED" && Boolean(connection.phoneNumberId && connection.externalBusinessId && connection.accessTokenEncrypted) ? "PASS" : "FAIL",
    connection?.status === "CONNECTED" ? "The property has a connected WhatsApp account and stored business assets." : "This property does not have a complete connected WhatsApp account.",
  ));

  let appWebhookVerified = false;
  let wabaSubscribed = false;
  let phoneAccessible = false;
  let reportedCallback: string | null = null;

  if (appId && appSecret) {
    try {
      const appToken = await metaJson(await fetch("https://graph.facebook.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "client_credentials" }).toString(),
        signal: AbortSignal.timeout(8_000),
      }));
      const subscriptions = await metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/${appId}/subscriptions`, {
        headers: { Authorization: `Bearer ${String(appToken.access_token || "")}` },
        signal: AbortSignal.timeout(8_000),
      }));
      const whatsappSubscription = (Array.isArray(subscriptions.data) ? subscriptions.data : []).find((item: any) => item?.object === "whatsapp_business_account");
      const fields = Array.isArray(whatsappSubscription?.fields) ? whatsappSubscription.fields.map((field: any) => String(field?.name || field)) : [];
      reportedCallback = whatsappSubscription?.callback_url ? String(whatsappSubscription.callback_url) : null;
      appWebhookVerified = Boolean(whatsappSubscription && whatsappSubscription.active !== false && fields.includes("messages") && reportedCallback);
      checks.push(diagnosticCheck(
        "app_webhook",
        "Meta app messages webhook",
        appWebhookVerified ? "PASS" : "FAIL",
        !whatsappSubscription ? "The Meta app has no whatsapp_business_account webhook subscription." : !fields.includes("messages") ? "The Meta app webhook is not subscribed to the messages field." : !reportedCallback ? "The Meta app has no webhook callback URL." : whatsappSubscription.active === false ? "The Meta app webhook subscription is inactive." : `Meta reports an active messages webhook at ${reportedCallback}.`,
      ));
    } catch (error) {
      checks.push(diagnosticCheck("app_webhook", "Meta app messages webhook", "FAIL", `Meta could not verify the app webhook: ${safeDiagnosticError(error)}`));
    }
  } else {
    checks.push(diagnosticCheck("app_webhook", "Meta app messages webhook", "FAIL", "App credentials are unavailable, so Meta could not be queried."));
  }

  if (connection?.externalBusinessId && connection.phoneNumberId && connection.accessTokenEncrypted) {
    try {
      const accessToken = decrypt(connection.accessTokenEncrypted, { log: false });
      const [subscriptions, phones] = await Promise.all([
        metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/${connection.externalBusinessId}/subscribed_apps`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8_000) })),
        metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/${connection.externalBusinessId}/phone_numbers?fields=id,display_phone_number,verified_name`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8_000) })),
      ]);
      const subscription = (Array.isArray(subscriptions.data) ? subscriptions.data : []).find((item: any) => String(item?.whatsapp_business_api_data?.id || item?.id || "") === appId);
      wabaSubscribed = Boolean(subscription);
      const overrideCallback = subscription?.override_callback_uri ? String(subscription.override_callback_uri) : null;
      phoneAccessible = (Array.isArray(phones.data) ? phones.data : []).some((phone: any) => String(phone?.id || "") === String(connection.phoneNumberId));
      checks.push(diagnosticCheck("waba_subscription", "WhatsApp Business Account subscription", wabaSubscribed ? "PASS" : "FAIL", wabaSubscribed ? `The NoLSAF Meta app is subscribed to this WABA${overrideCallback ? ` with callback ${overrideCallback}` : ""}.` : "The NoLSAF Meta app is not present in this WABA's subscribed apps."));
      checks.push(diagnosticCheck("phone_access", "WhatsApp phone access", phoneAccessible ? "PASS" : "FAIL", phoneAccessible ? "Meta confirms the connected phone belongs to this WABA and the token can access it." : "The connected phone ID is not accessible with the stored WABA token."));
    } catch (error) {
      const detail = safeDiagnosticError(error);
      checks.push(diagnosticCheck("waba_subscription", "WhatsApp Business Account subscription", "FAIL", `Meta could not verify the WABA subscription: ${detail}`));
      checks.push(diagnosticCheck("phone_access", "WhatsApp phone access", "FAIL", `Meta could not verify the connected phone: ${detail}`));
    }
  } else {
    checks.push(diagnosticCheck("waba_subscription", "WhatsApp Business Account subscription", "FAIL", "The stored connection is missing its WABA ID, phone ID or encrypted token."));
    checks.push(diagnosticCheck("phone_access", "WhatsApp phone access", "FAIL", "The stored connection is incomplete."));
  }

  let workerHealthy = false;
  let queueHealthy = false;
  let lastJob: any = null;
  let lastInbound: any = null;
  try {
    const accountId = String(connection?.phoneNumberId || "");
    const [worker, webhookJob, inbound] = await Promise.all([
      prisma.nrmsWorkerHealth.findUnique({ where: { worker: "meta-messaging" } }),
      prisma.nrmsMetaWebhookJob.findFirst({ where: { OR: [{ propertyId }, ...(accountId ? [{ provider: "WHATSAPP", accountId }] : [])] }, orderBy: { createdAt: "desc" }, select: { status: true, lastError: true, createdAt: true, completedAt: true } }),
      prisma.nrmsGuestMessage.findFirst({ where: { direction: "INBOUND", channel: "WHATSAPP", inquiry: { propertyId } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    lastJob = webhookJob;
    lastInbound = inbound;
    const lastSuccessAt = worker?.lastSuccessAt ? new Date(worker.lastSuccessAt) : null;
    const workerStateHealthy = worker?.status === "HEALTHY" || worker?.status === "RUNNING";
    workerHealthy = Boolean(workerExpectedToRun() && workerStateHealthy && lastSuccessAt && checkedAt.getTime() - lastSuccessAt.getTime() < 120_000);
    checks.push(diagnosticCheck("worker", "NoLSAF webhook processor", workerHealthy ? "PASS" : "FAIL", !workerExpectedToRun() ? "RUN_BACKGROUND_WORKERS is disabled on this service." : !worker ? "The meta-messaging worker has never reported health." : workerHealthy ? `The worker is ${worker.status.toLowerCase()} and last completed successfully at ${lastSuccessAt?.toISOString()}.` : `The worker is ${worker.status}; last success was ${lastSuccessAt?.toISOString() || "never"}${worker.lastError ? ` (${String(worker.lastError).slice(0, 180)})` : ""}.`));
    queueHealthy = webhookJob?.status === "COMPLETED";
    checks.push(diagnosticCheck("webhook_queue", "Durable webhook queue", !webhookJob ? "WARN" : webhookJob.status === "DEAD" ? "FAIL" : webhookJob.status !== "COMPLETED" ? "WARN" : "PASS", !webhookJob ? "No WhatsApp webhook event has reached the durable queue for this property yet." : webhookJob.status === "COMPLETED" ? `The latest webhook event was processed successfully at ${webhookJob.completedAt?.toISOString() || webhookJob.createdAt.toISOString()}.` : `The latest webhook event is ${webhookJob.status}${webhookJob.lastError ? `: ${String(webhookJob.lastError).slice(0, 180)}` : "."}`));
    checks.push(diagnosticCheck("inbound_storage", "Reception inquiry storage", inbound ? "PASS" : "WARN", inbound ? `The latest stored inbound WhatsApp message arrived at ${inbound.createdAt.toISOString()}.` : "No inbound WhatsApp message has been stored for this property."));
  } catch (error) {
    const detail = safeDiagnosticError(error);
    checks.push(diagnosticCheck("worker", "NoLSAF webhook processor", "FAIL", `Worker health could not be read: ${detail}`));
    checks.push(diagnosticCheck("webhook_queue", "Durable webhook queue", "FAIL", `The webhook queue could not be queried. Confirm the latest Prisma migration: ${detail}`));
    checks.push(diagnosticCheck("inbound_storage", "Reception inquiry storage", "FAIL", "Inbound storage could not be verified because the database diagnostic failed."));
  }

  const failedIds = checks.filter((check) => check.status === "FAIL").map((check) => check.id);
  const verdict = failedIds.some((id) => ["server_configuration", "connection_record", "app_webhook", "waba_subscription", "phone_access"].includes(id))
    ? "CONFIGURATION_BROKEN"
    : failedIds.some((id) => ["worker", "webhook_queue", "inbound_storage"].includes(id))
      ? "PROCESSING_BROKEN"
      : !connection?.lastWebhookAt && !lastJob
        ? "AWAITING_META_WEBHOOK"
        : workerHealthy && queueHealthy && lastInbound
          ? "HEALTHY"
          : "ATTENTION_REQUIRED";

  res.json({
    diagnostic: {
      provider: "WHATSAPP",
      propertyId,
      checkedAt: checkedAt.toISOString(),
      verdict,
      checks,
      evidence: {
        reportedCallback,
        lastWebhookAt: connection?.lastWebhookAt ?? null,
        latestWebhookJobStatus: lastJob?.status ?? null,
        latestInboundAt: lastInbound?.createdAt ?? null,
      },
    },
  });
}) as RequestHandler);

const whatsappConnectSchema = z.object({
  code: z.string().trim().min(8).max(4000),
  wabaId: z.string().trim().regex(/^\d+$/).max(191),
  phoneNumberId: z.string().trim().regex(/^\d+$/).max(191),
  pin: z.string().trim().regex(/^\d{6}$/, "A six-digit WhatsApp registration PIN is required"),
});
const whatsappRegistrationSchema = z.object({ pin: z.string().trim().regex(/^\d{6}$/, "A six-digit WhatsApp registration PIN is required") });

async function registerWhatsAppPhone(graphVersion: string, phoneNumberId: string, accessToken: string, pin: string) {
  return metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/${phoneNumberId}/register`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", pin }),
  }));
}

router.post("/property/:propertyId/whatsapp/connect", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const parsed = whatsappConnectSchema.safeParse(req.body ?? {}); if (!parsed.success) return res.status(400).json({ error: "WhatsApp signup did not return valid business assets" });
  const appId = String(process.env.META_APP_ID || ""); const appSecret = String(process.env.META_APP_SECRET || ""); const graphVersion = String(process.env.META_GRAPH_API_VERSION || "v23.0");
  if (!appId || !appSecret || !process.env.META_WHATSAPP_CONFIG_ID) return res.status(503).json({ error: "WhatsApp Embedded Signup is not configured for this environment", code: "META_WHATSAPP_SIGNUP_NOT_CONFIGURED" });
  try {
    const tokenQuery = new URLSearchParams({ client_id: appId, client_secret: appSecret, code: parsed.data.code });
    const token = await metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/oauth/access_token?${tokenQuery.toString()}`));
    const accessToken = String(token.access_token || ""); if (!accessToken) throw new Error("Meta did not return a WhatsApp access token");
    const phoneQuery = new URLSearchParams({ fields: "id,display_phone_number,verified_name", access_token: accessToken });
    const phones = await metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/${parsed.data.wabaId}/phone_numbers?${phoneQuery.toString()}`));
    const phone = Array.isArray(phones.data) ? phones.data.find((item: any) => String(item.id) === parsed.data.phoneNumberId) : null;
    if (!phone) return res.status(400).json({ error: "The selected WhatsApp phone number does not belong to the selected business account" });
    try {
      await registerWhatsAppPhone(graphVersion, parsed.data.phoneNumberId, accessToken, parsed.data.pin);
    } catch (registrationError) {
      console.error("[owner.nrms.messaging] WhatsApp phone registration failed", registrationError);
      return res.status(502).json({ error: "Meta could not register this phone number. Confirm the six-digit PIN or restart WhatsApp setup.", code: "WHATSAPP_PHONE_REGISTRATION_FAILED" });
    }
    const subscribeQuery = new URLSearchParams({ access_token: accessToken });
    const subscription = await metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/${parsed.data.wabaId}/subscribed_apps?${subscribeQuery.toString()}`, { method: "POST" }));
    if (subscription.success === false) throw new Error("WhatsApp webhook subscription was rejected");
    const expiresIn = Number(token.expires_in || 0);
    const connection = await prisma.nrmsMessagingConnection.upsert({
      where: { propertyId_provider: { propertyId, provider: "WHATSAPP" } },
      update: { ownerId: allowed.ownerId, status: "CONNECTED", externalBusinessId: parsed.data.wabaId, externalAccountId: parsed.data.wabaId, phoneNumberId: parsed.data.phoneNumberId, displayName: String(phone.verified_name || phone.display_phone_number || "WhatsApp Business"), accessTokenEncrypted: encrypt(accessToken), tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null, ...(token.scope ? { scopes: String(token.scope).split(",") } : {}), metadata: { phoneRegisteredAt: new Date().toISOString() }, webhookSubscribedAt: new Date(), lastError: null, version: { increment: 1 } },
      create: { propertyId, ownerId: allowed.ownerId, provider: "WHATSAPP", status: "CONNECTED", externalBusinessId: parsed.data.wabaId, externalAccountId: parsed.data.wabaId, phoneNumberId: parsed.data.phoneNumberId, displayName: String(phone.verified_name || phone.display_phone_number || "WhatsApp Business"), accessTokenEncrypted: encrypt(accessToken), tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null, ...(token.scope ? { scopes: String(token.scope).split(",") } : {}), metadata: { phoneRegisteredAt: new Date().toISOString() }, webhookSubscribedAt: new Date() },
    });
    res.status(201).json({ connection: publicConnection(connection) });
  } catch (error) {
    console.error("[owner.nrms.messaging] WhatsApp connection failed", error);
    const prismaCode = typeof error === "object" && error && "code" in error ? String((error as any).code) : "";
    res.status(prismaCode === "P2002" ? 409 : 502).json({ error: prismaCode === "P2002" ? "This WhatsApp Business account is already connected to another property" : "WhatsApp connection could not be verified" });
  }
}) as RequestHandler);

router.post("/property/:propertyId/whatsapp/register", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const parsed = whatsappRegistrationSchema.safeParse(req.body ?? {}); if (!parsed.success) return res.status(400).json({ error: "Enter a valid six-digit WhatsApp registration PIN" });
  const connection = await prisma.nrmsMessagingConnection.findFirst({ where: { propertyId, provider: "WHATSAPP", status: { in: ["PENDING", "CONNECTED", "ERROR"] } } });
  if (!connection?.phoneNumberId || !connection.accessTokenEncrypted) return res.status(409).json({ error: "Reconnect the WhatsApp account before registering its phone number", code: "WHATSAPP_RECONNECT_REQUIRED" });
  try {
    const accessToken = decrypt(connection.accessTokenEncrypted, { log: false });
    await registerWhatsAppPhone(String(process.env.META_GRAPH_API_VERSION || "v23.0"), connection.phoneNumberId, accessToken, parsed.data.pin);
    const existingMetadata = connection.metadata && typeof connection.metadata === "object" && !Array.isArray(connection.metadata) ? connection.metadata as Record<string, unknown> : {};
    const updated = await prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { status: "CONNECTED", metadata: { ...existingMetadata, phoneRegisteredAt: new Date().toISOString() }, lastError: null, version: { increment: 1 } } });
    res.json({ connection: publicConnection(updated) });
  } catch (error) {
    console.error("[owner.nrms.messaging] WhatsApp phone registration failed", error);
    await prisma.nrmsMessagingConnection.update({ where: { id: connection.id }, data: { status: "PENDING", lastError: "WhatsApp phone registration was not completed", version: { increment: 1 } } }).catch(() => undefined);
    res.status(502).json({ error: "Meta could not register this phone number. Confirm the six-digit PIN or restart WhatsApp setup.", code: "WHATSAPP_PHONE_REGISTRATION_FAILED" });
  }
}) as RequestHandler);

router.post("/property/:propertyId/instagram/connect", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const config = instagramOAuthConfig();
  if (!config.appId || !config.appSecret || !config.redirectUri) return res.status(503).json({ error: "Instagram OAuth is not configured for this environment", code: "META_INSTAGRAM_OAUTH_NOT_CONFIGURED" });
  const state = signNrmsMetaOAuthState({ propertyId, ownerId: allowed.ownerId, actorId: allowed.actorId, provider: "INSTAGRAM" });
  const query = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: config.redirectUri,
    response_type: "code",
    scope: "instagram_business_basic,instagram_business_manage_messages",
    state,
    enable_fb_login: "0",
    force_authentication: "1",
  });
  res.json({ authorizeUrl: `https://www.instagram.com/oauth/authorize?${query.toString()}` });
}) as RequestHandler);

router.post("/property/:propertyId/:provider/disconnect", (async (req: AuthedRequest, res: Response) => {
  const propertyId = Number(req.params.propertyId); const allowed = await access(req, res, propertyId); if (!allowed) return;
  const provider = String(req.params.provider || "").toUpperCase();
  if (!['INSTAGRAM', 'WHATSAPP'].includes(provider)) return res.status(400).json({ error: "Unsupported messaging provider" });
  await prisma.nrmsMessagingConnection.updateMany({
    where: { propertyId, provider },
    data: { status: "DISCONNECTED", externalBusinessId: null, externalAccountId: null, phoneNumberId: null, accessTokenEncrypted: null, tokenExpiresAt: null, webhookSubscribedAt: null, lastError: null, version: { increment: 1 } },
  });
  res.json({ disconnected: true });
}) as RequestHandler);

export default router;
