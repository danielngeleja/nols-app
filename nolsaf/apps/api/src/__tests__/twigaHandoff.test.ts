import { describe, it, expect } from "vitest";
import {
  CONVERSATION_STATUS,
  HANDOFF_REASON,
  MESSAGE_ROLE,
  acknowledgementFor,
  awaitingNoticeFor,
  handoffReasonFor,
  isAwaitingNotice,
  isWithHuman,
  normaliseHandoffReason,
  releasedToTwigaFor,
  requiresSignInForHandoff,
  returnPathForHandoff,
  shouldPersistTranscript,
  signInForSupportFor,
  shouldReleaseToTwiga,
  talkToPersonFollowUp,
} from "../lib/twiga/handoff";

describe("a quiet support thread returns to Twiga", () => {
  const now = new Date("2026-09-16T15:09:00Z");
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60_000);

  it("releases an active thread once the agent has been silent for over 30 minutes", () => {
    expect(shouldReleaseToTwiga({ status: CONVERSATION_STATUS.AGENT_ACTIVE, lastAgentMessageAt: minutesAgo(96), now })).toBe(true);
  });

  it("keeps a thread the agent is still in", () => {
    expect(shouldReleaseToTwiga({ status: CONVERSATION_STATUS.AGENT_ACTIVE, lastAgentMessageAt: minutesAgo(5), now })).toBe(false);
  });

  it("never releases a visitor who is still waiting for a person", () => {
    expect(shouldReleaseToTwiga({ status: CONVERSATION_STATUS.AWAITING_AGENT, lastAgentMessageAt: null, now })).toBe(false);
    expect(shouldReleaseToTwiga({ status: CONVERSATION_STATUS.AWAITING_AGENT, lastAgentMessageAt: minutesAgo(600), now })).toBe(false);
  });

  it("offers a person in the visitor's language, in words that hand over when tapped", () => {
    expect(talkToPersonFollowUp("en")).toMatch(/talk to a person/);
    expect(talkToPersonFollowUp("sw")).toBe("Nataka kuongea na mtu");
    expect(releasedToTwigaFor("en")).not.toContain("—");
  });
});

describe("the old repeated notice", () => {
  it("is recognised in both languages so saved copies can be hidden", () => {
    expect(isAwaitingNotice(awaitingNoticeFor("en"))).toBe(true);
    expect(isAwaitingNotice(`  ${awaitingNoticeFor("sw")}  `)).toBe(true);
    expect(isAwaitingNotice("Our support team will reply soon")).toBe(false);
    expect(isAwaitingNotice(null)).toBe(false);
  });
});

describe("reaching a person requires an account", () => {
  it("gates an anonymous request for a person", () => {
    expect(requiresSignInForHandoff(HANDOFF_REASON.REQUESTED, null)).toBe(true);
    expect(requiresSignInForHandoff(HANDOFF_REASON.LOW_CONFIDENCE, null)).toBe(true);
  });

  it("never gates an emergency", () => {
    expect(requiresSignInForHandoff(HANDOFF_REASON.EMERGENCY, null)).toBe(false);
  });

  it("does not gate a signed-in visitor, or a message with no hand-off", () => {
    expect(requiresSignInForHandoff(HANDOFF_REASON.REQUESTED, 7)).toBe(false);
    expect(requiresSignInForHandoff(null, null)).toBe(false);
  });

  it("tells the visitor they come back to the same page", () => {
    expect(signInForSupportFor(HANDOFF_REASON.REQUESTED, "en")).toMatch(/come straight back/);
    expect(signInForSupportFor(HANDOFF_REASON.REQUESTED, "sw")).toMatch(/Utarudi/);
  });
});

describe("the return path after sign-in", () => {
  it("keeps the page and its query, and adds the resume marker once", () => {
    expect(returnPathForHandoff("/public/properties/villa-ck123?guests=2")).toBe(
      "/public/properties/villa-ck123?guests=2&twiga=handoff"
    );
    expect(returnPathForHandoff("/checkout?twiga=handoff")).toBe("/checkout?twiga=handoff");
  });

  it("refuses anything that could leave the site", () => {
    expect(returnPathForHandoff("https://evil.example/phish")).toBe("/?twiga=handoff");
    expect(returnPathForHandoff("//evil.example/phish")).toBe("/?twiga=handoff");
    expect(returnPathForHandoff("/\\evil.example")).toBe("/?twiga=handoff");
    expect(returnPathForHandoff(null)).toBe("/?twiga=handoff");
  });
});

describe("when a conversation goes to a person", () => {
  it("hands off on an explicit request", () => {
    expect(
      handoffReasonFor({ entryId: "human-handoff", shouldOfferHandoff: false })
    ).toBe(HANDOFF_REASON.REQUESTED);
  });

  it("hands off on a safety intent even when Twiga answered confidently", () => {
    expect(handoffReasonFor({ entryId: "emergency", shouldOfferHandoff: false })).toBe(
      HANDOFF_REASON.EMERGENCY
    );
  });

  it("does not bring the team in just because Twiga is unsure", () => {
    // Being unsure offers a person; only the visitor choosing one hands over.
    expect(handoffReasonFor({ entryId: null, shouldOfferHandoff: true })).toBeNull();
  });

  it("does not hand off a confident, direct answer", () => {
    expect(
      handoffReasonFor({ entryId: "payment-methods", shouldOfferHandoff: false })
    ).toBeNull();
  });
});

