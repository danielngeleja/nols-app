/**
 * SMS service — Africa's Talking (primary) → Twilio (fallback) → console (dev)
 *
 * Required env vars for Africa's Talking:
 *   AFRICASTALKING_USERNAME   — your AT account username
 *   AFRICASTALKING_API_KEY    — your AT API key (from africastalking.com dashboard)
 *   AFRICASTALKING_SENDER_ID  — (optional) shortcode / alphanumeric sender, e.g. "NoLSAF"
 *
 * Optional Twilio fallback:
 *   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
 */

import { canReceiveNotifications } from './notificationEligibility.js';

// ─── Types ────────────────────────────────────────────────────────────────────
interface ATRecipient {
  statusCode: number;
  number: string;
  status: string;
  messageId?: string;
  cost?: string;
}
interface ATSendResponse {
  SMSMessageData: { Message: string; Recipients: ATRecipient[] };
}
export interface SmsResult {
  success: boolean;
  messageId?: string;
  provider?: string;
  error?: string;
}

// ─── Phone normalisation ──────────────────────────────────────────────────────
export function normalizeSmsPhone(raw: string): string {
  const cleaned = raw.trim();
  if (!cleaned) return cleaned;

  // Keep a leading '+' if provided, but normalise everything else to digits.
  const hasPlus = cleaned.startsWith('+');
  const digitsOnly = cleaned.replace(/\D/g, '');

  if (!digitsOnly) return cleaned;

  // Tanzania common inputs:
  //   07XXXXXXXX  -> +2557XXXXXXXX
  //   2557XXXXXXXX -> +2557XXXXXXXX
  //   +2557XXXXXXXX -> +2557XXXXXXXX
  if (hasPlus) return `+${digitsOnly}`;
  if (digitsOnly.startsWith('255')) return `+${digitsOnly}`;
  if (digitsOnly.startsWith('0')) return `+255${digitsOnly.slice(1)}`;
  return `+255${digitsOnly}`;
}

// ─── Africa's Talking ────────
async function postAfricasTalkingSms(payload: {
  username: string;
  apiKey: string;
  to: string;
  message: string;
  from?: string;
}): Promise<ATSendResponse> {
  const body = new URLSearchParams({
    username: payload.username,
    to: payload.to,
    message: payload.message,
    ...(payload.from ? { from: payload.from } : {}),
  });

  const response = await fetch("https://api.africastalking.com/version1/messaging", {
    method: "POST",
    headers: {
      Accept: "application/json",
      apikey: payload.apiKey,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }

  if (!response.ok) {
    const reason = String(parsed?.SMSMessageData?.Message || parsed?.message || response.statusText || "Unknown error");
    throw new Error(`Africa's Talking HTTP ${response.status}: ${reason}`);
  }

  return (parsed || { SMSMessageData: { Message: "", Recipients: [] } }) as ATSendResponse;
}

async function sendViaAfricasTalking(to: string, message: string): Promise<SmsResult> {
  const username = process.env.AFRICASTALKING_USERNAME;
  const apiKey   = process.env.AFRICASTALKING_API_KEY;
  const senderId = process.env.AFRICASTALKING_SENDER_ID; // optional

  if (!username || !apiKey) {
    return { success: false, error: 'Africa\'s Talking credentials missing (AFRICASTALKING_USERNAME / AFRICASTALKING_API_KEY)' };
  }

  const result = await postAfricasTalkingSms({
    username,
    apiKey,
    to,
    message,
    ...(senderId ? { from: senderId } : {}),
  });
  const first  = result?.SMSMessageData?.Recipients?.[0];

  // AT returns statusCode 101 for a queued/accepted message
  if (first && (first.statusCode === 101 || first.status === 'Success')) {
    return { success: true, messageId: first.messageId ?? 'unknown', provider: 'africastalking' };
  }

  // Common failure mode: an unapproved/invalid alphanumeric Sender ID.
  // If we set `from` and AT rejects, retry once without `from` to allow default shortcode routing.
  if (senderId) {
    try {
      const retryResult = await postAfricasTalkingSms({ username, apiKey, to, message });
      const retryFirst = retryResult?.SMSMessageData?.Recipients?.[0];
      if (retryFirst && (retryFirst.statusCode === 101 || retryFirst.status === 'Success')) {
        console.warn("[SMS] Africa's Talking rejected Sender ID; retried without from and queued successfully.");
        return { success: true, messageId: retryFirst.messageId ?? 'unknown', provider: 'africastalking' };
      }
    } catch {
      // If retry throws, we fall through to the detailed error below.
    }
  }

  const status = first?.status ?? 'unknown';
  const statusCode = typeof first?.statusCode === 'number' ? first.statusCode : undefined;
  const number = first?.number;
  const messageData = result?.SMSMessageData?.Message;

  throw new Error(
    `Africa's Talking rejected: status=${status}` +
      (statusCode !== undefined ? ` code=${statusCode}` : '') +
      (number ? ` number=${number}` : '') +
      (messageData ? ` message=${messageData}` : ''),
  );
}

// ─── Twilio (optional fallback) ──────
async function sendViaTwilio(to: string, message: string): Promise<SmsResult> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const from       = process.env.TWILIO_PHONE_NUMBER;

  if (!accountSid || !authToken || !from) {
    return { success: false, error: 'Twilio credentials not set' };
  }

  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
      },
      body: new URLSearchParams({ From: from, To: to, Body: message }),
    },
  );

  const data = await response.json() as { sid?: string; message?: string };
  if (!response.ok) throw new Error(`Twilio error: ${data.message ?? response.statusText}`);
  return { success: true, messageId: data.sid, provider: 'twilio' };
}

