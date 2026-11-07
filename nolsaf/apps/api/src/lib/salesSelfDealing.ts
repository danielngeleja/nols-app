/**
 * Self-dealing checks for sales partner earnings.
 *
 * A sales partner earns a share of NoLSAF's revenue from the properties they
 * bring in. That share must never come from their own property, or from stays
 * they book themselves: both turn the commission into a kickback on money the
 * partner controls. These checks compare the partner's identity (user, email,
 * phone) with the property owner and with the booking guest.
 */

/** Digits only, last 9: matches 0712…, +255712… and 255712… as one number. */
export function phoneKey(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

/**
 * Payout destination key: mobile money numbers compare like phones (last 9
 * digits), bank account numbers compare on all their digits.
 */
export function payoutAccountKey(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length < 6) return null;
  return digits.length >= 9 && digits.length <= 12 ? digits.slice(-9) : digits;
}

function emailKey(value: unknown): string | null {
  const email = String(value ?? "").trim().toLowerCase();
  return email.includes("@") ? email : null;
}

export type PartnerIdentity = {
  userId: number;
  emails: Set<string>;
  phones: Set<string>;
  /** The partner's payout destination, so a shared wallet or bank account is caught. */
  payoutKeys: Set<string>;
};

/** Everything that identifies a sales partner: their user account and the phone on their partner profile. */
export async function loadPartnerIdentity(tx: any, salesPartnerId: number): Promise<PartnerIdentity | null> {
  const partner = await tx.salesPartnerProfile.findUnique({
    where: { id: salesPartnerId },
    select: { userId: true, phone: true, payoutAccount: true, user: { select: { email: true, phone: true } } },
  });
  if (!partner) return null;
  const emails = new Set<string>();
  const phones = new Set<string>();
  for (const e of [partner.user?.email]) {
    const k = emailKey(e);
    if (k) emails.add(k);
  }
  for (const p of [partner.phone, partner.user?.phone]) {
    const k = phoneKey(p);
    if (k) phones.add(k);
  }
  const payoutKeys = new Set<string>();
  const payoutKey = payoutAccountKey(partner.payoutAccount);
  if (payoutKey) payoutKeys.add(payoutKey);
  return { userId: partner.userId, emails, phones, payoutKeys };
}

function matchesPerson(
  identity: PartnerIdentity,
  person: { id?: number | null; email?: string | null; phone?: string | null } | null | undefined,
): "account" | "email" | "phone" | null {
  if (!person) return null;
  if (person.id != null && person.id === identity.userId) return "account";
  const e = emailKey(person.email);
  if (e && identity.emails.has(e)) return "email";
  const p = phoneKey(person.phone);
  if (p && identity.phones.has(p)) return "phone";
  return null;
}

/**
 * Why this partner may not earn from this property, or null when they may.
 * Blocks a partner who is the property owner (same account, email or phone)
 * or who is paid into the same account as the owner.
 */
export async function partnerOwnsPropertyReason(
  tx: any,
  identity: PartnerIdentity,
  propertyId: number,
): Promise<string | null> {
  const property = await tx.property.findUnique({
    where: { id: propertyId },
    select: { owner: { select: { id: true, email: true, phone: true } } },
  });
  const owner = property?.owner;
  const hit = matchesPerson(identity, owner);
  if (hit) return `The sales partner is the property owner (same ${hit}).`;
  if (owner?.id && identity.payoutKeys.size) {
    const ownerAccounts = await tx.payoutAccount.findMany({
      where: { userId: owner.id, isActive: true },
      select: { accountNumber: true },
    });
    const shared = ownerAccounts.some((account: any) => {
      const key = payoutAccountKey(account.accountNumber);
      return key ? identity.payoutKeys.has(key) : false;
    });
    if (shared) return "The sales partner is paid into the same account as the property owner.";
  }
  return null;
}

/**
 * Why a booking may not earn this partner commission, or null when it may.
 * Blocks stays booked by the partner themself (account or phone).
 */
export function partnerBookedStayReason(
  identity: PartnerIdentity,
  booking: { userId?: number | null; guestPhone?: string | null; user?: { email?: string | null; phone?: string | null } | null },
): string | null {
  const hit =
    matchesPerson(identity, { id: booking.userId, email: booking.user?.email, phone: booking.user?.phone }) ??
    matchesPerson(identity, { phone: booking.guestPhone });
  return hit ? `The guest on this booking is the sales partner (same ${hit}).` : null;
}
