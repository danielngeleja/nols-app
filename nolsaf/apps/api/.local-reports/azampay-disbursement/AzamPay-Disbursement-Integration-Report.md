# AzamPay Disbursement Integration: Test Report and Outstanding Items

**From:** NoLSAF (NoLS AFRICA COMPANY LIMITED)
**App:** Disbursement Test
**Test host:** `https://api-disbursement-test.azampay.co.tz`
**Date:** 2026-08-17

---

## 1. Summary

Our disbursement integration is built and now verified end to end against your
test host for everything that does not require your side to finalise a payout.
Authentication, the checksum contract you provided, Name Lookup, Disburse
submission, and Transaction Status polling all work and are accepted by your API.

Two things still block a complete end to end test:

1. The **callback authentication method** (there is a `signature` field on your
   responses, but we have not been told how it is produced or verified).
2. **Registration of our callback URL** for this test account.

There is also a data-quality issue: the test host returns **randomised, mocked
responses**, so it cannot be used to validate real account verification or real
settlement. Evidence is in section 4.

---

## 2. Confirmed working (with proof)

| Capability | Result |
|---|---|
| OAuth token retrieval | Working |
| Checksum (Name Lookup): `bankName + accountNumber` | Accepted |
| Checksum (Disburse): `sourceAcc + destAcc + currency + amount + epoch + externalReferenceId` | Accepted |
| RSA public key, SHA-512, PKCS#1 v1.5 padding | Accepted |
| `transferDetails.type = "FUND"` | Accepted |
| Name Lookup endpoint | Returns a name and `status` |
| Disburse endpoint | Returns `success`, `pgReferenceId`, `Pending` |
| Transaction Status endpoint | Returns the transaction, correlated to our reference |

A wrong checksum or wrong field composition would be rejected, so acceptance
confirms the contract you supplied is correct on our side.

### Successful transaction references (from our test runs)

| externalReferenceId (initiator) | pgReferenceId | transId (status) | amount | status |
|---|---|---|---|---|
| `harvest-1786967413298` | `01a00f8ecb4574f79e1669b8cbbd4574` | `2b9de17886c1594ac4d314a4098643ba` | 1000 TZS | Pending |
| `harvest-1786967581685` | `01a00f915cd17a9d8d6b3d186e9416cd` | `dcedce02036edd477992e840e91db638` | 1000 TZS | Pending |
| `smoke-1786966838572`   | `01a00f860912724cb2b1a492af2bf89d` | `f53825c870513a1318cda77d21b0a30e` | 1000 TZS | Pending |

All three were **accepted** and then confirmed via Transaction Status, with our
`externalReferenceId` echoed back as `initiatorReferenceId`. None ever left
`Pending`, because no callback is configured (see section 3).

---

## 3. The missing piece

### 3.1 Callback authentication / signature scheme

Your Transaction Status response includes a `signature` field (returned `null`
on the test host). Your published disbursement callback schema does not
document a signature. Please confirm:

- How is the callback we receive authenticated? Signature in the body, a signed
  header, a shared secret, a source IP allowlist, mTLS, or something else?
- If it is the `signature` field: what exact string or fields are signed, in
  what order, and which key verifies it (the same RSA key you gave us, or a
  separate callback key)?
- Is `signature` also present on the disbursement **callback** POST, not only on
  the status response?

We need this so we can accept genuine callbacks and reject forged ones. Our
callback endpoint currently fails closed until an authentication control is
confirmed.

### 3.2 Register our test callback URL

Please register this endpoint for our test account:

```
https://nolsaf-api-staging.onrender.com/api/payments/azampay/disbursement/callback
```

Please also confirm the **callback retry policy** (how many retries, over what
window) so we handle it idempotently.

### 3.3 A non-mock test environment

See section 4. We need a sandbox that reflects real behaviour so we can validate
real account verification and real settlement (a payout that actually reaches a
final PAID or FAILED state).

---

## 4. Evidence: the test host returns mocked, randomised data

The same request returns different results on repeated calls, and clearly
fabricated data. Examples from two consecutive runs a few minutes apart:

| Request | Run 1 response | Run 2 response |
|---|---|---|
| Name Lookup `Azampesa / 1710446004` | `status:true`, name "Oscar Fay" | `400`, "Request timed out while contacting the provider" |
| Name Lookup `Azampesa / 1780120104` | `400`, "Server Responded with Failure" | `status:true`, name "Ceasar Gottlieb" |
| Name Lookup `Azampesa / 9999999999` (nonexistent) | `status:true`, name "Trey Wiza" | `status:true` (fabricated) |
| Name Lookup `Tigo / 0714000001` | Resolved as `M-pesa`, fspId 503 | Resolved as `M-pesa` |
| Name Lookup `Airtel / 0784000001` | `Airtel Money`, fspId 504 | error |

Observations:

- **Non-deterministic:** identical input gives different results between runs.
- **Fabricated success:** a nonexistent account returns a "successful" lookup
  with a random name and `"message": "Mocked successful lookup"`.
- **Rail remapping:** the resolved `bankName` / `fspName` is derived from the
  account number prefix, not the `bankName` we send.
- **Never settles:** every Disburse stays `Pending` and `signature` is always
  `null`.

Because of this, the test host validates our request plumbing only. It cannot
validate real name resolution, real payout, or the callback path.

---

## 5. What we need from AzamPay to finish

1. The callback authentication / `signature` scheme (section 3.1).
2. Registration of our callback URL (section 3.2).
3. Access to a test environment that reflects real behaviour (section 3.3).

Once we have these, we can complete an end to end test where a disbursement is
submitted, a callback finalises it, and the ledger settles automatically.

Full request and response logs for every case are available on request
(machine-readable JSON and human-readable Markdown).
