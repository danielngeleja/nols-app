import { rateLimitWithRedis as rateLimit } from "../lib/redisRateLimitStore.js";
import { prisma } from "@nolsaf/prisma";

const rateDb = prisma as any;

async function recordPublicQrRejection(req: any, kind: string) {
  try {
    const token = String(req.params?.token || "");
    const publicCode = String(req.params?.publicCode || "");
    const point = token ? await rateDb.nrmsOrderPoint.findUnique({ where: { token }, select: { propertyId: true } }) : null;
    const order = !point && publicCode ? await rateDb.nrmsOutletOrder.findUnique({ where: { publicCode }, select: { propertyId: true } }) : null;
    const propertyId = point?.propertyId ?? order?.propertyId;
    if (!propertyId) return;
    const now = new Date();
    const metricDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await rateDb.nrmsPublicMetric.upsert({
      where: { propertyId_metricDate_kind: { propertyId, metricDate, kind } },
      update: { count: { increment: 1 } },
      create: { propertyId, metricDate, kind, count: 1 },
    });
  } catch (error: any) {
    console.warn("[nrms-rate-limit] Could not persist rejection metric:", error?.message ?? error);
  }
}

function publicQrLimitHandler(kind: string, message: string) {
  return (req: any, res: any) => {
    void recordPublicQrRejection(req, kind);
    res.status(429).json({ error: message });
  };
}

export const limitAgentPortalRead = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 60, // 60 requests per minute per agent
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `agent:${userId}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

export const limitAgentNotifyAdmin = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 5, // prevent inbox spam
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a moment before sending another." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `agent-notify-admin:${userId}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

