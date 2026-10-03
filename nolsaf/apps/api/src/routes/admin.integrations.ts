import { Router, type Request, type Response } from "express";
import { requireAuth, requireRole, type AuthedRequest } from "../middleware/auth.js";
import { sendMail, DEFAULT_EMAIL_FROM } from "../lib/mailer.js";

const router = Router();

router.use(requireAuth as any, requireRole("ADMIN") as any);

/**
 * GET /api/admin/integrations/status
 * Returns read-only integration status (checks env vars, never exposes secrets)
 */
router.get("/status", async (_req: Request, res: Response) => {
  try {
    // Email provider status
    const emailStatus = {
      configured: false,
      provider: undefined as string | undefined,
      details: undefined as string | undefined,
    };

    if (process.env.RESEND_API_KEY) {
      emailStatus.configured = true;
      emailStatus.provider = "Resend";
      emailStatus.details = process.env.RESEND_FROM_DOMAIN 
        ? `Using domain: ${process.env.RESEND_FROM_DOMAIN}`
        : "Using default Resend domain";
    } else if (process.env.SMTP_HOST && process.env.SMTP_USER) {
      emailStatus.configured = true;
      emailStatus.provider = "SMTP";
      emailStatus.details = `Host: ${process.env.SMTP_HOST}:${process.env.SMTP_PORT || 587}`;
    }

    // SMS provider status
    const smsStatus = {
      configured: false,
      provider: undefined as string | undefined,
      details: undefined as string | undefined,
    };

    if (process.env.AFRICASTALKING_API_KEY && process.env.AFRICASTALKING_USERNAME) {
      smsStatus.configured = true;
      smsStatus.provider = "Africa's Talking";
      smsStatus.details = `Username: ${process.env.AFRICASTALKING_USERNAME}, Sender ID: ${process.env.AFRICASTALKING_SENDER_ID || "NoLSAF"}`;
    } else if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      smsStatus.configured = true;
      smsStatus.provider = "Twilio";
      smsStatus.details = process.env.TWILIO_PHONE_NUMBER 
        ? `Phone: ${process.env.TWILIO_PHONE_NUMBER}`
        : "Phone number not configured";
    }

    // Cloudinary status
    const cloudinaryStatus = {
      configured: false,
      provider: "Cloudinary",
      details: undefined as string | undefined,
    };

    if (process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY) {
      cloudinaryStatus.configured = true;
      cloudinaryStatus.details = `Cloud: ${process.env.CLOUDINARY_CLOUD_NAME}`;
    }

    // Every integration as one list for the read-only board. Only whether each
    // variable is set is reported, plus non-secret labels (names, domains).
    const set = (name: string) => Boolean(process.env[name] && String(process.env[name]).trim());
    const check = (label: string, vars: string[], optional = false) => ({ label, vars, ok: vars.every(set), optional });
    const item = (key: string, name: string, category: string, purpose: string, checks: ReturnType<typeof check>[], extra: { provider?: string; details?: string; docs?: string } = {}) => {
      const required = checks.filter((c) => !c.optional);
      const ok = required.filter((c) => c.ok).length;
      return { key, name, category, purpose, checks, ...extra, state: ok === required.length ? "ready" : ok > 0 ? "partial" : "missing" };
    };
    const integrations = [
      item("payments", "AzamPay", "Payments", "Guest payments by mobile money, bank and card, and owner payouts", [
        check("Collections (API client)", ["AZAMPAY_CLIENT_ID", "AZAMPAY_CLIENT_SECRET"]),
        check("Payment callbacks", ["AZAMPAY_WEBHOOK_SECRET"]),
        check("Payouts source account", ["AZAMPAY_DISBURSE_SOURCE_ACCOUNT"]),
        check("Card checkout", ["AZAMPAY_CARD_API_URL"], true),
      ], { provider: "AzamPay", details: process.env.AZAMPAY_APP_NAME ? `App: ${process.env.AZAMPAY_APP_NAME}` : undefined, docs: "https://developerdocs.azampay.co.tz" }),
      item("email", "Email", "Messaging", "Booking confirmations, receipts, codes and security alerts", [
        check(process.env.RESEND_API_KEY ? "Resend API key" : "Resend API key or SMTP", process.env.RESEND_API_KEY || !process.env.SMTP_HOST ? ["RESEND_API_KEY"] : ["SMTP_HOST", "SMTP_USER", "SMTP_PASS"]),
        check("Sender address", ["EMAIL_FROM"], true),
      ], { provider: emailStatus.provider, details: emailStatus.details, docs: "https://resend.com/docs" }),
      item("sms", "SMS", "Messaging", "Booking codes, one-time codes and alerts by text", [
        check("Provider credentials", process.env.TWILIO_ACCOUNT_SID && !process.env.AFRICASTALKING_API_KEY ? ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"] : ["AFRICASTALKING_USERNAME", "AFRICASTALKING_API_KEY"]),
        check("Sender ID", ["AFRICASTALKING_SENDER_ID"], true),
      ], { provider: smsStatus.provider, details: smsStatus.details, docs: "https://developers.africastalking.com" }),
      item("meta", "Meta messaging", "Messaging", "WhatsApp and Instagram conversations with guests", [
        check("Meta app", ["META_APP_ID", "META_APP_SECRET"]),
        check("Webhook verification", ["META_WEBHOOK_VERIFY_TOKEN"]),
        check("WhatsApp embedded signup", ["META_WHATSAPP_CONFIG_ID"], true),
        check("Instagram app", ["META_INSTAGRAM_APP_ID", "META_INSTAGRAM_APP_SECRET"], true),
      ], { provider: "Meta", details: process.env.META_GRAPH_API_VERSION ? `Graph API ${process.env.META_GRAPH_API_VERSION}` : undefined, docs: "https://developers.facebook.com/docs/whatsapp" }),
      item("media", "Cloudinary", "Media", "Property photos, documents and profile pictures", [
        check("Cloud and API key", ["CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY"]),
        check("API secret (signed uploads)", ["CLOUDINARY_API_SECRET"]),
      ], { provider: "Cloudinary", details: cloudinaryStatus.details, docs: "https://cloudinary.com/documentation" }),
      item("maps", "Mapbox", "Platform", "Maps, pins and location search", [check("Access token", ["MAPBOX_ACCESS_TOKEN"])], { provider: "Mapbox", docs: "https://docs.mapbox.com" }),
      item("redis", "Redis", "Platform", "Shared rate limits, caching and background work", [check("Connection", ["REDIS_URL"]), check("TLS certificate", ["REDIS_CA_CERT_PATH"], true)], { provider: "Redis" }),
      item("links", "Signed public links", "Platform", "Receipts, payslip QR codes and other links shared outside the app", [check("Dedicated signing secret", ["PUBLIC_LINK_TOKEN_SECRET"])], { details: set("PUBLIC_LINK_TOKEN_SECRET") ? undefined : "Falling back to the session secret" }),
    ];

    res.json({
      email: emailStatus,
      sms: smsStatus,
      cloudinary: cloudinaryStatus,
      integrations,
      environment: process.env.NODE_ENV || "development",
      checkedAt: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error("Error fetching integration status:", err);
    res.status(500).json({ error: "Failed to fetch integration status" });
  }
});

/**
 * POST /api/admin/integrations/test-email
 * Send a test email and return the live result (success or Resend/SMTP error)
 * Body: { to: string }
 */
router.post("/test-email", async (req: Request, res: Response) => {
  const { to } = req.body || {};
  if (!to || typeof to !== "string" || !to.includes("@")) {
    return res.status(400).json({ error: "Provide a valid \"to\" email address in the request body" });
  }

  const from = DEFAULT_EMAIL_FROM;
  const provider = process.env.RESEND_API_KEY ? "resend" : process.env.SMTP_HOST ? "smtp" : "none";
  const nodeEnv = process.env.NODE_ENV || "(not set)";

  try {
    const result = await sendMail(
      to,
      "NoLSAF Email Test",
      `<p>This is a test email from NoLSAF Admin.</p><p>If you received this, email delivery is working correctly.</p><p>Sent at: ${new Date().toISOString()}</p>`
    );
    return res.json({
      success: true,
      messageId: result.messageId,
      provider: result.provider,
      from,
      to,
      nodeEnv,
      configuredProvider: provider,
    });
  } catch (err: any) {
    return res.status(500).json({
      success: false,
      error: err.message,
      from,
      to,
      nodeEnv,
      configuredProvider: provider,
      hint: provider === "resend"
        ? "The 'from' domain may not be verified in Resend. Set EMAIL_FROM to an address on your verified Resend domain (e.g. notifications@nolsaf.com)."
        : provider === "none"
        ? "No email provider is configured. Set RESEND_API_KEY or SMTP_HOST."
        : undefined,
    });
  }
});

export default router;




