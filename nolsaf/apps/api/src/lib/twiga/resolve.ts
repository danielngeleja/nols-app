/**
 * Twiga resolver.
 *
 * Picks the best entry for an utterance by priority, not by source order, then
 * renders it in the requested language. Falls back to a fuzzy pass so typos
 * still land, and reports a confidence so Phase 3 can escalate to a human
 * instead of replying with a shrug.
 */

import type {
  TwigaContext,
  TwigaEntry,
  TwigaLanguage,
  TwigaMatch,
  TwigaResolution,
} from "./types";
import { FALLBACK, TOO_SHORT } from "./registry.fallback";

/** Below this we answer, but also offer a human. */
export const HANDOFF_CONFIDENCE_FLOOR = 0.75;

/** Levenshtein distance, used only in the fuzzy pass. */
function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: a.length + 1 }, (_, i) => i);
  let curr = new Array<number>(a.length + 1);

  for (let i = 1; i <= b.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= a.length; j++) {
      const cost = b.charAt(i - 1) === a.charAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(prev[j - 1] + cost, curr[j - 1] + 1, prev[j] + 1);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[a.length];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/** Words worth fuzzy matching on. Short words produce too many false positives. */
function significantWords(input: string): string[] {
  return (input.toLowerCase().match(/\b[\p{L}]{4,}\b/gu) ?? []).slice(0, 24);
}

function isEligible(entry: TwigaEntry, ctx: TwigaContext): boolean {
  return entry.audience === "both" || entry.audience === ctx.audience;
}

/** Exact pass: a pattern hit. Highest priority wins; ties break on longer pattern. */
function findExact(input: string, entries: TwigaEntry[], ctx: TwigaContext): TwigaMatch | null {
  let best: TwigaMatch | null = null;

  for (const entry of entries) {
    if (!isEligible(entry, ctx)) continue;
    if (entry.exclude?.some((rx) => rx.test(input))) continue;

    const hit = entry.patterns.find((rx) => rx.test(input));
    if (!hit) continue;

    if (
      !best ||
      entry.priority > best.entry.priority ||
      (entry.priority === best.entry.priority && hit.source.length > best.matchedBy.length)
    ) {
      best = { entry, confidence: 1, matchedBy: hit.source };
    }
  }

  return best;
}

/**
 * Fuzzy pass: no pattern hit, so compare the utterance's significant words
 * against each entry's keywords. Only runs when the exact pass found nothing.
 */
function findFuzzy(input: string, entries: TwigaEntry[], ctx: TwigaContext): TwigaMatch | null {
  const words = significantWords(input);
  if (words.length === 0) return null;

  // `rank` is internal: it decides which fuzzy hit wins, while `confidence`
  // stays a plain function of similarity for the handoff threshold.
  let best: (TwigaMatch & { rank: number }) | null = null;

  for (const entry of entries) {
    if (!isEligible(entry, ctx)) continue;
    if (entry.exclude?.some((rx) => rx.test(input))) continue;

    for (const rx of entry.patterns) {
      // Pull literal keywords out of the pattern source; regex syntax is noise here.
      const keywords = rx.source.match(/[a-z]{4,}/gi) ?? [];
      for (const keyword of keywords) {
        for (const word of words) {
          const score = similarity(keyword.toLowerCase(), word);
          if (score < 0.82) continue;

          // Rank by how much the match actually tells us, then use priority
          // only to break a genuine tie.
          //
          // Two things this gets right that the earlier versions did not:
          //
          //  - Priority no longer overrides match quality. It used to sort by
          //    priority first, so "nolsaf" returned driver registration purely
          //    because that entry outranks the brand entry, having matched the
          //    word only incidentally inside "drive for nolsaf".
          //  - Longer keywords count for more. A four letter word like "need"
          //    matching exactly says far less about intent than "cancellation"
          //    matching with a single typo, so raw similarity alone sent
          //    "i need a cancelation" to account registration.
          //
          // The weight is for ranking only. The reported confidence stays a
          // plain function of similarity so the handoff threshold keeps its
          // meaning.
          const confidence = score * 0.9;
          const rank = confidence * Math.min(1, keyword.length / 9);
          if (
            !best ||
            rank > best.rank ||
            (rank === best.rank && entry.priority > best.entry.priority)
          ) {
            best = { entry, confidence, rank, matchedBy: `~${keyword}` };
          }
        }
      }
    }
  }

  if (!best) return null;
  const { rank: _rank, ...match } = best;
  return match;
}

/** Render an entry's copy in the requested language, falling back to English. */
export function renderAnswer(entry: TwigaEntry, language: TwigaLanguage): string {
  return entry.answer[language] ?? entry.answer.en;
}

export function resolve(
  utterance: string,
  entries: TwigaEntry[],
  ctx: TwigaContext
): TwigaResolution {
  const input = utterance.toLowerCase().trim();

  const match = findExact(input, entries, ctx) ?? findFuzzy(input, entries, ctx);

  if (!match) {
    // A one or two word message that matched nothing is almost always a topic
    // rather than a question. Ask for more instead of declaring failure and
    // queueing a human, which is how "NRMS" ended up escalated to support.
    const wordCount = input.split(/\s+/).filter(Boolean).length;
    if (wordCount > 0 && wordCount <= 2) {
      return {
        text: renderAnswer(TOO_SHORT, ctx.language),
        entryId: TOO_SHORT.id,
        confidence: 1,
        links: [],
        followUps: TOO_SHORT.followUps ?? [],
        shouldOfferHandoff: false,
      };
    }

    return {
      text: renderAnswer(FALLBACK, ctx.language),
      entryId: null,
      confidence: 0,
      links: FALLBACK.links ?? [],
      followUps: FALLBACK.followUps ?? [],
      shouldOfferHandoff: true,
    };
  }

  return {
    text: renderAnswer(match.entry, ctx.language),
    entryId: match.entry.id,
    confidence: match.confidence,
    links: match.entry.links ?? [],
    followUps: match.entry.followUps ?? [],
    shouldOfferHandoff: match.confidence < HANDOFF_CONFIDENCE_FLOOR,
  };
}