export const limitAgentProfileWrite = rateLimit({
  windowMs: 15 * 60_000,
  // Autosave + manual edits can legitimately produce frequent writes for active operator sessions.
  // Keep abuse protection, but allow normal editing without hitting 429.
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many profile updates. Please wait before saving again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `agent-profile-write:${userId}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

export const limitAgentRevenueClaim = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payout claim requests. Please wait before trying again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `agent-revenue-claim:${userId}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

export const limitCloudinarySign = rateLimit({
  windowMs: 60_000, // 1 minute
  // Allows bursts for multi-file uploads but blocks abuse
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many upload signature requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `cloudinary-sign:${userId}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

export const limitUploadPresign = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many upload authorization requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `upload-presign:${userId}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

export const limitPublicTourBookingCreate = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many tour booking requests. Please wait before creating another booking." },
  keyGenerator: (req) => {
    const phone = req.body?.guestPhone;
    const email = req.body?.guestEmail;
    if (phone) return `tour-booking:${String(phone).trim()}`;
    if (email) return `tour-booking:${String(email).trim().toLowerCase()}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

export const limitPublicCareerApply = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many application submissions. Please wait before trying again." },
  keyGenerator: (req) => req.ip || req.socket.remoteAddress || "unknown",
});

export const limitCodeSearch = rateLimit({
  windowMs: 60_000, // 1 min
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for cancellation lookups (prevents brute-force / DoS on code validation).
// Keyed by authenticated userId so each account is budgeted independently;
// falls back to IP for unauthenticated traffic (should not reach here in practice).
export const limitCancellationLookup = rateLimit({
  windowMs: 60 * 60_000,     // 1-hour sliding window
  limit: 4,                  // max 4 failed attempts per user per hour
  standardHeaders: true,     // RateLimit-* headers (RFC 6585)
  legacyHeaders: false,
  skipSuccessfulRequests: false, // count every attempt, success or failure
  message: { error: "Too many code validation attempts. You are locked out for 1 hour." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `cancel-lookup:${userId}`;
    }
    // Fallback: key by IP (should rarely be reached — route requires auth)
    return `cancel-lookup-ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
  },
});

// Rate limiter for cancellation submissions.
// Keyed by userId — prevents one account from spamming requests even through a proxy.
export const limitCancellationSubmit = rateLimit({
  windowMs: 15 * 60_000,     // 15-minute window
  limit: 3,                  // max 3 submission attempts per user per 15 min
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  message: { error: "Too many cancellation submissions. Please wait 15 minutes before trying again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    if (typeof userId === "number" && Number.isFinite(userId) && userId > 0) {
      return `cancel-submit:${userId}`;
    }
    return `cancel-submit-ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
  },
});

// Rate limiter for cancellation messages (prevents spam messaging)
export const limitCancellationMessages = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 10, // 10 messages per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a moment before sending another message." },
});

// Rate limiter for plan request submissions (prevents spam)
export const limitPlanRequestSubmit = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 3, // 3 submissions per 15 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many plan request submissions. Please wait before submitting another request." },
});

// Rate limiter for plan request messages (follow-up messages)
export const limitPlanRequestMessages = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 5, // 5 messages per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a moment before sending another message." },
});

// Rate limiter for owner group stay messages (prevents spam/abuse)
export const limitOwnerGroupStayMessages = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 10, // 10 messages per minute per owner
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a moment before sending another message." },
  keyGenerator: (req) => {
    // Rate limit by owner ID if authenticated
    const ownerId = (req as any).user?.id;
    if (ownerId) {
      return `owner-group-stay-msg:${ownerId}`;
    }
    // Fallback to IP if not authenticated
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for chatbot messages (prevents spam/abuse)
export const limitChatbotMessages = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 30, // 30 messages per minute per IP/session
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many messages. Please wait a moment before sending another message." },
  keyGenerator: (req) => {
    // Use session ID if available, otherwise fall back to IP
    const sessionId = req.body?.sessionId || req.cookies?.chatbot_session_id;
    if (sessionId) {
      return `chatbot:${sessionId}`;
    }
    // Ensure we always return a string
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for chatbot conversation history requests
export const limitChatbotConversations = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 20, // 20 requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
});

// Rate limiter for chatbot language changes
export const limitChatbotLanguageChange = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 10, // 10 language changes per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many language changes. Please wait a moment and try again." },
});

// Rate limiter for OTP sending (prevents SMS spam and cost abuse)
export const limitOtpSend = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 3, // 3 OTP requests per phone number per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: (req: any) => {
    const resetTime: Date | undefined = req.rateLimit?.resetTime;
    const retryAfterMs = resetTime ? Math.max(0, resetTime.getTime() - Date.now()) : 15 * 60_000;
    return {
      error: "Too many OTP requests. Please wait before requesting another code.",
      retryAfterMs,
      cooldownUntil: Date.now() + retryAfterMs,
    };
  },
  keyGenerator: (req) => {
    // Rate limit by destination (phone or email) to prevent SMS/email spam
    const destination = req.body?.phone || req.body?.email;
    if (destination) {
      return `otp:${String(destination).trim().toLowerCase()}`;
    }
    // Fallback to IP if no destination provided
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for the forgot-password account existence check. Keyed by IP
// (not destination) so a caller cannot enumerate accounts by rotating
// phone numbers or emails.
export const limitAccountCheck = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 20, // 20 lookups per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait before trying again." },
  keyGenerator: (req) => `account-check:${req.ip || req.socket.remoteAddress || "unknown"}`,
});

// Rate limiter for OTP verification attempts (prevents brute force)
export const limitOtpVerify = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 10, // 10 verification attempts per phone number per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: (req: any) => {
    const resetTime: Date | undefined = req.rateLimit?.resetTime;
    const retryAfterMs = resetTime ? Math.max(0, resetTime.getTime() - Date.now()) : 15 * 60_000;
    return {
      error: "Too many verification attempts. Please wait before trying again.",
      retryAfterMs,
      cooldownUntil: Date.now() + retryAfterMs,
    };
  },
  keyGenerator: (req) => {
    const destination = req.body?.phone || req.body?.email;
    if (destination) {
      return `otp-verify:${String(destination).trim().toLowerCase()}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for authenticated contact (phone/email) change requests.
// Prevents abuse of the OTP-based change flow on /api/account/contact/*.
export const limitContactChangeOtp = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 3, // 3 change requests per field per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: (req: any) => {
    const resetTime: Date | undefined = req.rateLimit?.resetTime;
    const retryAfterMs = resetTime ? Math.max(0, resetTime.getTime() - Date.now()) : 15 * 60_000;
    return {
      error: "Too many requests. Please wait before requesting another code.",
      retryAfterMs,
      cooldownUntil: Date.now() + retryAfterMs,
    };
  },
  keyGenerator: (req: any) => {
    const userId = req.user?.id;
    const field = req.body?.field || "unknown";
    return `contact-change:${userId ?? req.ip ?? "unknown"}:${field}`;
  },
});

// Code confirmations are separately limited so the three-request issuance
// budget is not consumed by the required authorize + verify stages. The
// challenge itself additionally locks after five wrong codes.
export const limitContactChangeConfirm = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many verification attempts. Wait before trying again." },
  keyGenerator: (req: any) => {
    const userId = req.user?.id;
    const field = req.body?.field || "unknown";
    return `contact-change-confirm:${userId ?? req.ip ?? "unknown"}:${field}`;
  },
});

