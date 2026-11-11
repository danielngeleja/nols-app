# Admin notifications

The admin inbox (bell drawer and `/admin/messages`) is NoLSAF's communication
desk. An alert that disappears unhandled is a customer, owner or payment left
waiting, so it follows these rules (since 2026-11-11):

* **Nobody deletes an admin alert.** `DELETE /api/admin/notifications/:id`
  answers 405. Platform alerts are one shared row for every admin, so a delete
  used to remove it for everyone.
* **Alerts that ask for action stay until resolved.** "Resolve" records the
  admin's name and time (`resolvedById`, `resolvedAt`, optional note).
* **Information-only alerts settle when read**, with the reader recorded.
* **Read and resolved alerts clear themselves 7 days later**
  (`lib/adminNotificationRetention.ts`, hourly). Unread or unresolved alerts
  are never removed. Only the admin inbox is touched.
* **Severity, area and "needs action" come from one registry,**
  `apps/api/src/lib/adminNotificationKinds.ts`, never from words in the title.
  A kind missing from the registry is treated as needing action, so it can
  never be cleared unseen.

Schema: migration `20261111120000_add_admin_notification_lifecycle` adds
`readById`, `requiresAction`, `resolvedAt`, `resolvedById` to `notification`.

## Adding an event

1. Call `notifyAdmins("<kind>", { ...facts, href: "/admin/..." })` after the
   change commits (never inside a money transaction).
2. Add a title and body template for `<kind>` in `lib/notifications.ts`.
3. Add `<kind>` to `ADMIN_NOTIFICATION_KINDS` with its severity, category and
   whether it needs action. Critical alerts sound as urgent in the drawer.

## Events wired on 2026-11-11 (were silent before)

| Kind | When | Needs action |
| --- | --- | --- |
| `payout_disbursement_failed` | A payout transfer fails at the provider | yes, critical |
| `payout_security_review` | A payout is stopped before sending by an integrity check | yes, critical |
| `payout_amount_mismatch` | The provider reports a different payout amount (once per distinct mismatch) | yes, critical |
| `payout_correlation_mismatch` | A provider callback does not match the payout (once per distinct mismatch) | yes, critical |
| `tour_booking_paid` | A tour booking is paid | no |
| `group_stay_deposit_paid` | A group stay deposit is paid | no |
| `group_stay_request_created` | A customer posts a group stay request | yes |
| `partner_account_registered` | A property owner or driver account is created | yes |
| `driver_account_deleted` | A driver deletes their account (with trips returned to the pool) | yes |
| `sales_partner_owner_disputed` | An owner answers "no" or "I don't know them" about a sales partner | yes |
| `sales_partner_nrms_claim_lapsed` | An unadopted NRMS claim lapses after 90 days | no |
| `tour_cancellation_auto_cancelled_unpaid` | Template added (it used to show raw data) | no |

## Considered and left out

* New traveller accounts: high volume, nothing for an admin to do.
* Actions an admin takes themselves (approve, refund, revoke, reassign): the
  audit log already records them.
* Owner, operator, driver and traveller inboxes: unchanged, they keep their
  own delete rules.
