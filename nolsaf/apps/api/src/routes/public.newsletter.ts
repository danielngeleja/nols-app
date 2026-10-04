// apps/api/src/routes/public.newsletter.ts
//
// Footer newsletter, double opt-in:
//   POST /api/public/newsletter              { email }  -> sends a confirmation email
//   GET  /api/public/newsletter/confirm?token=...       -> redirects to /newsletter?status=...
//   GET  /api/public/newsletter/unsubscribe?token=...   -> redirects to /newsletter?status=...
//
// The POST answers the same way whether the address is new, pending or already
// subscribed, so the endpoint cannot be used to find out who is on the list.

import { Router, type RequestHandler } from "express";
import { Prisma } from "@prisma/client";
import { prisma } from "@nolsaf/prisma";
import { limitNewsletterSubscribe } from "../middleware/rateLimit.js";
import { sendMail } from "../lib/mailer.js";
import { proButton, proEmail } from "../lib/emailBase.js";
import {
  CONFIRM_TOKEN_TTL_MS,
  NEWSLETTER_STATUS,
  hashToken,
  isWellFormedToken,
  newToken,
  normaliseNewsletterEmail,
  shouldSendConfirmation,
} from "../lib/newsletter.js";

const router = Router();
const db = prisma as any;

function webOrigin(): string {
  const raw = process.env.FRONTEND_URL || process.env.WEB_ORIGIN || process.env.APP_ORIGIN || "https://www.nolsaf.com";
  return String(raw).split(",")[0].trim().replace(/\/+$/, "");
}

function statusPage(status: "confirmed" | "unsubscribed" | "invalid" | "unavailable"): string {
  return `${webOrigin()}/newsletter?status=${status}`;
}

/** The table ships in a separate migration; answer politely until it exists. */
function isMissingTable(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && (error.code === "P2021" || error.code === "P2022");
}

const ACCEPTED_MESSAGE = "Almost done. Check your inbox and confirm your email to start receiving updates.";

const subscribe: RequestHandler = async (req, res) => {
  const email = normaliseNewsletterEmail(req.body?.email);
  if (!email) return res.status(400).json({ ok: false, message: "Please enter a valid email address." });

  try {
    const now = new Date();
    const existing = await db.newsletterSubscriber.findUnique({
      where: { email },
      select: { id: true, status: true, lastConfirmationSentAt: true },
    });

    if (!shouldSendConfirmation({ status: existing?.status, lastConfirmationSentAt: existing?.lastConfirmationSentAt, now })) {
      return res.json({ ok: true, message: ACCEPTED_MESSAGE });
    }

    const token = newToken();
    const tokenFields = {
      confirmTokenHash: hashToken(token),
      confirmTokenExpiresAt: new Date(now.getTime() + CONFIRM_TOKEN_TTL_MS),
      lastConfirmationSentAt: now,
    };

    if (existing) {
      // Re-signup after unsubscribing goes back to PENDING until confirmed again.
      await db.newsletterSubscriber.update({
        where: { id: existing.id },
        data: { ...tokenFields, status: NEWSLETTER_STATUS.PENDING },
      });
    } else {
      await db.newsletterSubscriber.create({
        data: { email, source: "footer", unsubscribeToken: newToken(), ...tokenFields },
      });
    }

    // The web app proxies /api/* to this API, so links stay on the nolsaf.com domain.
    const confirmUrl = `${webOrigin()}/api/public/newsletter/confirm?token=${token}`;
    const html = proEmail(
      "Confirm your NoLSAF updates",
      `<p style="margin:0 0 16px;">Someone, hopefully you, asked to receive NoLSAF travel updates at this address: new stays, destinations and features, about once a month.</p>
       <p style="margin:0 0 22px;">Confirm to start receiving them. The link is valid for 48 hours.</p>
       ${proButton(confirmUrl, "Confirm my email")}
       <p style="margin:22px 0 0;font-size:13px;color:#6b7280;">Didn't ask for this? Ignore this email and you won't hear from us.</p>`
    );
    try {
      await sendMail(email, "Confirm your NoLSAF updates", html, undefined, { sensitiveContent: true });
    } catch (mailError) {
      // The signup is saved; the visitor can request a new link after the resend gap.
      console.error("newsletter.confirmation.send_failed", mailError);
    }

    return res.json({ ok: true, message: ACCEPTED_MESSAGE });
  } catch (error) {
    if (isMissingTable(error)) {
      return res.status(503).json({ ok: false, message: "Newsletter signups open soon. Please try again later." });
    }
    console.error("newsletter.subscribe.failed", error);
    return res.status(500).json({ ok: false, message: "Something went wrong. Please try again." });
  }
};

const confirm: RequestHandler = async (req, res) => {
  const token = req.query.token;
  if (!isWellFormedToken(token)) return res.redirect(302, statusPage("invalid"));
  try {
    const subscriber = await db.newsletterSubscriber.findUnique({
      where: { confirmTokenHash: hashToken(token) },
      select: { id: true, confirmTokenExpiresAt: true },
    });
    if (!subscriber || !subscriber.confirmTokenExpiresAt || subscriber.confirmTokenExpiresAt.getTime() < Date.now()) {
      return res.redirect(302, statusPage("invalid"));
    }
    await db.newsletterSubscriber.update({
      where: { id: subscriber.id },
      data: {
        status: NEWSLETTER_STATUS.SUBSCRIBED,
        confirmedAt: new Date(),
        unsubscribedAt: null,
        // Single use.
        confirmTokenHash: null,
        confirmTokenExpiresAt: null,
      },
    });
    return res.redirect(302, statusPage("confirmed"));
  } catch (error) {
    if (isMissingTable(error)) return res.redirect(302, statusPage("unavailable"));
    console.error("newsletter.confirm.failed", error);
    return res.redirect(302, statusPage("invalid"));
  }
};

const unsubscribe: RequestHandler = async (req, res) => {
  const token = req.query.token;
  if (!isWellFormedToken(token)) return res.redirect(302, statusPage("invalid"));
  try {
    const result = await db.newsletterSubscriber.updateMany({
      where: { unsubscribeToken: token },
      data: { status: NEWSLETTER_STATUS.UNSUBSCRIBED, unsubscribedAt: new Date(), confirmTokenHash: null, confirmTokenExpiresAt: null },
    });
    return res.redirect(302, statusPage(result.count > 0 ? "unsubscribed" : "invalid"));
  } catch (error) {
    if (isMissingTable(error)) return res.redirect(302, statusPage("unavailable"));
    console.error("newsletter.unsubscribe.failed", error);
    return res.redirect(302, statusPage("invalid"));
  }
};

router.post("/", limitNewsletterSubscribe, subscribe);
router.get("/confirm", confirm);
router.get("/unsubscribe", unsubscribe);

export default router;
