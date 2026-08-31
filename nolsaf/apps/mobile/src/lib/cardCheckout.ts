export type CardCheckoutBrowserResult = {
  type: string;
  url?: string | null;
};

export type CardCheckoutOutcome =
  | { kind: "closed" }
  | { kind: "returned"; status: "success" | "failed" | "pending" };

/**
 * Distinguish a hosted checkout redirect from the customer closing the browser.
 * The returned status is only a UI hint; callers must still verify payment with
 * the NoLSAF API before showing success.
 */
export function classifyCardCheckoutResult(result: CardCheckoutBrowserResult): CardCheckoutOutcome {
  if (result.type !== "success") return { kind: "closed" };

  if (!result.url) return { kind: "returned", status: "pending" };

  try {
    const cardReturn = new URL(result.url).searchParams.get("cardReturn")?.toLowerCase();
    if (cardReturn === "success" || cardReturn === "failed") {
      return { kind: "returned", status: cardReturn };
    }
  } catch {
    // A redirect reached the app but did not contain a parseable status. Keep
    // server verification active instead of guessing at the payment outcome.
  }

  return { kind: "returned", status: "pending" };
}
