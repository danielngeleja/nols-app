import { Router, type RequestHandler, type Request, type Response } from "express";
import { typedPrisma as prisma } from "@nolsaf/prisma";
import { encrypt } from "../lib/crypto.js";
import { instagramOAuthConfig, verifyNrmsMetaOAuthState } from "../lib/nrmsMetaOAuth.js";

export const router = Router();

const webOrigin = () => String(process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "https://nolsaf.com").replace(/\/$/, "");
const finish = (res: Response, status: "connected" | "error", reason?: string) => {
  const query = new URLSearchParams({ section: "guest", meta: status });
  if (reason) query.set("reason", reason);
  return res.redirect(302, `${webOrigin()}/owner/nrms/controls?${query.toString()}`);
};
async function jsonResponse(response: globalThis.Response) {
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok || body.error) throw new Error(String(body.error?.message || body.error_description || `Meta request failed (${response.status})`));
  return body;
}

router.get("/instagram/callback", (async (req: Request, res: Response) => {
  const state = verifyNrmsMetaOAuthState(String(req.query.state || ""));
  if (!state) return finish(res, "error", "invalid_state");
  if (req.query.error) return finish(res, "error", String(req.query.error_reason || req.query.error || "access_denied").slice(0, 80));
  const code = String(req.query.code || "");
  const config = instagramOAuthConfig();
  if (!code || !config.appId || !config.appSecret || !config.redirectUri) return finish(res, "error", "oauth_not_configured");
  try {
    const property = await prisma.property.findFirst({ where: { id: state.propertyId, ownerId: state.ownerId, status: "APPROVED", nrmsActivatedAt: { not: null } }, select: { id: true } });
    if (!property) return finish(res, "error", "property_not_available");

    const tokenForm = new URLSearchParams({ client_id: config.appId, client_secret: config.appSecret, grant_type: "authorization_code", redirect_uri: config.redirectUri, code });
    const shortToken = await jsonResponse(await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: tokenForm }));
    let accessToken = String(shortToken.access_token || "");
    let expiresIn = Number(shortToken.expires_in || 3600);
    try {
      const longQuery = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: config.appSecret, access_token: accessToken });
      const longToken = await jsonResponse(await fetch(`https://graph.instagram.com/access_token?${longQuery.toString()}`));
      accessToken = String(longToken.access_token || accessToken); expiresIn = Number(longToken.expires_in || expiresIn);
    } catch { /* Short-lived token remains valid; readiness will show its expiry. */ }
    if (!accessToken) throw new Error("Instagram did not return an access token");

    const profileQuery = new URLSearchParams({ fields: "id,user_id,username,name,account_type", access_token: accessToken });
    const profile = await jsonResponse(await fetch(`https://graph.instagram.com/${config.graphVersion}/me?${profileQuery.toString()}`));
    const accountId = String(profile.user_id || profile.id || shortToken.user_id || "");
    if (!accountId) throw new Error("Instagram account identity was not returned");

    let subscribed = false;
    for (const fields of ["messages,messaging_seen", "messages"]) {
      try {
        const subscriptionQuery = new URLSearchParams({ subscribed_fields: fields, access_token: accessToken });
        const subscription = await jsonResponse(await fetch(`https://graph.instagram.com/${config.graphVersion}/${accountId}/subscribed_apps?${subscriptionQuery.toString()}`, { method: "POST" }));
        subscribed = subscription.success !== false; if (subscribed) break;
      } catch { /* Retry with the minimal supported field set. */ }
    }
    if (!subscribed) throw new Error("Instagram webhook subscription could not be completed");

    const tokenExpiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000) : null;
    await prisma.nrmsMessagingConnection.upsert({
      where: { propertyId_provider: { propertyId: state.propertyId, provider: "INSTAGRAM" } },
      update: { ownerId: state.ownerId, status: "CONNECTED", externalAccountId: accountId, displayName: String(profile.username || profile.name || "Instagram"), accessTokenEncrypted: encrypt(accessToken), tokenExpiresAt, scopes: ["instagram_business_basic", "instagram_business_manage_messages"], webhookSubscribedAt: new Date(), lastError: null, version: { increment: 1 } },
      create: { propertyId: state.propertyId, ownerId: state.ownerId, provider: "INSTAGRAM", status: "CONNECTED", externalAccountId: accountId, displayName: String(profile.username || profile.name || "Instagram"), accessTokenEncrypted: encrypt(accessToken), tokenExpiresAt, scopes: ["instagram_business_basic", "instagram_business_manage_messages"], webhookSubscribedAt: new Date() },
    });
    return finish(res, "connected");
  } catch (error) {
    console.error("[meta.oauth] Instagram connection failed", error);
    const prismaCode = typeof error === "object" && error && "code" in error ? String((error as any).code) : "";
    return finish(res, "error", prismaCode === "P2002" ? "account_already_connected" : "connection_failed");
  }
}) as RequestHandler);

export default router;
