import { typedPrisma as prisma } from "@nolsaf/prisma";
import { decrypt } from "./crypto.js";
import { instagramOAuthConfig } from "./nrmsMetaOAuth.js";

export type MetaDiagnosticProvider = "WHATSAPP" | "INSTAGRAM";
export type MetaDiagnosticStatus = "PASS" | "WARN" | "FAIL";
export type MetaDiagnosticCheck = { id: string; label: string; status: MetaDiagnosticStatus; detail: string };
export type MetaDiagnosticResult = {
  provider: MetaDiagnosticProvider;
  propertyId: number;
  checkedAt: string;
  verdict: "HEALTHY" | "ATTENTION_REQUIRED" | "AWAITING_META_WEBHOOK" | "CONFIGURATION_BROKEN" | "PROCESSING_BROKEN";
  checks: MetaDiagnosticCheck[];
  evidence: Record<string, string | number | boolean | null>;
};

function check(id: string, label: string, status: MetaDiagnosticStatus, detail: string): MetaDiagnosticCheck {
  return { id, label, status, detail };
}

function safeError(error: unknown): string {
  return String(error instanceof Error ? error.message : error || "Unknown error").slice(0, 300);
}

function workerExpectedToRun(): boolean {
  const configured = String(process.env.RUN_BACKGROUND_WORKERS || "").trim().toLowerCase();
  return configured ? ["1", "true", "yes", "on"].includes(configured) : process.env.NODE_ENV === "production";
}

async function json(response: globalThis.Response) {
  const body = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok || body.error) throw new Error(String(body.error?.message || body.error_description || `Meta request failed (${response.status})`));
  return body;
}

