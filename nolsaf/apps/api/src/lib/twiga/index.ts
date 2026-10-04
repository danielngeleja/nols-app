/**
 * Twiga: NoLSAF's support assistant.
 *
 * Public surface for the rest of the API. Callers ask a question and get back a
 * resolution; they do not reach into the registry directly.
 */

import { CUSTOMER_ENTRIES } from "./registry.customer";
import { OWNER_ENTRIES } from "./registry.owner";
import { FALLBACK } from "./registry.fallback";
import { resolve } from "./resolve";
import { TWIGA_LANGUAGES } from "./types";
import type { TwigaContext, TwigaEntry, TwigaLanguage, TwigaResolution } from "./types";

export * from "./types";
export { HANDOFF_CONFIDENCE_FLOOR } from "./resolve";

/**
 * Every entry Twiga knows about. Split by audience so the two bodies of
 * content can be written and reviewed independently; the resolver scopes them.
 */
export const ALL_ENTRIES: TwigaEntry[] = [...CUSTOMER_ENTRIES, ...OWNER_ENTRIES];

/** Guard against a duplicate id silently shadowing an entry in the resolver. */
const duplicateIds = ALL_ENTRIES.map((e) => e.id).filter((id, i, all) => all.indexOf(id) !== i);
if (duplicateIds.length > 0) {
  throw new Error(`Twiga registry has duplicate entry ids: ${duplicateIds.join(", ")}`);
}

export function isTwigaLanguage(value: unknown): value is TwigaLanguage {
  return typeof value === "string" && (TWIGA_LANGUAGES as readonly string[]).includes(value);
}

export function ask(utterance: string, ctx: Partial<TwigaContext> = {}): TwigaResolution {
  const language = isTwigaLanguage(ctx.language) ? ctx.language : "en";
  return resolve(utterance, ALL_ENTRIES, {
    language,
    audience: ctx.audience ?? "customer",
    userId: ctx.userId ?? null,
  });
}

/**
 * Backwards-compatible shim for the original `getAutomatedResponse`.
 *
 * Returns only the answer text, so existing callers keep working while the
 * route is migrated to `ask` and starts using links, follow-ups, and the
 * handoff signal.
 */
export function getAutomatedResponse(userInput: string, language: string = "en"): string {
  return ask(userInput, { language: isTwigaLanguage(language) ? language : "en" }).text;
}

/** Entries asserting product truth that a human still needs to confirm. */
export function pendingVerification(): Array<{ id: string; note: string }> {
  return [...ALL_ENTRIES, FALLBACK]
    .filter((e): e is TwigaEntry & { verify: string } => typeof e.verify === "string")
    .map((e) => ({ id: e.id, note: e.verify }));
}