// Rate limiter for login attempts (IP-based to prevent brute force)
export const limitLoginAttempts = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 10, // 10 login attempts per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many login attempts. Please wait 15 minutes before trying again." },
  skipSuccessfulRequests: true, // Don't count successful logins
});

// Rate limiter for registration attempts (prevents account creation abuse)
export const limitRegisterAttempts = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 5, // 5 registration attempts per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many registration attempts. Please wait 15 minutes before trying again." },
  keyGenerator: (req) => {
    const email = req.body?.email;
    if (email) return `register:${String(email).trim().toLowerCase()}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for public transport booking creation (prevents spam/abuse)
export const limitTransportBooking = rateLimit({
  windowMs: 15 * 60_000, // 15 minutes
  limit: 10, // 10 bookings per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many booking requests. Please wait 15 minutes before creating another booking." },
  keyGenerator: (req) => {
    // Rate limit by IP, but also consider phone/email if provided
    const phone = req.body?.guestPhone || req.body?.phone;
    const email = req.body?.guestEmail || req.body?.email;
    if (phone) {
      return `transport-booking:${String(phone)}`;
    }
    if (email) {
      return `transport-booking:${String(email)}`;
    }
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for authenticated driver trip list endpoints (prevents scraping/spam)
export const limitDriverTripsList = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 120, // 120 requests/minute per driver
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
  keyGenerator: (req) => {
    const driverId = (req as any).user?.id || (req as any).userId;
    if (driverId) return `driver-trips-list:${String(driverId)}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for driver trip claim endpoint (prevents claim spamming / brute forcing)
export const limitDriverTripClaim = rateLimit({
  windowMs: 10 * 60_000, // 10 minutes
  limit: 15, // 15 claims/10 minutes per driver
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many claim attempts. Please wait and try again." },
  keyGenerator: (req) => {
    const driverId = (req as any).user?.id || (req as any).userId;
    if (driverId) return `driver-trip-claim:${String(driverId)}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for driver trip actions (accept/decline/cancel)
export const limitDriverTripAction = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 60, // 60 actions/minute per driver
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a moment and try again." },
  keyGenerator: (req) => {
    const driverId = (req as any).user?.id || (req as any).userId;
    if (driverId) return `driver-trip-action:${String(driverId)}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for driver location updates (high-frequency but must be bounded)
export const limitDriverLocationUpdate = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 240, // ~4 updates/sec per driver
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many location updates. Please slow down." },
  keyGenerator: (req) => {
    const driverId = (req as any).user?.id || (req as any).userId;
    if (driverId) return `driver-location:${String(driverId)}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Rate limiter for driver availability toggles (prevents spam/flapping)
export const limitDriverAvailabilityToggle = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many availability changes. Please wait a moment." },
  keyGenerator: (req) => {
    const driverId = (req as any).user?.id || (req as any).userId;
    if (driverId) return `driver-availability:${String(driverId)}`;
    return req.ip || req.socket.remoteAddress || "unknown";
  },
});

// Public QR menu browsing (guests scanning room/table codes; generous but bounded)
export const limitPublicQrMenu = rateLimit({
  windowMs: 5 * 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  handler: publicQrLimitHandler("QR_RATE_LIMIT_MENU", "Too many menu requests. Please wait a moment and scan again."),
  keyGenerator: (req) => `qr-menu:${req.ip || req.socket.remoteAddress || "unknown"}`,
});

// Public QR order placement (abuse cap: a table places a handful of orders, not dozens)
export const limitPublicQrOrderCreate = rateLimit({
  windowMs: 10 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  handler: publicQrLimitHandler("QR_RATE_LIMIT_ORDER", "Too many orders placed from this device. Please ask a staff member for help."),
  keyGenerator: (req) => `qr-order:${req.ip || req.socket.remoteAddress || "unknown"}`,
});

// Public QR order status polling (guest page polls every few seconds)
export const limitPublicQrOrderStatus = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: publicQrLimitHandler("QR_RATE_LIMIT_STATUS", "Too many status checks. Please wait a moment."),
  keyGenerator: (req) => `qr-status:${req.ip || req.socket.remoteAddress || "unknown"}`,
});

export const limitSalesContractRead = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many contract requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `sales-contract-read:${userId}`
      : `sales-contract-read:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitSalesContractAccept = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many contract acceptance attempts. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `sales-contract-accept:${userId}`
      : `sales-contract-accept:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitSalesLeadRead = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many lead requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `sales-lead-read:${userId}`
      : `sales-lead-read:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitSalesLeadWrite = rateLimit({
  windowMs: 15 * 60_000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many lead changes. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `sales-lead-write:${userId}`
      : `sales-lead-write:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitSalesAdminRead = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sales administration requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `sales-admin-read:${userId}`
      : `sales-admin-read:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitSalesAdminWrite = rateLimit({
  windowMs: 15 * 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sales administration changes. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `sales-admin-write:${userId}`
      : `sales-admin-write:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitSalesPropertyRead = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many sales property requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `sales-property-read:${userId}`
      : `sales-property-read:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

// Public QR post-service feedback (one submission per completed order)
export const limitPublicQrOrderFeedback = rateLimit({
  windowMs: 10 * 60_000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
  handler: publicQrLimitHandler("QR_RATE_LIMIT_FEEDBACK", "Too many feedback attempts. Please wait a moment."),
  keyGenerator: (req) => `qr-feedback:${req.ip || req.socket.remoteAddress || "unknown"}`,
});

export const limitPublicNrmsDirectQuote = rateLimit({
  windowMs: 5 * 60_000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many live-rate searches. Please wait a moment." },
});

export const limitPublicNrmsDirectHold = rateLimit({
  windowMs: 15 * 60_000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many room hold requests. Please wait before trying again." },
  keyGenerator: (req) => `nrms-direct:${String(req.body?.guest?.phone || req.ip || req.socket.remoteAddress || "unknown").trim()}`,
});

export const limitPublicNrmsGuestCapability = rateLimit({
  windowMs: 5 * 60_000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many guest-link requests. Please wait a moment." },
});

export const limitDisbursementAdminRead = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many disbursement administration requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `disbursement-admin-read:${userId}`
      : `disbursement-admin-read:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitDisbursementAdminWrite = rateLimit({
  windowMs: 15 * 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many disbursement administration changes. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `disbursement-admin-write:${userId}`
      : `disbursement-admin-write:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitOwnerPayoutRead = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many payout requests. Please wait and try again." },
  keyGenerator: (req) => {
    const userId = (req as any)?.user?.id;
    return Number.isInteger(userId)
      ? `owner-payout-read:${userId}`
      : `owner-payout-read:${req.ip || req.socket.remoteAddress || "unknown"}`;
  },
});

export const limitAzampayDisbursementCallback = rateLimit({
  windowMs: 60_000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many callback requests." },
});
