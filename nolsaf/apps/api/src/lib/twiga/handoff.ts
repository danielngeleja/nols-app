/**
 * Twiga handoff lifecycle.
 *
 * A conversation is either with the bot or with a person. Before this existed,
 * "needs follow up" was a boolean an admin could clear, and the visitor never
 * saw a reply: the whole point of this module is that a handoff goes somewhere
 * the person who asked for help can actually read.
 */

export const CONVERSATION_STATUS = {
  /** Twiga is answering. The normal state. */
  BOT: "BOT",
  /** A person has been asked for and nobody has picked it up yet. */
  AWAITING_AGENT: "AWAITING_AGENT",
  /** An agent has replied and owns the thread. */
  AGENT_ACTIVE: "AGENT_ACTIVE",
  /** Closed. A new visitor message reopens it rather than starting fresh. */
  RESOLVED: "RESOLVED",
} as const;

export type ConversationStatus =
  (typeof CONVERSATION_STATUS)[keyof typeof CONVERSATION_STATUS];

export const MESSAGE_ROLE = {
  USER: "user",
  ASSISTANT: "assistant",
  /** Written by a human admin, not by Twiga. Carries an authorId. */
  AGENT: "agent",
} as const;

export type MessageRole = (typeof MESSAGE_ROLE)[keyof typeof MESSAGE_ROLE];

/** Statuses where a human is involved and the bot should stop answering. */
const HUMAN_HELD: ReadonlySet<string> = new Set([
  CONVERSATION_STATUS.AWAITING_AGENT,
  CONVERSATION_STATUS.AGENT_ACTIVE,
]);

/**
 * True when the thread belongs to a person right now.
 *
 * Twiga must not talk over an agent. Once a visitor has been handed off, an
 * automated reply between their message and the agent's is worse than silence:
 * it buries the question and makes the visitor think they were answered.
 */
export function isWithHuman(status: string | null | undefined): boolean {
  return HUMAN_HELD.has(status ?? CONVERSATION_STATUS.BOT);
}

/**
 * Whether the widget should hold the transcript open.
 *
 * The widget clears itself after a few minutes of inactivity. That is fine for
 * a bot exchange and destructive for a handoff: a visitor who asks for a person,
 * steps away, and comes back to an empty chat has been dropped, not helped.
 */
export function shouldPersistTranscript(status: string | null | undefined): boolean {
  return isWithHuman(status);
}

/** Reasons a conversation left the bot. Server-set, never taken from the visitor. */
export const HANDOFF_REASON = {
  REQUESTED: "Visitor asked for a person",
  LOW_CONFIDENCE: "Twiga could not answer confidently",
  EMERGENCY: "Safety or emergency keyword",
} as const;

export type HandoffReason = (typeof HANDOFF_REASON)[keyof typeof HANDOFF_REASON];

/** Longest reason we will store, matching the column width in the schema. */
const REASON_MAX = 160;

export function normaliseHandoffReason(reason: string): string {
  return reason.slice(0, REASON_MAX);
}

/**
 * Decide why, if at all, this exchange should go to a person.
 *
 * Only a clear signal brings the team in: the visitor asked for a person, or
 * the message reads as an emergency. Twiga being unsure is not that signal. It
 * used to hand the chat over silently, which put agents into conversations
 * nobody had asked them to join; now Twiga answers as best it can and offers a
 * "talk to a person" option the visitor can choose (see `shouldOfferHandoff`).
 *
 * Returns null when Twiga keeps the conversation.
 */
export function handoffReasonFor(input: {
  entryId: string | null;
  shouldOfferHandoff: boolean;
}): HandoffReason | null {
  if (input.entryId === "emergency") return HANDOFF_REASON.EMERGENCY;
  if (input.entryId === "human-handoff") return HANDOFF_REASON.REQUESTED;
  return null;
}

/** The suggestion chip offered when Twiga is not confident. Matches the human-handoff intent when tapped. */
export function talkToPersonFollowUp(language: string): string {
  return language === "sw" ? "Nataka kuongea na mtu" : "I would like to talk to a person";
}

/**
 * How long an agent can be silent before the chat returns to Twiga.
 *
 * A thread stays with a person while they are actually in it. Without a limit,
 * one agent reply kept every later message away from Twiga for good, so a
 * visitor tagging a hotel hours later got silence instead of an answer.
 */
