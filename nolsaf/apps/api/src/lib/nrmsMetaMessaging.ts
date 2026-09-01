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
  attachment: {
    type: string;
    providerMediaId: string | null;
    mimeType: string | null;
    fileName: string | null;
    caption: string | null;
    providerUrl: string | null;
  } | null;
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

function attachmentFromWhatsApp(message: any): MetaInboundMessage["attachment"] {
  const type = String(message?.type || "").toLowerCase();
  if (!["image", "document", "audio", "video", "sticker", "location", "contacts"].includes(type)) return null;
  const value = message?.[type] ?? {};
  return {
    type,
    providerMediaId: value?.id ? String(value.id) : null,
    mimeType: value?.mime_type ? String(value.mime_type) : null,
    fileName: value?.filename ? String(value.filename) : null,
    caption: value?.caption ? String(value.caption).slice(0, 4000) : null,
    providerUrl: null,
  };
}

function textFromWhatsApp(message: any): string | null {
  if (message?.type === "text") return String(message.text?.body || "").trim() || null;
  if (message?.type === "button") return String(message.button?.text || "").trim() || null;
  if (message?.type === "interactive") return String(message.interactive?.button_reply?.title || message.interactive?.list_reply?.title || "").trim() || null;
  if (["image", "document", "audio", "video", "sticker", "location", "contacts"].includes(message?.type)) {
    const caption = String(message?.[message.type]?.caption || "").trim();
    return caption || `[${String(message.type).toUpperCase()}]`;
  }
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
          events.push({ kind: "MESSAGE", provider: "WHATSAPP", accountId, senderId: String(message.from), providerMessageId: String(message.id), senderName: names.get(String(message.from)) || null, body, attachment: attachmentFromWhatsApp(message), occurredAt: eventDate(message.timestamp) });
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
        const firstAttachment = Array.isArray(item.message?.attachments) ? item.message.attachments[0] : null;
        const body = String(item.message?.text || (firstAttachment ? `[${String(firstAttachment.type || "ATTACHMENT").toUpperCase()}]` : "")).trim();
        if (!body) continue;
        events.push({
          kind: "MESSAGE",
          provider: "INSTAGRAM",
          accountId,
          senderId: String(item.sender.id),
          providerMessageId: String(item.message.mid),
          senderName: null,
          body,
          attachment: firstAttachment ? {
            type: String(firstAttachment.type || "attachment").toLowerCase(),
            providerMediaId: null,
            mimeType: null,
            fileName: null,
            caption: item.message?.text ? String(item.message.text).slice(0, 4000) : null,
            providerUrl: firstAttachment?.payload?.url ? String(firstAttachment.payload.url) : null,
          } : null,
          occurredAt: eventDate(item.timestamp || entry.time),
        });
      }
    }
  }
  return events;
}

type SendConnection = { provider: string; externalAccountId: string | null; phoneNumberId: string | null; accessTokenEncrypted: string | null };
type MetaAttachment = NonNullable<MetaInboundMessage["attachment"]>;

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

function trustedMetaMediaUrl(value: string): URL {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const trusted = ["facebook.com", "fbcdn.net", "instagram.com", "cdninstagram.com"].some((domain) => host === domain || host.endsWith(`.${domain}`));
  if (url.protocol !== "https:" || !trusted) throw new Error("META_MEDIA_URL_NOT_TRUSTED");
  return url;
}

/** Fetches private inbound media without exposing a property token or provider URL. */
export async function downloadMetaAttachment(connection: SendConnection, attachment: MetaAttachment): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
  if (!connection.accessTokenEncrypted) throw new Error("META_CONNECTION_TOKEN_MISSING");
  const token = decrypt(connection.accessTokenEncrypted, { log: false });
  let providerUrl = attachment.providerUrl;
  let mimeType = attachment.mimeType;
  let fileName = attachment.fileName;
  if (String(connection.provider).toUpperCase() === "WHATSAPP") {
    if (!attachment.providerMediaId) throw new Error("META_MEDIA_ID_MISSING");
    const metadataResponse = await fetch(`https://graph.facebook.com/${graphVersion()}/${encodeURIComponent(attachment.providerMediaId)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
    const metadata = await metadataResponse.json().catch(() => ({})) as any;
    if (!metadataResponse.ok || !metadata?.url) throw new Error(`META_MEDIA_LOOKUP_FAILED:${metadataResponse.status}`);
    providerUrl = String(metadata.url);
    mimeType = mimeType || (metadata?.mime_type ? String(metadata.mime_type) : null);
  }
  if (!providerUrl) throw new Error("META_MEDIA_URL_MISSING");
  const safeUrl = trustedMetaMediaUrl(providerUrl);
  const response = await fetch(safeUrl, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`META_MEDIA_DOWNLOAD_FAILED:${response.status}`);
  const declaredSize = Number(response.headers.get("content-length") || 0);
  if (declaredSize > 25 * 1024 * 1024) throw new Error("META_MEDIA_TOO_LARGE");
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > 25 * 1024 * 1024) throw new Error("META_MEDIA_TOO_LARGE");
  const resolvedMime = String(mimeType || response.headers.get("content-type") || "application/octet-stream").split(";")[0];
  const extension = resolvedMime.includes("/") ? resolvedMime.split("/")[1].replace(/[^a-z0-9.+-]/gi, "") : "bin";
  const resolvedName = String(fileName || `${attachment.type || "attachment"}.${extension}`).replace(/[\r\n"\\/]/g, "_").slice(0, 160);
  return { bytes, mimeType: resolvedMime, fileName: resolvedName };
}
