# Nuvei Setup Guide

This guide covers setting up Nuvei sandbox credentials, configuring the DMN webhook, and testing with the Nuvei sandbox.

## Getting Nuvei Sandbox Credentials

1. **Register for a sandbox account** at [https://sandbox.nuvei.com](https://sandbox.nuvei.com) or contact your Nuvei account manager.
2. After registration, you will receive:
   - **Merchant ID** (`NUVEI_MERCHANT_ID`) — identifies your merchant account
   - **Merchant Site ID** (`NUVEI_MERCHANT_SITE_ID`) — identifies the specific site/storefront
   - **Secret Key** (`NUVEI_SECRET_KEY`) — used for checksum signing and DMN validation
3. The **API Base URL** (`NUVEI_API_BASE_URL`) for sandbox is typically:

   ```
   https://ppp-test.nuvei.com/ppp/api/v1
   ```

   Confirm the exact URL with Nuvei support for your region.

4. Log in to the **Nuvei sandbox dashboard** to verify your credentials:
   - URL: `https://sandbox.nuvei.com` (or your regional equivalent)
   - Navigate to **Settings → General** to find your Merchant ID and Merchant Site ID.
   - Navigate to **Settings → API Settings** to find or regenerate your Secret Key.

## Configuring the DMN URL

The DMN (Direct Merchant Notification) is Nuvei's webhook mechanism. After deploying the connector:

1. Get the DMN URL from the `postDeploy` script output. Format:

   ```
   https://service-<id>.<region>.gcp.commercetools.app/webhooks/nuvei
   ```

2. In the **Nuvei dashboard**:
   - Navigate to **Settings → My Integration Settings**.
   - Find the **DMN URL** field.
   - Paste the full URL from step 1.
   - Ensure the **Notification Type** is set to **Post** (form-encoded or JSON).
   - Save changes.

3. The connector validates DMN payloads using a checksum computed from specific fields concatenated with your secret key. The algorithm defaults to SHA-256 but can be set to MD5 via the `NUVEI_DMN_CHECKSUM_ALGORITHM` environment variable.

### DMN Payload Format

Nuvei sends DMN notifications as HTTP POST with form-encoded or JSON body. Key fields:

| Field                     | Description                                                   |
| ------------------------- | ------------------------------------------------------------- |
| `merchantId`              | Your Nuvei Merchant ID                                        |
| `merchantSiteId`          | Your Nuvei Merchant Site ID                                   |
| `TransactionID`           | Nuvei transaction identifier                                  |
| `transactionType`         | `Auth`, `Sale`, `Settle`, `Credit`, `Void`                    |
| `ppp_status`              | `OK` or `FAIL`                                                |
| `totalAmount`             | Payment amount (decimal string, e.g. `"10.00"`)               |
| `currency`                | ISO 4217 currency code                                        |
| `responseTimeStamp`       | Timestamp (e.g. `2024-01-15.14:30:00`)                        |
| `merchant_unique_id`      | commercetools Payment ID (set during openOrder)               |
| `PPP_TransactionID`       | Nuvei PPP transaction ID (used in checksum)                   |
| `Status`                  | Duplicate of `ppp_status` in some versions (used in checksum) |
| `advanceResponseChecksum` | HMAC checksum for validation                                  |
| `productId`               | Product ID (used in checksum, may be empty)                   |
| `cardCompany`             | Card brand (Visa, Mastercard, etc.)                           |
| `cardType`                | Card type (Credit, Debit)                                     |

### Checksum Validation

The connector validates the `advanceResponseChecksum` field using:

```
checksum = SHA256(secretKey + totalAmount + currency + responseTimeStamp + PPP_TransactionID + Status + productId)
```

Compare with `advanceResponseChecksum` using timing-safe comparison. If the checksum does not match, the DMN is rejected with HTTP 400.

## Test Cards

Use these cards in the Nuvei sandbox for testing different scenarios:

### Successful Payments

| Card Number        | Result                | 3DS            |
| ------------------ | --------------------- | -------------- |
| `4000027891380961` | Approved              | No             |
| `4000023104448253` | Approved              | Yes (enrolled) |
| `5111168888888888` | Approved (Mastercard) | No             |

### Failed Payments

| Card Number        | Result             |
| ------------------ | ------------------ |
| `4000020000000002` | Declined           |
| `4000020000000051` | Insufficient funds |
| `4000020000000069` | Expired card       |
| `4000020000000119` | Lost card          |

### 3DS Testing

| Card Number        | Scenario                         |
| ------------------ | -------------------------------- |
| `4000020000005376` | 3DS enrolled — frictionless      |
| `4000020000003222` | 3DS enrolled — step-up challenge |

> Always confirm test card numbers with the [Nuvei sandbox documentation](https://docs.nuvei.com/integration/testing/testing-cards/) as they may change.

## Expected Behavior

| Action    | Nuvei API                         | CT Transaction                  |
| --------- | --------------------------------- | ------------------------------- |
| Authorize | `openOrder` → widget → DMN `Auth` | `Authorization` (Success)       |
| Capture   | `settleTransaction`               | `Charge` (Success)              |
| Cancel    | `voidTransaction`                 | `CancelAuthorization` (Success) |
| Refund    | `refundTransaction`               | `Refund` (Success)              |

## Troubleshooting DMN Issues

### DMNs Not Arriving

1. Verify the DMN URL is correctly set in the Nuvei dashboard.
2. Ensure the connector processor is running (check `/health` endpoint).
3. Check that the Nuvei environment matches (`test` vs `production`).
4. Contact Nuvei support to confirm DMN delivery for your merchant site.

### DMNs Rejected (400 Errors)

1. Check the `NUVEI_DMN_CHECKSUM_ALGORITHM` matches what Nuvei is using (`sha256` vs `md5`).
2. Verify the `NUVEI_SECRET_KEY` matches your Nuvei account.
3. Check processor logs for checksum validation failures.
4. Ensure the DMN payload fields are not being truncated or modified by intermediaries.

### Duplicate DMNs

Nuvei may send the same DMN multiple times. The connector handles this idempotently by checking for existing transactions with the same `interactionId` (Nuvei Transaction ID). If a matching transaction already exists on the commercetools Payment, the DMN is acknowledged but no duplicate transaction is added.

### DMN Field Name Variations

Nuvei DMN payloads may have inconsistent casing for some fields. The connector handles known variations:

- `TransactionID` / `TransactionId`
- `PPP_TransactionID` / `PPP_TransactionId`

If you encounter unrecognized field names, check the raw request body in the processor logs and file an issue.
