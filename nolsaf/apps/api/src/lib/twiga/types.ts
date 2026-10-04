/**
 * Twiga knowledge registry: shared types.
 *
 * Twiga answers from a registry of typed entries rather than a chain of if
 * statements. Every entry is addressable by a stable `id`, carries its own
 * priority, and declares who it is for. That makes matching order explicit,
 * makes answers translatable, and lets the admin console report which intents
 * actually fire in production.
 */

export const TWIGA_LANGUAGES = ["en", "sw", "es", "fr", "pt", "ar", "zh"] as const;
export type TwigaLanguage = (typeof TWIGA_LANGUAGES)[number];

/** Who an entry is written for. Resolution is scoped so owners never get customer copy. */
export type TwigaAudience = "customer" | "owner" | "both";

/**
 * Priority bands. Higher wins. These are explicit so a broad entry can never
 * shadow a specific one just because it sits earlier in the file, which is the
 * failure mode of the original if-chain.
 */
export const PRIORITY = {
  /** Safety and explicit requests for a human. Always wins. */
  CRITICAL: 100,
  /** Anchored conversational openers and closers. */
  CONVERSATION: 90,
  /** "Where is my X", "my payment failed". Account-specific, grounded in Phase 2. */
  TRANSACTIONAL: 80,
  /** How a NoLSAF service works. */
  SERVICE: 70,
  /** Joining the platform in some role. */
  ONBOARDING: 60,
  /** Inventory, pricing, amenities. */
  CATALOGUE: 50,
  /** Places. */
  DESTINATION: 40,
  /** Practical travel information that is not NoLSAF specific. */
  TRAVEL_INFO: 30,
  /** Brand, trust, business model. */
  BRAND: 20,
  /** Everything else worth answering. */
  GENERAL: 10,
} as const;

export interface TwigaLink {
  label: string;
  /** Path relative to the site root, or an absolute URL for external references. */
  href: string;
}

/** Answer copy, keyed by language. English is required as the guaranteed fallback. */
export type TwigaAnswer = Partial<Record<TwigaLanguage, string>> & { en: string };

export interface TwigaEntry {
  /** Stable, kebab-case. Never reuse an id for different content: analytics depend on it. */
  id: string;
  audience: TwigaAudience;
  priority: number;
  /** Any match counts. Keep each pattern readable rather than building one mega-regex. */
  patterns: RegExp[];
  /** If any of these match, the entry is skipped. Use to carve a specific entry out of a broad one. */
  exclude?: RegExp[];
  answer: TwigaAnswer;
  /** Deep links rendered as buttons under the answer. */
  links?: TwigaLink[];
  /** Suggested next questions, rendered as tappable chips. */
  followUps?: string[];
  /**
   * Product truth this entry asserts that could not be confirmed from the
   * codebase. Surfaced by `npm run twiga:verify` so it gets checked by a human
   * instead of quietly going stale, which is how the old copy ended up
   * advertising Stripe and a mobile app that does not exist.
   */
  verify?: string;
}

/** What the resolver returns. */
export interface TwigaMatch {
  entry: TwigaEntry;
  /** 1 for a direct pattern hit, lower for a fuzzy hit. Phase 3 escalates below a floor. */
  confidence: number;
  /** Which pattern matched, for debugging in the admin console. */
  matchedBy: string;
}

export interface TwigaResolution {
  /** The chosen answer, already resolved to the requested language. */
  text: string;
  /** Null when nothing matched and the fallback was used. */
  entryId: string | null;
  confidence: number;
  links: TwigaLink[];
  followUps: string[];
  /** True when the caller should be offered a human. */
  shouldOfferHandoff: boolean;
}

export interface TwigaContext {
  language: TwigaLanguage;
  /** Scopes which entries are eligible. A signed-in owner sees owner + both. */
  audience: Exclude<TwigaAudience, "both">;
  /** Present once the visitor is signed in. Phase 2 uses this to ground answers. */
  userId?: number | null;
}
