import { timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { coralPostJson64, parseCoralEncryptedJson, parseCoralInitiateResponse } from "./coralcommerce.helpers.js";
import { getPaymentMethodAvailability } from "./serviceAvailability.js";
import { bookingEvent, eventFailure, prepareEventCheckout, recordEventDecline, settleEventCollection, tokenHash } from "./eventHireBookings.js";
import type { EventActor } from "./eventHireRequests.js";

/** Dedicated callback URL, separate from browser postbacks. Its per-checkout
 * 256-bit capability is sent only in our server-to-provider request. Redact
 * callback query strings at the ingress; never log the capability or cipher. */
function configuration() {
  const username = process.env.CORAL_UCF_USERNAME,
    password = process.env.CORAL_UCF_PASSWORD,
    alias = process.env.CORAL_UCF_ALIAS;
  const callback = process.env.EVENT_HIRE_CARD_CALLBACK_URL,
    web = process.env.WEB_ORIGIN;
  const checkoutHosts = new Set(String(process.env.EVENT_HIRE_CARD_CHECKOUT_HOSTS || "").split(",").map(host => host.trim().toLowerCase()).filter(Boolean));
  if (!username || !password || !alias || !callback || !web || !process.env.CORAL_UCF_SHARED_ENCRYPTION_KEY || !checkoutHosts.size) eventFailure("Event card checkout is not configured.", "PAYMENT_UNAVAILABLE", 503);
  let callbackUrl: URL, returnUrl: URL;
  try {
    callbackUrl = new URL(callback);
    returnUrl = new URL("/account/event-requests", web);
  } catch {
    return eventFailure("Payment URLs are not configured correctly.", "PAYMENT_UNAVAILABLE", 503);
  }
  if (callbackUrl.pathname !== "/api/event-hire/card-callback" || process.env.NODE_ENV === "production" && (callbackUrl.protocol !== "https:" || returnUrl.protocol !== "https:")) eventFailure("Secure payment URLs are required.", "PAYMENT_UNAVAILABLE", 503);
  if (process.env.NODE_ENV === "production") {
    const api = process.env.CORAL_UCF_API_URL;
    if (!api || process.env.EVENT_HIRE_CARD_CALLBACK_VERIFIED !== "true") eventFailure("Event payments need a verified production callback configuration.", "PAYMENT_UNAVAILABLE", 503);
    if(!eventCallbackIps().length)eventFailure("Verified provider callback source addresses are required.","PAYMENT_UNAVAILABLE",503);
    let gateway: URL;
    try {
      gateway = new URL(api);
    } catch {
      return eventFailure("Invalid payment provider configuration.", "PAYMENT_UNAVAILABLE", 503);
    }
    if (gateway.protocol !== "https:" || /(^|[.-])(dev|uat|sandbox|test)([.-]|$)/i.test(gateway.hostname)) eventFailure("A production payment gateway is required.", "PAYMENT_UNAVAILABLE", 503);
  }
  return {
    username,
    password,
    alias,
    callbackUrl,
    returnUrl,
    checkoutHosts
  };
}

function eventCallbackIps(){return String(process.env.EVENT_HIRE_CARD_CALLBACK_ALLOWED_IPS||"").split(",").map(value=>value.trim().replace(/^::ffff:/i,"").toLowerCase()).filter(value=>isIP(value)>0);}

/** req.ip must come from the application's trusted ingress configuration.
 * An edge proxy address is not proof of the provider's identity. Production
 * callbacks must reach a verified direct origin path with pinned source IPs. */
export function eventCallbackSourceAllowed(req:{ip?:string;headers?:Record<string,unknown>}){
  const allowed=eventCallbackIps();
  if(!allowed.length)return process.env.NODE_ENV!=="production";
  if(req.headers?.["cf-ray"]||req.headers?.["x-vercel-id"]||req.headers?.["x-vercel-forwarded-for"])return false;
  const ip=String(req.ip||"").replace(/^::ffff:/i,"").toLowerCase();
  return isIP(ip)>0&&allowed.includes(ip);
}
export async function startEventCard(db: any, actor: EventActor, requestRef: string) {
  const config = configuration();
  const gate = await getPaymentMethodAvailability("CARD");
  if (!gate.enabled) eventFailure(gate.reason || "Card payments are unavailable.", "PAYMENT_UNAVAILABLE", 503);
  const prepared = await prepareEventCheckout(db, actor, requestRef);
  if (prepared.checkoutUrl) return {
    checkoutUrl: prepared.checkoutUrl,
    reference: prepared.booking.reference
  };
  const b = prepared.booking;
  const payer = await db.user.findUnique({
    where: {
      id: actor.userId
    },
    select: {
      name: true,
      fullName: true,
      email: true,
      phone: true
    }
  });
  config.callbackUrl.searchParams.set("ref", b.paymentRef);
  config.callbackUrl.searchParams.set("cap", prepared.token!);
  config.returnUrl.searchParams.set("eventBooking", b.reference);
  const payload = {
    Transaction: {
      Version: "3.16",
      Username: config.username,
      Password: config.password,
      Destination: "ucfurl",
      Submission: {
        Number: 1,
        Stamp: b.paymentRef
      },
      Identifier: b.paymentRef,
      Alias: config.alias,
      Currency: "TZS",
      Order: {
        Products: [{
          ID: 1,
          Code: "EVENTHIRE",
          Description: `NoLSAF event hire: ${b.request.property.title}`.slice(0, 100),
          Price: b.total,
          Quantity: 1,
          VAT: 0,
          SubTotal: b.total
        }],
        Delivery: {
          Auto: true
        },
        ProductTotal: b.total
      },
      UCF: {
        CustomerFullName: String(payer?.fullName || payer?.name || "NoLSAF client").slice(0, 100),
        CustomerEmail: String(payer?.email || "").slice(0, 255),
        CustomerMobile: String(payer?.phone || "").slice(0, 40),
        CallbackUrl: config.callbackUrl.toString(),
        CallbackFormat: "json",
        CallbackMethod: "post",
        CallbackProtocol: "tls12",
        CallbackVar: "UCFCallback",
        TransactionType: "03",
        PostBackSuccessUrl: config.returnUrl.toString(),
        PostBackFailureUrl: config.returnUrl.toString(),
        DisplayOrderSummary: "true"
      }
    }
  };
  try {
    const result = await coralPostJson64(payload);
    if (!result.ok) throw new Error("PROVIDER_RESPONSE_UNKNOWN");
    const parsed = parseCoralInitiateResponse(result.body);
    if (parsed.code !== "000" || !parsed.redirectUrl) throw new Error("PROVIDER_CHECKOUT_UNAVAILABLE");
    const url = new URL(parsed.redirectUrl);
    if (url.protocol !== "https:" || !config.checkoutHosts.has(url.hostname.toLowerCase())) throw new Error("UNSAFE_CHECKOUT_URL");
    // Return only the redirect; no provider credentials, callback capability,
    // request body or decrypted response ever reaches the client.
    const updated = await db.eventHireBooking.updateMany({
      where: {
        id: b.id,
        status: "PAYMENT_PENDING",
        checkoutStatus: "INITIATING",
        paidAt: null
      },
      data: {
        checkoutStatus: "PROCESSING",
        checkoutUrl: parsed.redirectUrl.slice(0, 2048)
      }
    });
    if (!updated.count) {
      const current = await db.eventHireBooking.findUnique({
        where: {
          id: b.id
        },
        select: {
          paidAt: true
        }
      });
      if (current?.paidAt) return {
        checkoutUrl: config.returnUrl.toString(),
        reference: b.reference
      };
      eventFailure("Payment is being checked. Refresh the booking.", "PAYMENT_PENDING");
    }
    return {
      checkoutUrl: parsed.redirectUrl,
      reference: b.reference
    };
  } catch {
    // An HTTP timeout is not proof that no charge/session was created. Never
    // automatically initiate a second provider call for this booking.
    await db.eventHireBooking.updateMany({
      where: {
        id: b.id,
        paidAt: null,
        checkoutStatus: "INITIATING"
      },
      data: {
        checkoutStatus: "STATUS_UNKNOWN"
      }
    });
    await bookingEvent(db, b, null, "PAYMENT_STATUS_UNKNOWN");
    eventFailure("Payment initiation needs checking. Do not pay again; contact NoLSAF.", "PAYMENT_STATUS_UNKNOWN", 503);
  }
}
export function validEventCallbackCapability(token: unknown, expectedHash: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  return timingSafeEqual(Buffer.from(tokenHash(token), "hex"), Buffer.from(expectedHash, "hex"));
}
export async function handleEventCardCallback(db: any, ref: unknown, capability: unknown, encrypted: unknown) {
  if (typeof ref !== "string" || !/^EHV-[a-f0-9]{32}$/.test(ref)) eventFailure("Invalid callback.", "CALLBACK_REJECTED", 403);
  const b = await db.eventHireBooking.findUnique({
    where: {
      paymentRef: ref
    }
  });
  if (!b || !validEventCallbackCapability(capability, b.callbackTokenHash)) eventFailure("Invalid callback.", "CALLBACK_REJECTED", 403);
  const key = process.env.CORAL_UCF_SHARED_ENCRYPTION_KEY;
  if (!key || typeof encrypted !== "string" || encrypted.length > 100000) eventFailure("Invalid callback.", "CALLBACK_REJECTED", 403);
  let notice: any;
  try {
    notice = parseCoralEncryptedJson(key, encrypted);
  } catch {
    eventFailure("Invalid callback.", "CALLBACK_REJECTED", 403);
  }
  if (notice.Identifier !== ref || notice.Stamp && notice.Stamp !== ref || !/^[0-9]{1,30}$/.test(String(notice.TransactionID || ""))) eventFailure("Payment target mismatch.", "CALLBACK_REJECTED", 403);
  if (String(notice.Status).toLowerCase() === "success" && notice.Code === "000" && notice.ISOCode === "00") {
    return settleEventCollection(db, {
      paymentRef: ref,
      transactionId: String(notice.TransactionID),
      amount: b.total,
      currency: "TZS"
    });
  }
  if (String(notice.Status).toLowerCase() === "failure") {
    await recordEventDecline(db, b.id);
  }
  return {
    reference: b.reference,
    status: "PENDING"
  };
}
