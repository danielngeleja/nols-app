import { Router, type RequestHandler, type Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { z } from "zod";
import { requireAuth, type AuthedRequest } from "../middleware/auth.js";
import { loadNrmsPropertyAccess } from "../lib/nrmsPropertyAccess.js";
import { instagramOAuthConfig, signNrmsMetaOAuthState } from "../lib/nrmsMetaOAuth.js";
import { encrypt } from "../lib/crypto.js";

export const router = Router();
router.use(requireAuth as RequestHandler);

async function access(req: AuthedRequest, res: Response, propertyId: number) {
  return loadNrmsPropertyAccess(req, res, propertyId, ["OWNER", "MANAGER"]);
}

const publicConnection = (connection: any) => connection ? {
  provider: connection.provider,
  status: connection.status,
  displayName: connection.displayName,
  externalAccountId: connection.externalAccountId,
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

const whatsappConnectSchema = z.object({
  code: z.string().trim().min(8).max(4000),
  wabaId: z.string().trim().regex(/^\d+$/).max(191),
  phoneNumberId: z.string().trim().regex(/^\d+$/).max(191),
});

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
    const subscribeQuery = new URLSearchParams({ access_token: accessToken });
    const subscription = await metaJson(await fetch(`https://graph.facebook.com/${graphVersion}/${parsed.data.wabaId}/subscribed_apps?${subscribeQuery.toString()}`, { method: "POST" }));
    if (subscription.success === false) throw new Error("WhatsApp webhook subscription was rejected");
    const expiresIn = Number(token.expires_in || 0);
    const connection = await prisma.nrmsMessagingConnection.upsert({
      where: { propertyId_provider: { propertyId, provider: "WHATSAPP" } },
      update: { ownerId: allowed.ownerId, status: "CONNECTED", externalBusinessId: parsed.data.wabaId, externalAccountId: parsed.data.wabaId, phoneNumberId: parsed.data.phoneNumberId, displayName: String(phone.verified_name || phone.display_phone_number || "WhatsApp Business"), accessTokenEncrypted: encrypt(accessToken), tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null, ...(token.scope ? { scopes: String(token.scope).split(",") } : {}), webhookSubscribedAt: new Date(), lastError: null, version: { increment: 1 } },
      create: { propertyId, ownerId: allowed.ownerId, provider: "WHATSAPP", status: "CONNECTED", externalBusinessId: parsed.data.wabaId, externalAccountId: parsed.data.wabaId, phoneNumberId: parsed.data.phoneNumberId, displayName: String(phone.verified_name || phone.display_phone_number || "WhatsApp Business"), accessTokenEncrypted: encrypt(accessToken), tokenExpiresAt: expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null, ...(token.scope ? { scopes: String(token.scope).split(",") } : {}), webhookSubscribedAt: new Date() },
    });
    res.status(201).json({ connection: publicConnection(connection) });
  } catch (error) {
    console.error("[owner.nrms.messaging] WhatsApp connection failed", error);
    const prismaCode = typeof error === "object" && error && "code" in error ? String((error as any).code) : "";
    res.status(prismaCode === "P2002" ? 409 : 502).json({ error: prismaCode === "P2002" ? "This WhatsApp Business account is already connected to another property" : "WhatsApp connection could not be verified" });
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
