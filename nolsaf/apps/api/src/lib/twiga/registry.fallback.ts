import type { TwigaEntry } from "./types";
import { PRIORITY } from "./types";

/**
 * Used when nothing matched. Deliberately short: the old catch-all dumped a
 * feature list at anyone whose message began with a question word, which meant
 * most real questions never reached their proper answer at all.
 *
 * This one admits it did not understand and routes onward, which is also the
 * trigger for the human handoff in Phase 3.
 */
export const FALLBACK: TwigaEntry = {
  id: "fallback",
  audience: "both",
  priority: PRIORITY.GENERAL,
  patterns: [],
  answer: {
    en: "I did not quite catch that, sorry. Could you try rephrasing it?\n\nI can help with bookings, payments, cancellations, transport, tours, group stays, and your account. If you would rather talk to a person, just say so and I will pass you to our support team.",
    sw: "Samahani, sijaelewa vizuri. Unaweza kuuliza kwa njia nyingine?\n\nNaweza kusaidia na uhifadhi, malipo, kughairi, usafiri, ziara, makazi ya kikundi, na akaunti yako. Kama unapendelea kuongea na mtu, niambie tu nitakuunganisha na timu yetu ya msaada.",
  },
  followUps: [
    "How do I book a property?",
    "Where is my booking?",
    "What payment methods do you accept?",
    "Talk to a person",
  ],
};

/**
 * Shown for a very short unmatched message, instead of the fallback.
 *
 * A one-word message is usually a topic, not a question, and treating it as a
 * failure escalated people to a human for something Twiga could have answered
 * if they had given it one more word. Asking costs nothing; queueing a person
 * for "NRMS" wastes their time and the visitor's.
 */
export const TOO_SHORT: TwigaEntry = {
  id: "too-short",
  audience: "both",
  priority: PRIORITY.GENERAL,
  patterns: [],
  answer: {
    en: "Could you give me a bit more to go on? Even a few words helps, for example what you want to do with it or what has gone wrong.",
    sw: "Unaweza kunipa maelezo kidogo zaidi? Hata maneno machache yanasaidia, kwa mfano unataka kufanya nini nacho au nini kimeenda vibaya.",
  },
};
