/**
 * Tanzanian mobile network prefixes, used to check that a phone number belongs to the
 * wallet a person picked (e.g. a Vodacom number with Airtel Money selected).
 *
 * Source: TCRA National Numbering and Signaling Point Codes Plan, Version 1.16 (June 2026).
 * Prefixes are advisory: a subscriber may keep their number after porting to another network.
 */
export type TzMobileNetwork = "yas" | "airtel" | "vodacom" | "halotel";

export const TZ_MOBILE_PREFIXES: Record<TzMobileNetwork, readonly string[]> = {
  yas: ["65", "67", "70", "71", "77"],
  airtel: ["66", "68", "69", "78"],
  vodacom: ["72", "74", "75", "76", "79"],
  halotel: ["61", "62", "63"],
};

/** The 9 subscriber digits after 0 / 255 / +255 (may be shorter while typing). */
export function tzSubscriberDigits(value: unknown): string {
  let digits = String(value ?? "").replace(/\D/g, "");
  if (digits.startsWith("255")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 9);
}

/** Network that normally owns this number, or null when the prefix is unknown or too short. */
export function tzNetworkForNumber(value: unknown): TzMobileNetwork | null {
  const subscriber = tzSubscriberDigits(value);
  if (subscriber.length < 2) return null;
  const prefix = subscriber.slice(0, 2);
  const hit = (Object.entries(TZ_MOBILE_PREFIXES) as Array<[TzMobileNetwork, readonly string[]]>).find(([, list]) =>
    list.includes(prefix)
  );
  return hit ? hit[0] : null;
}
