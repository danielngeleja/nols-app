import crypto from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("./crypto.js", () => ({ decrypt: vi.fn(() => "private-token") }));
import { downloadMetaAttachment, parseMetaWebhook, verifyMetaWebhookSignature } from "./nrmsMetaMessaging.js";

describe("Meta messaging boundary", () => {
  it("verifies the exact webhook bytes", () => {
    const body = Buffer.from('{"object":"instagram"}');
    const signature = crypto.createHmac("sha256", "secret").update(body).digest("hex");
    expect(verifyMetaWebhookSignature(body, `sha256=${signature}`, "secret")).toBe(true);
    expect(verifyMetaWebhookSignature(Buffer.from("changed"), `sha256=${signature}`, "secret")).toBe(false);
  });

  it("normalizes WhatsApp messages and delivery updates", () => {
    const events = parseMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-1" }, contacts: [{ wa_id: "255700000001", profile: { name: "Amina" } }], messages: [{ id: "wamid.in", from: "255700000001", timestamp: "1788256800", type: "text", text: { body: "Do you have a room?" } }], statuses: [{ id: "wamid.out", timestamp: "1788256801", status: "delivered" }] } }] }] });
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "MESSAGE", provider: "WHATSAPP", accountId: "phone-1", senderId: "255700000001", senderName: "Amina", body: "Do you have a room?" });
    expect(events[1]).toMatchObject({ kind: "DELIVERY", providerMessageId: "wamid.out", status: "DELIVERED" });
  });

  it("normalizes Instagram guest messages and ignores business echoes", () => {
    const events = parseMetaWebhook({ object: "instagram", entry: [{ id: "ig-1", time: 1788256800000, messaging: [{ sender: { id: "guest-1" }, message: { mid: "mid.in", text: "Hi" } }, { sender: { id: "ig-1" }, message: { mid: "mid.echo", text: "Hello", is_echo: true } }, { sender: { id: "guest-1" }, read: { mid: "mid.out" }, timestamp: 1788256801000 }] }] });
    expect(events).toEqual([
      expect.objectContaining({ kind: "MESSAGE", provider: "INSTAGRAM", accountId: "ig-1", senderId: "guest-1", providerMessageId: "mid.in", body: "Hi" }),
      expect.objectContaining({ kind: "DELIVERY", provider: "INSTAGRAM", providerMessageId: "mid.out", status: "READ" }),
    ]);
  });

  it("preserves safe media metadata without treating provider media ids as public URLs", () => {
    const [event] = parseMetaWebhook({ object: "whatsapp_business_account", entry: [{ changes: [{ value: { metadata: { phone_number_id: "phone-1" }, messages: [{ id: "wamid.image", from: "255700000001", timestamp: "1788256800", type: "image", image: { id: "media-private-1", mime_type: "image/jpeg", caption: "Room photo" } }] } }] }] });
    expect(event).toMatchObject({
      kind: "MESSAGE",
      body: "Room photo",
      attachment: { type: "image", providerMediaId: "media-private-1", mimeType: "image/jpeg", caption: "Room photo", providerUrl: null },
    });
  });

  it("rejects untrusted attachment URLs before the server can make a request", async () => {
    const fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
    await expect(downloadMetaAttachment(
      { provider: "INSTAGRAM", externalAccountId: "ig-1", phoneNumberId: null, accessTokenEncrypted: "encrypted" },
      { type: "image", providerMediaId: null, mimeType: "image/jpeg", fileName: null, caption: null, providerUrl: "https://attacker.example/private" },
    )).rejects.toThrow("META_MEDIA_URL_NOT_TRUSTED");
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