describe("Twiga yields to a human", () => {
  it("treats waiting and active as held by a person", () => {
    expect(isWithHuman(CONVERSATION_STATUS.AWAITING_AGENT)).toBe(true);
    expect(isWithHuman(CONVERSATION_STATUS.AGENT_ACTIVE)).toBe(true);
  });

  it("does not treat bot or resolved as held", () => {
    expect(isWithHuman(CONVERSATION_STATUS.BOT)).toBe(false);
    expect(isWithHuman(CONVERSATION_STATUS.RESOLVED)).toBe(false);
  });

  it("defaults an unset status to the bot, so old rows behave normally", () => {
    expect(isWithHuman(null)).toBe(false);
    expect(isWithHuman(undefined)).toBe(false);
  });
});

describe("the transcript is held open for a handoff", () => {
  it("persists exactly while a person holds the thread", () => {
    // This is the one that matters: the widget wipes itself after five minutes,
    // and an agent can easily reply later than that. Clearing the transcript
    // under a waiting visitor drops them rather than helping them.
    expect(shouldPersistTranscript(CONVERSATION_STATUS.AWAITING_AGENT)).toBe(true);
    expect(shouldPersistTranscript(CONVERSATION_STATUS.AGENT_ACTIVE)).toBe(true);
    expect(shouldPersistTranscript(CONVERSATION_STATUS.BOT)).toBe(false);
    expect(shouldPersistTranscript(CONVERSATION_STATUS.RESOLVED)).toBe(false);
  });
});

describe("what the visitor is told", () => {
  it("promises a reply in the same chat, for every reason", () => {
    for (const reason of Object.values(HANDOFF_REASON)) {
      const text = acknowledgementFor(reason, "en");
      expect(text.length, `${reason} has no copy`).toBeGreaterThan(0);
    }
  });

  it("never invents a response time it cannot keep", () => {
    const everything = [
      ...Object.values(HANDOFF_REASON).map((r) => acknowledgementFor(r, "en")),
      ...Object.values(HANDOFF_REASON).map((r) => acknowledgementFor(r, "sw")),
      awaitingNoticeFor("en"),
      awaitingNoticeFor("sw"),
    ].join(" ");

    expect(everything).not.toMatch(/within (a few|\d+) (minute|hour|day)/i);
    expect(everything).not.toMatch(/\b(shortly|right away|immediately)\b/i);
  });

  it("tells someone in danger to call emergency services rather than wait for us", () => {
    const text = acknowledgementFor(HANDOFF_REASON.EMERGENCY, "en").toLowerCase();
    expect(text).toContain("emergency services");
    expect(text).toContain("do not wait");
  });

  it("has Swahili for every handoff message", () => {
    for (const reason of Object.values(HANDOFF_REASON)) {
      expect(acknowledgementFor(reason, "sw")).not.toBe(acknowledgementFor(reason, "en"));
    }
    expect(awaitingNoticeFor("sw")).not.toBe(awaitingNoticeFor("en"));
  });

  it("falls back to English for a language with no copy", () => {
    expect(acknowledgementFor(HANDOFF_REASON.REQUESTED, "zh")).toBe(
      acknowledgementFor(HANDOFF_REASON.REQUESTED, "en")
    );
  });

  it("keeps em-dashes out of everything the visitor reads", () => {
    const everything = [
      ...Object.values(HANDOFF_REASON).flatMap((r) => [
        acknowledgementFor(r, "en"),
        acknowledgementFor(r, "sw"),
      ]),
      awaitingNoticeFor("en"),
      awaitingNoticeFor("sw"),
    ].join(" ");
    expect(everything).not.toContain("—");
  });
});

describe("stored handoff reason", () => {
  it("fits the column it is written to", () => {
    // handoffReason is VARCHAR(160); an over-long value would be a write error
    // on MySQL in strict mode rather than a silent truncation.
    const long = "x".repeat(500);
    expect(normaliseHandoffReason(long).length).toBe(160);
  });

  it("leaves the real reasons untouched", () => {
    for (const reason of Object.values(HANDOFF_REASON)) {
      expect(normaliseHandoffReason(reason)).toBe(reason);
    }
  });
});

describe("roles", () => {
  it("distinguishes a human agent from Twiga", () => {
    expect(MESSAGE_ROLE.AGENT).toBe("agent");
    expect(MESSAGE_ROLE.ASSISTANT).toBe("assistant");
    expect(MESSAGE_ROLE.AGENT).not.toBe(MESSAGE_ROLE.ASSISTANT);
  });

  it("keeps every role inside the VARCHAR(20) column", () => {
    for (const role of Object.values(MESSAGE_ROLE)) {
      expect(role.length).toBeLessThanOrEqual(20);
    }
  });

  it("keeps every status inside the VARCHAR(20) column", () => {
    for (const status of Object.values(CONVERSATION_STATUS)) {
      expect(status.length).toBeLessThanOrEqual(20);
    }
  });
});
