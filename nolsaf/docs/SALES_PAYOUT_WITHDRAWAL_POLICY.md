# Sales partner withdrawal policy

Status: built 2026-11-08 on `staging`, uncommitted. Migration
`20261108090000_add_sales_payout_withdrawal` is prepared and NOT applied.

Decisions (Daniel, 2026-11-08):

- Fraud signals freeze ALL of the partner's withdrawals until an admin clears
  them with a reason. Normal checks only send that one withdrawal to review.
- Largest automatic withdrawal: TSh 500,000 (admin setting).
- A partner's first withdrawal is always checked by a person.

## Flow

1. **Withdraw** (`POST /api/sales/payouts/withdrawal/code`). Blocked before any
   code is sent when:
   - the partner is not ACTIVE;
   - withdrawals are frozen or locked;
   - there is no verified phone or email;
   - the phone, email or payout account changed inside the recent-change window;
   - another withdrawal is still on its way;
   - nothing is available, or the total is below TSh 50,000.

   The code itself:
   - is 6 digits, sent by SMS with email as fallback;
   - is valid for 5 minutes and works once;
   - is limited to 3 requests per 15 minutes;
   - is bound by fingerprint to the earnings, the total and the payout account;
   - is stored as a hash only.
2. **Confirm** (`POST /api/sales/payouts/withdrawal/confirm`). This step:
   - re-checks the live earnings and account against the fingerprint, and any
     change kills the code;
   - runs every rule;
   - creates the payout request with `lane` and `reviewFlags`.

   Three wrong codes in a row lock withdrawals and freeze the partner.
3. **AUTO** (no rule broken): the system approves the request (withholding
   tax applies), then creates and approves a `SALES_PAYOUT` disbursement with
   `releaseLane = AUTO`. The owner payout-release worker batches and sends it.
   Sending uses:
   - the shared kill switch (`autoPayoutEnabled`);
   - the shared daily cap (`autoPayoutDailyCapTzs`);
   - name-lookup re-verification;
   - fingerprints;
   - risk scoring.

   If the handoff stops halfway, the sales lifecycle worker resumes it. After
   3 failures, or on any account or partner change, the payout goes to review.
4. **REVIEW** (any rule broken): the payout goes to `UNDER_REVIEW` with the
   reasons. Admins approve or reject it in Sales finance as before, then send
   it from Disbursements.

## Rules

| Code | Severity | Rule |
| --- | --- | --- |
| SELF_DEALING | Fraud signal | Earnings from a property the partner owns or shares a payout account with |
| SELF_BOOKED_STAY | Fraud signal | Earnings from a stay the partner booked |
| ACCOUNT_SHARED | Fraud signal | Payout account registered by another user |
| NAME_MISMATCH | Fraud signal | Account holder name shares no name with the partner |
| OWNER_DENIAL | Fraud signal | An owner denied the partner (or said "unknown partner") in the last 90 days |
| FLAGGED_VISITS | Fraud signal | Flagged visits still unreviewed |
| LEADERBOARD_EXCLUDED | Fraud signal | Excluded from this month's leaderboard |
| RISK_CRITICAL | Fraud signal | Shared risk scorer says CRITICAL |
| OTP_LOCKED | Fraud signal | Three wrong codes in a row |
| ADMIN_HOLD | Fraud signal | Frozen by hand by an admin |
| FIRST_WITHDRAWAL | Check | No paid withdrawal yet |
| OVER_AUTO_LIMIT | Check | Above `salesAutoPayoutMaxTzs` |
| FREQUENT_WITHDRAWALS | Check | 3 or more withdrawals in 7 days |
| AMOUNT_SPIKE | Check | More than 3 times the average of the last 5 paid (needs 3 or more) |
| MANUAL_CREDIT | Check | Includes a positive manual adjustment or bonus |
| CANCELLED_BOOKING | Check | Includes a cancelled or refunded stay |
| RISK_REVIEW | Check | Risk scorer is not LOW or harmless MEDIUM |
| AUTO_HANDOFF_FAILED | Check | Automatic handoff could not finish |
| AUTO_OFF | Info | Automatic sales payouts are switched off: not a violation |

The thresholds live in `SALES_WITHDRAWAL_RULES` in
`apps/api/src/services/payouts/salesWithdrawal.ts`.

What the partner sees:
- "Automatic" or "Checked by our team" on each withdrawal;
- a plain message;
- never which fraud signal fired.

What finance sees:
- every reason on the payout row;
- a "Withdrawals paused" strip. Resuming a partner needs an audit reason and
  the Finance OTP.

## Switching it on

The steps, in order:

1. Apply migration `20261108090000` (after `20261107200000`, which this code
   reads for leaderboard exclusions).
2. Make sure the shared AUTO lane runs:
   - `PAYOUT_RELEASE_ENABLED` on the API;
   - Settings, "Automatic owner payouts": on, with a daily limit.
3. Settings, "Automatic sales withdrawals": turn it on and keep the limit at
   TSh 500,000. This asks for the finance code.

Until step 3, every confirmed withdrawal goes to review (AUTO_OFF). The old
one-click `POST /api/sales/payouts` now returns 409 `USE_WITHDRAW`.