// ─── Public API ────
/*
 * Send an SMS.  Priority chain:
 *   1. Africa's Talking  (set AFRICASTALKING_API_KEY)
 *   2. Twilio            (set TWILIO_ACCOUNT_SID)
 *   3. Console log       (dev / staging only — never blocks OTP flows)
 */
export async function sendSms(
  to: string,
  text: string,
  options?: { bypassEligibilityCheck?: boolean; provider?: "auto" | "africastalking" },
): Promise<SmsResult> {
  if (!options?.bypassEligibilityCheck) {
    const eligibility = await canReceiveNotifications({ phone: to });
    if (!eligibility.allowed) {
      console.log(
        `[SMS] Suppressed SMS to=${to} reason=${eligibility.reason ?? 'blocked'} userId=${eligibility.matchedUserId ?? 'unknown'}`,
      );
      return { success: true, messageId: `suppressed-${Date.now()}`, provider: 'suppressed' };
    }
  }

  const phone = normalizeSmsPhone(to);
  const failures: string[] = [];
  const forceAfricasTalking = options?.provider === "africastalking";

  // 1 — Africa's Talking
  if (process.env.AFRICASTALKING_API_KEY) {
    try {
      const r = await sendViaAfricasTalking(phone, text);
      if (r.success) return r;
      console.warn('[SMS] Africa\'s Talking returned failure:', r.error);
      if (r.error) failures.push(`africastalking: ${r.error}`);
    } catch (err: any) {
      const message = String(err?.message ?? err);
      failures.push(`africastalking: ${message}`);
      console.error('[SMS] Africa\'s Talking threw:', message);
    }
  } else if (forceAfricasTalking) {
    failures.push("africastalking: AFRICASTALKING_API_KEY is not configured");
  }

  // 2 — Twilio
  if (!forceAfricasTalking && process.env.TWILIO_ACCOUNT_SID) {
    try {
      const r = await sendViaTwilio(phone, text);
      if (r.success) return r;
    } catch (err: any) {
      const message = String(err?.message ?? err);
      failures.push(`twilio: ${message}`);
      console.error('[SMS] Twilio threw:', message);
    }
  }

  // 3 — Dev console fallback
  if (!forceAfricasTalking && process.env.NODE_ENV !== 'production') {
    console.log(`[SMS DEV] → ${phone}: ${text}`);
    return { success: true, messageId: `dev-${Date.now()}`, provider: 'console' };
  }

  return { success: false, error: failures.length ? failures.join(' | ') : 'No SMS provider delivered the message' };
}
