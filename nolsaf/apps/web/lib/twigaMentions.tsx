import type { ReactNode } from "react";
import { Building2, MapPin } from "lucide-react";

/*
 * Twiga @-mention tokens, as stored in chat message content by the API
 * (apps/api/src/lib/twiga/mentions.ts):
 *
 *   @[Sea Breeze Villa](property:sea-breeze-villa-ck...)
 *   @[Zanzibar](region:Zanzibar)
 *
 * The server has already validated every token that reaches a transcript, so
 * this file only parses and renders.
 */

const TOKEN = /@\[([^\]\n]{1,120})\]\((property|region):([^)\s]{1,200})\)/g;

export type MentionPart =
  | { type: "text"; value: string }
  | { type: "mention"; kind: "property" | "region"; label: string; href: string };

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function mentionHref(kind: "property" | "region", value: string): string {
  if (kind === "property") {
    // Older tokens were "id|slug"; only the public slug is ever used.
    const slug = value.includes("|") ? value.slice(value.indexOf("|") + 1) : value;
    return slug ? `/public/properties/${encodeURIComponent(slug)}` : "/public/properties";
  }
  return `/public/properties?region=${encodeURIComponent(safeDecode(value))}`;
}

export function parseMentions(text: string): MentionPart[] {
  const parts: MentionPart[] = [];
  let last = 0;
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > last) parts.push({ type: "text", value: text.slice(last, start) });
    const [whole, label, kind, value] = match;
    parts.push({ type: "mention", kind: kind as "property" | "region", label, href: mentionHref(kind as "property" | "region", value) });
    last = start + whole.length;
  }
  if (last < text.length) parts.push({ type: "text", value: text.slice(last) });
  return parts;
}

/** Message text with tokens reduced to "@Label", for previews and length checks. */
export function stripMentions(text: string): string {
  return text.replace(TOKEN, (_w, label: string) => `@${label}`);
}

export type MentionTone = "onBrand" | "twiga" | "agent" | "light";

const TONES: Record<MentionTone, string> = {
  // on the visitor's own green bubble
  onBrand: "bg-white/15 text-white hover:bg-white/25",
  // dark Twiga surface
  twiga: "bg-emerald-400/10 text-emerald-200 ring-1 ring-inset ring-emerald-400/25 hover:bg-emerald-400/20",
  // dark support surface
  agent: "bg-amber-400/10 text-amber-100 ring-1 ring-inset ring-amber-400/25 hover:bg-amber-400/20",
  // light admin console
  light: "bg-[#02665e]/[0.08] text-[#02665e] ring-1 ring-inset ring-[#02665e]/20 hover:bg-[#02665e]/15",
};

/**
 * Render text with mention tokens as linked chips.
 * `openInNewTab` for the admin console, where leaving the case file would lose
 * the reply draft.
 */
export function renderWithMentions(text: string, tone: MentionTone, openInNewTab = false): ReactNode[] {
  return parseMentions(text).map((part, i) => {
    if (part.type === "text") return part.value;
    const Icon = part.kind === "property" ? Building2 : MapPin;
    return (
      <a
        key={`m-${i}`}
        href={part.href}
        target={openInNewTab ? "_blank" : undefined}
        rel={openInNewTab ? "noopener noreferrer" : undefined}
        title={part.kind === "property" ? `Open ${part.label}` : `Stays in ${part.label}`}
        className={`mx-px inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-px align-baseline text-[0.95em] font-semibold no-underline transition ${TONES[tone]}`}
      >
        <Icon className="h-3 w-3 flex-shrink-0" aria-hidden />
        <span className="truncate">{part.label}</span>
      </a>
    );
  });
}
