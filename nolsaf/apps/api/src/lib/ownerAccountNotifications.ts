import { notifyAdmins } from "./notifications.js";

const changes = {
  payoutAdded: ["payout", "Added a payout destination"],
  payoutChanged: ["payout", "Changed the payout destination"],
  passwordChanged: ["security", "Changed the account password"],
  passwordReset: ["security", "Reset the account password"],
  passwordCreated: ["security", "Set an account password"],
  emailChanged: ["security", "Changed the account email"],
  phoneChanged: ["security", "Changed the account phone number"],
  twoFactorEnabled: ["security", "Enabled two-step verification"],
  twoFactorDisabled: ["security", "Disabled two-step verification"],
  backupCodesReplaced: ["security", "Replaced two-step verification backup codes"],
  profileUpdated: ["profile", "Updated the account profile"],
  documentUpdated: ["profile", "Updated an account document"],
} as const;

type OwnerAccountChange = keyof typeof changes;

export async function notifyOwnerAccountChange(role: string | undefined | null, ownerId: number, change: OwnerAccountChange) {
  if (role !== "OWNER") return;

  const [category, title] = changes[change];
  await notifyAdmins(`owner_account_${category}`, {
    accountOwnerId: ownerId,
    change,
    changeTitle: title,
    href: `/admin/owners/${ownerId}?tab=activity&category=${category}`,
  });
}
