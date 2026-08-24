import crypto from "node:crypto";
import { decrypt } from "./crypto.js";

export type MetaProvider = "INSTAGRAM" | "WHATSAPP";
export type MetaInboundMessage = {
  kind: "MESSAGE";
  provider: MetaProvider;
  accountId: string;
  senderId: string;
  providerMessageId: string;
  senderName: string | null;
  body: string;
  occurredAt: Date;
};
export type MetaDeliveryUpdate = {
  kind: "DELIVERY";
  provider: MetaProvider;
  accountId: string;
  providerMessageId: string;
  status: "SENT" | "DELIVERED" | "READ" | "FAILED";
  occurredAt: Date;
  error: string | null;
};
export type MetaWebhookEvent = MetaInboundMessage | MetaDeliveryUpdate;

function secureEqual(left: string, right: string): boolean {
  const a = Buffer.from(left); const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Meta signs the exact request bytes in X-Hub-Signature-256. */
export function verifyMetaWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, appSecret: string): boolean {
  if (!signatureHeader?.startsWith("sha256=") || !appSecret) return false;
  const supplied = signatureHeader.slice("sha256=".length).trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return secureEqual(supplied, expected);
}

function eventDate(value: unknown): Date {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return new Date();
  return new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric);
}

function textFromWhatsApp(message: any): string | null {
  if (message?.type === "text") return String(message.text?.body || "").trim() || null;
  if (message?.type === "button") return String(message.button?.text || "").trim() || null;
  if (message?.type === "interactive") return String(message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "").trim() || null;
  if (["image", "document", "audio", "video", "sticker", "location", "contacts"].includes(message?.type)) return `[${String(message.type).toUpperCase()}]`;
  return null;
}

/** Reduces both Meta webhook shapes to the provider-neutral NRMS transcript. */
export function parseMetaWebhook(payload: any): MetaWebhookEvent[] {
  const events: MetaWebhookEvent[] = [];
  if (payload?.object === "whatsapp_business_account") {
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
      for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
        const value = change?.value ?? {};
        const accountId = String(value?.metadata?.phone_number_id || "");
        if (!accountId) continue;
        const names = new Map<string, string>((Array.isArray(value.contacts) ? value.contacts : []).map((contact: any) => [String(contact?.wa_id || ""), String(contact?.profile?.name || "")]));
        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          const body = textFromWhatsApp(message);
          if (!body || !message?.id || !message?.from) continue;
          events.push({ kind: "MESSAGE", provider: "WHATSAPP", accountId, senderId: String(message.from), providerMessageId: String(message.id), senderName: names.get(String(message.from)) || null, body, occurredAt: eventDate(message.timestamp) });
        }
        for (const status of Array.isArray(value.statuses) ? value.statuses : []) {
          const normalized = String(status?.status || "").toUpperCase();
          if (!status?.id || !["SENT", "DELIVERED", "READ", "FAILED"].includes(normalized)) continue;
          events.push({ kind: "DELIVERY", provider: "WHATSAPP", accountId, providerMessageId: String(status.id), status: normalized as MetaDeliveryUpdate["status"], occurredAt: eventDate(status.timestamp), error: status?.errors?.[0]?.title ? String(status.errors[0].title) : null });
        }
      }
    }
    return events;
  }

  if (payload?.object === "instagram") {
    for (const entry of Array.isArray(payload.entry) ? payload.entry : []) {
      const accountId = String(entry?.id || "");
      for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
        if (accountId && item?.read?.mid) {
          events.push({ kind: "DELIVERY", provider: "INSTAGRAM", accountId, providerMessageId: String(item.read.mid), status: "READ", occurredAt: eventDate(item.timestamp || entry.time), error: null });
          continue;
        }
        if (!accountId || item?.message?.is_echo || !item?.message?.mid || !item?.sender?.id) continue;
        const body = String(item.message?.text || (item.message?.attachments?.length ? "[ATTACHMENT]" : "")).trim();
        if (!body) continue;
        events.push({ kind: "MESSAGE", provider: "INSTAGRAM", accountId, senderId: String(item.sender.id), providerMessageId: String(item.message.mid), senderName: null, body, occurredAt: eventDate(item.timestamp || entry.time) });
      }
    }
  }
  return events;
}

type SendConnection = { provider: string; externalAccountId: string | null; phoneNumberId: string | null; accessTokenEncrypted: string | null };

function graphVersion(): string {
  const configured = String(process.env.META_GRAPH_API_VERSION || "v23.0").trim();
  if (!/^v\d+\.\d+$/.test(configured)) throw new Error("META_GRAPH_API_VERSION must look like v23.0");
  return configured;
}

/** Sends one free-form reply after a guest-initiated conversation. */
export async function sendMetaText(connection: SendConnection, recipientId: string, body: string): Promise<string> {
  if (!connection.accessTokenEncrypted) throw new Error("META_CONNECTION_TOKEN_MISSING");
  const token = decrypt(connection.accessTokenEncrypted, { log: false });
  const provider = String(connection.provider).toUpperCase() as MetaProvider;
  const version = graphVersion();
  const endpoint = provider === "WHATSAPP"
    ? `https://graph.facebook.com/${version}/${encodeURIComponent(String(connection.phoneNumberId || ""))}/messages`
    : `https://graph.instagram.com/${version}/${encodeURIComponent(String(connection.externalAccountId || ""))}/messages`;
  if (endpoint.includes("//messages")) throw new Error("META_CONNECTION_ACCOUNT_MISSING");
  const payload = provider === "WHATSAPP"
    ? { messaging_product: "whatsapp", recipient_type: "individual", to: recipientId, type: "text", text: { preview_url: false, body } }
    : { recipient: { id: recipientId }, message: { text: body } };
  const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(12_000) });
  const data = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`META_SEND_FAILED:${response.status}:${String(data?.error?.message || "Unknown provider error").slice(0, 300)}`);
  const messageId = provider === "WHATSAPP" ? data?.messages?.[0]?.id : data?.message_id || data?.id;
  if (!messageId) throw new Error("META_SEND_MISSING_MESSAGE_ID");
  return String(messageId);
}
