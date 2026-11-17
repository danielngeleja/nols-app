// The operator's company logo, shown in the workspace header. The profile page
// announces a saved logo with this event so the header updates without a reload.
export const AGENT_LOGO_EVENT = "agent:logo";

/** Only images stored by NoLSAF's own upload service; anything else is ignored. */
export function nolsafImageUrl(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && url.hostname === "res.cloudinary.com" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function announceAgentLogo(logoUrl: string | null | undefined) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AGENT_LOGO_EVENT, { detail: { logoUrl: logoUrl || null } }));
}