async function whatsappLiveChecks(connection: any, checks: MetaDiagnosticCheck[], evidence: Record<string, string | number | boolean | null>) {
  const graphVersion = String(process.env.META_GRAPH_API_VERSION || "v23.0");
  const appId = String(process.env.META_APP_ID || "");
  const appSecret = String(process.env.META_APP_SECRET || "");

  if (appId && appSecret) {
    try {
      const appToken = await json(await fetch("https://graph.facebook.com/oauth/access_token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: appId, client_secret: appSecret, grant_type: "client_credentials" }).toString(),
        signal: AbortSignal.timeout(8_000),
      }));
      const subscriptions = await json(await fetch(`https://graph.facebook.com/${graphVersion}/${appId}/subscriptions`, {
        headers: { Authorization: `Bearer ${String(appToken.access_token || "")}` },
        signal: AbortSignal.timeout(8_000),
      }));
      const subscription = (Array.isArray(subscriptions.data) ? subscriptions.data : []).find((item: any) => item?.object === "whatsapp_business_account");
      const fields = Array.isArray(subscription?.fields) ? subscription.fields.map((field: any) => String(field?.name || field)) : [];
      const callback = subscription?.callback_url ? String(subscription.callback_url) : null;
      evidence.reportedCallback = callback;
      const valid = Boolean(subscription && subscription.active !== false && fields.includes("messages") && callback);
      checks.push(check("app_webhook", "Meta app messages webhook", valid ? "PASS" : "FAIL", !subscription ? "The Meta app has no whatsapp_business_account webhook subscription." : !fields.includes("messages") ? "The Meta app webhook is not subscribed to the messages field." : !callback ? "The Meta app has no webhook callback URL." : subscription.active === false ? "The Meta app webhook subscription is inactive." : `Meta reports an active messages webhook at ${callback}.`));
    } catch (error) {
      checks.push(check("app_webhook", "Meta app messages webhook", "FAIL", `Meta could not verify the app webhook: ${safeError(error)}`));
    }
  } else {
    checks.push(check("app_webhook", "Meta app messages webhook", "FAIL", "App credentials are unavailable, so Meta could not be queried."));
  }

  if (connection?.externalBusinessId && connection.phoneNumberId && connection.accessTokenEncrypted) {
    try {
      const accessToken = decrypt(connection.accessTokenEncrypted, { log: false });
      const [subscriptions, phones] = await Promise.all([
        json(await fetch(`https://graph.facebook.com/${graphVersion}/${connection.externalBusinessId}/subscribed_apps`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8_000) })),
        json(await fetch(`https://graph.facebook.com/${graphVersion}/${connection.externalBusinessId}/phone_numbers?fields=id,display_phone_number,verified_name,status,code_verification_status`, { headers: { Authorization: `Bearer ${accessToken}` }, signal: AbortSignal.timeout(8_000) })),
      ]);
      const subscription = (Array.isArray(subscriptions.data) ? subscriptions.data : []).find((item: any) => String(item?.whatsapp_business_api_data?.id || item?.id || "") === appId);
      const subscribed = Boolean(subscription);
      const overrideCallback = subscription?.override_callback_uri ? String(subscription.override_callback_uri) : null;
      const selectedPhone = (Array.isArray(phones.data) ? phones.data : []).find((phone: any) => String(phone?.id || "") === String(connection.phoneNumberId));
      const phoneAccessible = Boolean(selectedPhone);
      const connectedPhoneNumber = selectedPhone?.display_phone_number ? String(selectedPhone.display_phone_number) : null;
      const phoneStatus = selectedPhone?.status ? String(selectedPhone.status).toUpperCase() : null;
      const codeVerificationStatus = selectedPhone?.code_verification_status ? String(selectedPhone.code_verification_status).toUpperCase() : null;
      const registrationHealthy = phoneAccessible && (!phoneStatus || phoneStatus === "CONNECTED") && (!codeVerificationStatus || codeVerificationStatus === "VERIFIED");
      evidence.connectedPhoneNumber = connectedPhoneNumber;
      evidence.phoneStatus = phoneStatus;
      evidence.codeVerificationStatus = codeVerificationStatus;
      checks.push(check("waba_subscription", "WhatsApp Business Account subscription", subscribed ? "PASS" : "FAIL", subscribed ? `The NoLSAF Meta app is subscribed to this WABA${overrideCallback ? ` with callback ${overrideCallback}` : ""}.` : "The NoLSAF Meta app is not present in this WABA's subscribed apps."));
      checks.push(check("phone_access", "WhatsApp phone access", phoneAccessible ? "PASS" : "FAIL", phoneAccessible ? `Meta confirms ${connectedPhoneNumber || "the connected phone"} belongs to this WABA and the token can access it.` : "The connected phone ID is not accessible with the stored WABA token."));
      checks.push(check("phone_registration", "WhatsApp phone registration", !phoneAccessible || !registrationHealthy ? "FAIL" : phoneStatus || codeVerificationStatus ? "PASS" : "WARN", !phoneAccessible ? "Meta could not inspect the connected phone registration." : !registrationHealthy ? `${connectedPhoneNumber || "The connected phone"} is not operational yet. Meta status is ${phoneStatus || "unknown"}; verification is ${codeVerificationStatus || "unknown"}.` : phoneStatus || codeVerificationStatus ? `${connectedPhoneNumber || "The connected phone"} is operational. Meta status is ${phoneStatus || "not reported"}; verification is ${codeVerificationStatus || "not reported"}.` : "Meta did not return a registration status for the connected phone."));
    } catch (error) {
      const detail = safeError(error);
      checks.push(check("waba_subscription", "WhatsApp Business Account subscription", "FAIL", `Meta could not verify the WABA subscription: ${detail}`));
      checks.push(check("phone_access", "WhatsApp phone access", "FAIL", `Meta could not verify the connected phone: ${detail}`));
      checks.push(check("phone_registration", "WhatsApp phone registration", "FAIL", `Meta could not verify phone registration: ${detail}`));
    }
  } else {
    checks.push(check("waba_subscription", "WhatsApp Business Account subscription", "FAIL", "The stored connection is missing its WABA ID, phone ID or encrypted token."));
    checks.push(check("phone_access", "WhatsApp phone access", "FAIL", "The stored connection is incomplete."));
    checks.push(check("phone_registration", "WhatsApp phone registration", "FAIL", "The stored connection is incomplete."));
  }
}

