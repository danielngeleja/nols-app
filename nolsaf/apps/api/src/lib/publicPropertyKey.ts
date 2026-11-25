/**
 * Public property addresses end in the property's opaque booking key
 * ("sea-view-flats-<key>"). Returns the key, or null for anything else.
 */
export function extractPublicKeyFromSlug(idOrSlug: string): string | null {
  const raw = String(idOrSlug || "").trim().toLowerCase();
  if (!raw) return null;
  const key = raw.includes("-") ? raw.slice(raw.lastIndexOf("-") + 1) : raw;
  return /^[a-z0-9]{20,40}$/.test(key) ? key : null;
}