export const AGENT_IDLE_RELEASE_MS = 30 * 60 * 1000;

/**
 * Whether a new visitor message should go back to Twiga.
 *
 * Only an AGENT_ACTIVE thread whose agent has gone quiet is released. A thread
 * still AWAITING_AGENT is never released: the visitor explicitly asked for a
 * person and is still waiting for one.
 */
export function shouldReleaseToTwiga(input: {
  status: string | null | undefined;
  lastAgentMessageAt: Date | null;
  now?: Date;
}): boolean {
  if (input.status !== CONVERSATION_STATUS.AGENT_ACTIVE) return false;
  if (!input.lastAgentMessageAt) return false;
  const now = input.now ?? new Date();
  return now.getTime() - input.lastAgentMessageAt.getTime() > AGENT_IDLE_RELEASE_MS;
}

/** Threads a person still has to act on: the admin console's "Open" view. */
export const OPEN_CONVERSATION_STATUSES: readonly string[] = [
  CONVERSATION_STATUS.AWAITING_AGENT,
  CONVERSATION_STATUS.AGENT_ACTIVE,
];

/**
 * How long a claimed thread can sit with no message from either side before it
 * resolves itself.
 *
 * Agents answer and move on without pressing Resolve, so "Agent on it" used to
 * pile up forever and buried the chats that still needed someone. Resolving is
 * not deleting: the transcript is kept, and a visitor who writes again is picked
 * up by Twiga and can ask for a person again.
 */
export const AGENT_ACTIVE_AUTO_RESOLVE_MS = 12 * 60 * 60 * 1000;
// AWAITING_AGENT is never auto-resolved: that visitor asked for a person and
// nobody has answered yet, so closing it would hide the one chat that matters.

/** Said once, when a quiet support thread comes back to Twiga. */
export function releasedToTwigaFor(language: string): string {
  return language === "sw"
    ? "Timu yetu ya msaada haipo kwenye mazungumzo haya kwa sasa, hivyo nimerudi kukusaidia. Kama bado unahitaji mtu, niambie tu."
    : "Our support team has stepped away from this chat, so I am back to help. If you still need a person, just say so.";
}

/**
 * What the visitor is told at the moment of handoff.
 *
 * Deliberately does not promise a response time. We do not have one to promise,
 * and an invented "within a few hours" is a broken promise waiting to happen.
 */
export const HANDOFF_ACKNOWLEDGEMENT: Record<string, { en: string; sw: string }> = {
  [HANDOFF_REASON.REQUESTED]: {
    en: "I have passed this to our support team. Someone will reply here in this chat, so you do not need to start again or go anywhere else.",
    sw: "Nimepeleka hili kwa timu yetu ya msaada. Mtu atakujibu hapa hapa kwenye mazungumzo haya, hivyo huhitaji kuanza upya wala kwenda mahali pengine.",
  },
  [HANDOFF_REASON.EMERGENCY]: {
    en: "I have flagged this to our support team as urgent. If anyone is in danger, please contact the emergency services first and do not wait for us.",
    sw: "Nimeliweka hili kwa timu yetu ya msaada kama la dharura. Kama kuna mtu yuko hatarini, tafadhali wasiliana na huduma za dharura kwanza na usisubiri sisi.",
  },
  [HANDOFF_REASON.LOW_CONFIDENCE]: {
    en: "I am not confident I answered that properly, so I have passed it to our support team. Someone will reply here in this chat.",
    sw: "Sina uhakika nimejibu hilo vizuri, hivyo nimelipeleka kwa timu yetu ya msaada. Mtu atakujibu hapa hapa kwenye mazungumzo haya.",
  },
};

/** The line shown while a thread is already waiting on a person. */
export const AWAITING_AGENT_NOTICE: { en: string; sw: string } = {
  en: "Your message has been added to the thread. Our support team has this one, so I will let them answer rather than talk over them.",
  sw: "Ujumbe wako umeongezwa kwenye mazungumzo. Timu yetu ya msaada inashughulikia hili, hivyo nitawaachia wajibu badala ya kuwakatiza.",
};