async function instagramLiveChecks(connection: any, checks: MetaDiagnosticCheck[], evidence: Record<string, string | number | boolean | null>) {
  const config = instagramOAuthConfig();
  if (!connection?.externalAccountId || !connection.accessTokenEncrypted) {
    checks.push(check("account_access", "Instagram account access", "FAIL", "The stored Instagram connection is missing its account ID or encrypted token."));
    checks.push(check("instagram_subscription", "Instagram messaging subscription", "FAIL", "The stored Instagram connection is incomplete."));
    return;
  }
  try {
    const accessToken = decrypt(connection.accessTokenEncrypted, { log: false });
    const headers = { Authorization: `Bearer ${accessToken}` };
    const profile = await json(await fetch(`https://graph.instagram.com/${config.graphVersion}/me?fields=id,user_id,username,name,account_type`, { headers, signal: AbortSignal.timeout(8_000) }));
    const reportedId = String(profile.user_id || profile.id || "");
    const identityMatches = reportedId === String(connection.externalAccountId);
    evidence.connectedUsername = profile.username ? String(profile.username) : null;
    evidence.reportedAccountId = reportedId || null;
    evidence.accountType = profile.account_type ? String(profile.account_type) : null;
    checks.push(check("account_access", "Instagram account access", identityMatches ? "PASS" : "FAIL", identityMatches ? `Meta confirms access to @${profile.username || connection.displayName || "the connected account"}.` : "The token resolves to a different Instagram account than the stored connection."));
    try {
      const subscriptions = await json(await fetch(`https://graph.instagram.com/${config.graphVersion}/${connection.externalAccountId}/subscribed_apps`, { headers, signal: AbortSignal.timeout(8_000) }));
      const subscribed = subscriptions.success === true || (Array.isArray(subscriptions.data) && subscriptions.data.length > 0);
      checks.push(check("instagram_subscription", "Instagram messaging subscription", subscribed ? "PASS" : "FAIL", subscribed ? "Meta confirms the Instagram account has an active app subscription." : "Meta did not report an active app subscription for this Instagram account."));
    } catch (error) {
      checks.push(check("instagram_subscription", "Instagram messaging subscription", "FAIL", `Meta could not verify the Instagram app subscription: ${safeError(error)}`));
    }
  } catch (error) {
    checks.push(check("account_access", "Instagram account access", "FAIL", `Meta could not access the connected Instagram account: ${safeError(error)}`));
    checks.push(check("instagram_subscription", "Instagram messaging subscription", "FAIL", "The subscription could not be verified because account access failed."));
  }
  const expiresAt = connection.tokenExpiresAt ? new Date(connection.tokenExpiresAt) : null;
  const remainingMs = expiresAt ? expiresAt.getTime() - Date.now() : null;
  evidence.tokenExpiresAt = expiresAt?.toISOString() ?? null;
  checks.push(check("token_expiry", "Instagram access-token lifetime", remainingMs === null ? "WARN" : remainingMs <= 0 ? "FAIL" : remainingMs < 7 * 86_400_000 ? "WARN" : "PASS", remainingMs === null ? "Meta did not provide an expiry for this token." : remainingMs <= 0 ? `The token expired at ${expiresAt?.toISOString()}.` : remainingMs < 7 * 86_400_000 ? `The token expires soon, at ${expiresAt?.toISOString()}.` : `The token is valid until ${expiresAt?.toISOString()}.`));
}

