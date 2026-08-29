import { describe, expect, it } from "vitest";
import { closesActiveConversation, nrmsMetaConversationKey } from "./nrmsMetaConversation.js";

describe("NRMS Meta active conversation identity", () => {
  it("deduplicates the same sender only inside the same property and channel", () => {
    const first = nrmsMetaConversationKey(7, "instagram", "17841420123456789");
    expect(first).toHaveLength(64);
    expect(nrmsMetaConversationKey(7, "INSTAGRAM", "17841420123456789")).toBe(first);
    expect(nrmsMetaConversationKey(8, "INSTAGRAM", "17841420123456789")).not.toBe(first);
    expect(nrmsMetaConversationKey(7, "WHATSAPP", "17841420123456789")).not.toBe(first);
  });

  it("releases the unique active key when the conversation is finished", () => {
    expect(closesActiveConversation("RESOLVED")).toBe(true);
    expect(closesActiveConversation("CONVERTED")).toBe(true);
    expect(closesActiveConversation("CLOSED")).toBe(true);
    expect(closesActiveConversation("WAITING_GUEST")).toBe(false);
  });
});