/**
 * Whether a hand-off must wait for the visitor to sign in.
 *
 * The support team needs to know who they are talking to and how to reach them
 * after the chat closes, so a person is only brought in for a signed-in
 * account. Emergencies are the exception: nobody should have to create an
 * account before a safety message reaches a human.
 */
export function requiresSignInForHandoff(reason: HandoffReason | null, userId: number | null): boolean {
  if (!reason || userId) return false;
  return reason !== HANDOFF_REASON.EMERGENCY;
}

/** What an anonymous visitor is told when they ask for a person. */
export const SIGN_IN_FOR_SUPPORT: Record<"requested" | "low_confidence", { en: string; sw: string }> = {
  requested: {
    en: "Our support team talks to signed-in customers, so they know who you are and can follow up after this chat.\n\nSign in or create a free account below. You will come straight back to this page, this conversation will still be here, and I will pass it to the team the moment you are in.",
    sw: "Timu yetu ya msaada huzungumza na wateja walioingia kwenye akaunti, ili wajue wewe ni nani na waweze kufuatilia baada ya mazungumzo haya.\n\nIngia au fungua akaunti bure hapa chini. Utarudi moja kwa moja kwenye ukurasa huu, mazungumzo haya yatakuwepo, na nitayapeleka kwa timu mara tu utakapoingia.",
  },
  low_confidence: {
    en: "I am not confident I can answer that properly. A person from our team can, and they talk to signed-in customers.\n\nSign in or create a free account below and you will come straight back here, with this conversation already passed to the team.",
    sw: "Sina uhakika naweza kujibu hilo vizuri. Mtu kutoka timu yetu anaweza, na wanazungumza na wateja walioingia kwenye akaunti.\n\nIngia au fungua akaunti bure hapa chini na utarudi hapa moja kwa moja, mazungumzo haya yakiwa yamepelekwa kwa timu.",
  },
};

export function signInForSupportFor(reason: HandoffReason, language: string): string {
  const copy = reason === HANDOFF_REASON.LOW_CONFIDENCE ? SIGN_IN_FOR_SUPPORT.low_confidence : SIGN_IN_FOR_SUPPORT.requested;
  return language === "sw" ? copy.sw : copy.en;
}

/** Said once the visitor is back from signing in and the hand-off has happened. */
export function signedInHandoffFor(language: string, firstName: string | null): string {
  const name = firstName ? ` ${firstName}` : "";
  return language === "sw"
    ? `Karibu tena${name}. Nimepeleka mazungumzo haya kwa timu yetu ya msaada. Mtu atakujibu hapa hapa, hivyo huhitaji kuanza upya.`
    : `Welcome back${name}. I have passed this conversation to our support team. Someone will reply right here, so you do not need to start again.`;
}

/**
 * The page to return to after sign-in, with the resume marker the widget
 * looks for. Only same-site paths are accepted, so this cannot be turned into
 * an open redirect.
 */
export function returnPathForHandoff(page: string | null | undefined): string {
  const raw = typeof page === "string" ? page.trim() : "";
  const safe = raw.startsWith("/") && !raw.startsWith("//") && !raw.includes("\\") ? raw : "/";
  const url = new URL(safe, "https://twiga.invalid");
  url.searchParams.delete("twiga");
  url.searchParams.set("twiga", "handoff");
  return `${url.pathname}${url.search}`;
}

export function acknowledgementFor(reason: HandoffReason, language: string): string {
  const copy = HANDOFF_ACKNOWLEDGEMENT[reason];
  if (!copy) return HANDOFF_ACKNOWLEDGEMENT[HANDOFF_REASON.REQUESTED].en;
  return language === "sw" ? copy.sw : copy.en;
}

/**
 * True for the old "your message has been added to the thread" line.
 *
 * It used to be stored after every visitor message while a person had the
 * chat, which filled transcripts with the same sentence. Delivery ticks replace
 * it now; this lets readers hide the copies already saved.
 */
export function isAwaitingNotice(content: string | null | undefined): boolean {
  const text = String(content ?? "").trim();
  return text === AWAITING_AGENT_NOTICE.en || text === AWAITING_AGENT_NOTICE.sw;
}

export function awaitingNoticeFor(language: string): string {
  return language === "sw" ? AWAITING_AGENT_NOTICE.sw : AWAITING_AGENT_NOTICE.en;
}