export async function runNrmsMetaDiagnostic(propertyId: number, provider: MetaDiagnosticProvider): Promise<MetaDiagnosticResult> {
  const checkedAt = new Date();
  const checks: MetaDiagnosticCheck[] = [];
  const instagramConfig = instagramOAuthConfig();
  const serverConfigured = provider === "WHATSAPP"
    ? Boolean(process.env.META_APP_ID && process.env.META_APP_SECRET && process.env.META_WEBHOOK_VERIFY_TOKEN)
    : Boolean(instagramConfig.appId && instagramConfig.appSecret && instagramConfig.redirectUri && process.env.META_WEBHOOK_VERIFY_TOKEN);
  const connection = await prisma.nrmsMessagingConnection.findFirst({ where: { propertyId, provider } });
  const connectionComplete = provider === "WHATSAPP"
    ? Boolean(connection?.status === "CONNECTED" && connection.phoneNumberId && connection.externalBusinessId && connection.accessTokenEncrypted)
    : Boolean(connection?.status === "CONNECTED" && connection.externalAccountId && connection.accessTokenEncrypted);

  checks.push(check("server_configuration", "NoLSAF server configuration", serverConfigured ? "PASS" : "FAIL", serverConfigured ? `${provider === "WHATSAPP" ? "WhatsApp" : "Instagram"} app credentials and webhook settings are configured.` : `Required ${provider === "WHATSAPP" ? "WhatsApp" : "Instagram"} app credentials or webhook settings are missing.`));
  checks.push(check("connection_record", "Property connection", connectionComplete ? "PASS" : "FAIL", connectionComplete ? `The property has a complete connected ${provider === "WHATSAPP" ? "WhatsApp" : "Instagram"} account.` : `This property does not have a complete connected ${provider === "WHATSAPP" ? "WhatsApp" : "Instagram"} account.`));

  const evidence: Record<string, string | number | boolean | null> = {
    storedAccountId: connection?.externalAccountId ?? null,
    storedPhoneNumberId: connection?.phoneNumberId ?? null,
    storedWabaId: connection?.externalBusinessId ?? null,
    lastWebhookAt: connection?.lastWebhookAt ? new Date(connection.lastWebhookAt).toISOString() : null,
  };
  if (provider === "WHATSAPP") await whatsappLiveChecks(connection, checks, evidence);
  else await instagramLiveChecks(connection, checks, evidence);

  let workerHealthy = false;
  let queueHealthy = false;
  let lastJob: any = null;
  let lastInbound: any = null;
  try {
    const accountId = String(provider === "WHATSAPP" ? connection?.phoneNumberId || "" : connection?.externalAccountId || "");
    const [worker, webhookJob, inbound] = await Promise.all([
      prisma.nrmsWorkerHealth.findUnique({ where: { worker: "meta-messaging" } }),
      prisma.nrmsMetaWebhookJob.findFirst({ where: { OR: [{ propertyId }, ...(accountId ? [{ provider, accountId }] : [])] }, orderBy: { createdAt: "desc" }, select: { status: true, lastError: true, createdAt: true, completedAt: true } }),
      prisma.nrmsGuestMessage.findFirst({ where: { direction: "INBOUND", channel: provider, inquiry: { propertyId } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    lastJob = webhookJob;
    lastInbound = inbound;
    const lastSuccessAt = worker?.lastSuccessAt ? new Date(worker.lastSuccessAt) : null;
    workerHealthy = Boolean(workerExpectedToRun() && ["HEALTHY", "RUNNING"].includes(String(worker?.status)) && lastSuccessAt && checkedAt.getTime() - lastSuccessAt.getTime() < 120_000);
    checks.push(check("worker", "NoLSAF webhook processor", workerHealthy ? "PASS" : "FAIL", !workerExpectedToRun() ? "RUN_BACKGROUND_WORKERS is disabled on this service." : !worker ? "The meta-messaging worker has never reported health." : workerHealthy ? `The worker is ${String(worker.status).toLowerCase()} and last completed successfully at ${lastSuccessAt?.toISOString()}.` : `The worker is ${worker.status}; last success was ${lastSuccessAt?.toISOString() || "never"}${worker.lastError ? ` (${String(worker.lastError).slice(0, 180)})` : ""}.`));
    queueHealthy = webhookJob?.status === "COMPLETED";
    checks.push(check("webhook_queue", "Durable webhook queue", !webhookJob ? "WARN" : webhookJob.status === "DEAD" ? "FAIL" : webhookJob.status !== "COMPLETED" ? "WARN" : "PASS", !webhookJob ? `No ${provider === "WHATSAPP" ? "WhatsApp" : "Instagram"} webhook event has reached the durable queue for this property yet.` : webhookJob.status === "COMPLETED" ? `The latest webhook event was processed successfully at ${webhookJob.completedAt?.toISOString() || webhookJob.createdAt.toISOString()}.` : `The latest webhook event is ${webhookJob.status}${webhookJob.lastError ? `: ${String(webhookJob.lastError).slice(0, 180)}` : "."}`));
    checks.push(check("inbound_storage", "Reception inquiry storage", inbound ? "PASS" : "WARN", inbound ? `The latest stored inbound ${provider === "WHATSAPP" ? "WhatsApp" : "Instagram"} message arrived at ${inbound.createdAt.toISOString()}.` : `No inbound ${provider === "WHATSAPP" ? "WhatsApp" : "Instagram"} message has been stored for this property.`));
  } catch (error) {
    const detail = safeError(error);
    checks.push(check("worker", "NoLSAF webhook processor", "FAIL", `Worker health could not be read: ${detail}`));
    checks.push(check("webhook_queue", "Durable webhook queue", "FAIL", `The webhook queue could not be queried. Confirm the latest Prisma migration: ${detail}`));
    checks.push(check("inbound_storage", "Reception inquiry storage", "FAIL", "Inbound storage could not be verified because the database diagnostic failed."));
  }

  evidence.latestWebhookJobStatus = lastJob?.status ?? null;
  evidence.latestInboundAt = lastInbound?.createdAt ? new Date(lastInbound.createdAt).toISOString() : null;
  const failedIds = checks.filter((item) => item.status === "FAIL").map((item) => item.id);
  const configurationIds = ["server_configuration", "connection_record", "app_webhook", "waba_subscription", "phone_access", "phone_registration", "account_access", "instagram_subscription", "token_expiry"];
  const verdict = failedIds.some((id) => configurationIds.includes(id))
    ? "CONFIGURATION_BROKEN"
    : failedIds.some((id) => ["worker", "webhook_queue", "inbound_storage"].includes(id))
      ? "PROCESSING_BROKEN"
      : !connection?.lastWebhookAt && !lastJob
        ? "AWAITING_META_WEBHOOK"
        : workerHealthy && queueHealthy && lastInbound
          ? "HEALTHY"
          : "ATTENTION_REQUIRED";

  return { provider, propertyId, checkedAt: checkedAt.toISOString(), verdict, checks, evidence };
}
