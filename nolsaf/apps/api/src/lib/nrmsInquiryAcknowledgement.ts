export type InquiryAcknowledgementInput = {
  propertyTitle: string;
  guestName?: string | null;
  checkIn?: string | null;
  checkOut?: string | null;
  channels?: { whatsapp?: boolean; instagram?: boolean; phone?: boolean };
};

function stayLabel(checkIn?: string | null, checkOut?: string | null): string | null {
  if (!checkIn || !checkOut) return null;
  const start = new Date(`${checkIn}T00:00:00.000Z`);
  const end = new Date(`${checkOut}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const sameMonth = start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth();
  const month = (value: Date) => new Intl.DateTimeFormat("en", { month: "long", timeZone: "UTC" }).format(value);
  const startText = sameMonth ? String(start.getUTCDate()) : `${start.getUTCDate()} ${month(start)}`;
  const endText = `${end.getUTCDate()} ${month(end)}`;
  return `${startText}–${endText}`;
}

export function buildInquiryAcknowledgement(input: InquiryAcknowledgementInput): string {
  const firstName = input.guestName?.trim().split(/\s+/)[0];
  const greeting = firstName ? `Hello ${firstName}` : "Hello";
  const stay = stayLabel(input.checkIn, input.checkOut);
  const channels = [
    input.channels?.whatsapp ? "WhatsApp" : null,
    input.channels?.instagram ? "Instagram" : null,
    input.channels?.phone ? "phone" : null,
  ].filter((value): value is string => Boolean(value));
  const continuation = channels.length
    ? ` You can continue on ${channels.length === 1 ? channels[0] : `${channels.slice(0, -1).join(", ")} or ${channels.at(-1)}`}.`
    : " Reception will contact you using the details you provided.";
  return `${greeting}, we received your request${stay ? ` for ${stay}` : ""}. ${input.propertyTitle} reception is checking availability.${continuation}`;
}
