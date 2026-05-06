# Testing Guide

## Unit Tests

### Test Framework

The project uses [vitest](https://vitest.dev/) as the test runner, which is already configured in the workspace.

### Running Tests

```bash
# Run all tests
pnpm test

# Run tests in watch mode during development
pnpm --filter processor exec vitest --watch

# Run a specific test file
pnpm --filter processor exec vitest src/clients/nuvei.client.test.ts
```

### Writing Unit Tests

Tests should be co-located with the source files they test:

```
processor/src/
├── clients/
│   ├── nuvei.client.ts
│   └── nuvei.client.test.ts        ← Unit tests for Nuvei client
├── services/
│   ├── payment-converter.ts
│   ├── payment-converter.test.ts   ← Unit tests for payment converter
│   └── converters/
│       ├── nuvei-event.converter.ts
│       └── nuvei-event.converter.test.ts  ← Unit tests for DMN converter
└── routes/
    ├── webhooks.ts
    └── webhooks.test.ts            ← Route handler tests
```

### Example Test

```typescript
import { describe, it, expect } from "vitest";
import { mapNuveiTransactionType, mapNuveiStatus } from "./payment-converter";

describe("mapNuveiTransactionType", () => {
  it("maps Auth to Authorization", () => {
    expect(mapNuveiTransactionType("Auth")).toBe("Authorization");
  });

  it("maps Sale to Charge", () => {
    expect(mapNuveiTransactionType("Sale")).toBe("Charge");
  });

  it("maps Credit to Refund", () => {
    expect(mapNuveiTransactionType("Credit")).toBe("Refund");
  });

  it("maps Void to CancelAuthorization", () => {
    expect(mapNuveiTransactionType("Void")).toBe("CancelAuthorization");
  });
});

describe("mapNuveiStatus", () => {
  it("maps OK to Success", () => {
    expect(mapNuveiStatus("OK")).toBe("Success");
  });

  it("maps FAIL to Failure", () => {
    expect(mapNuveiStatus("FAIL")).toBe("Failure");
  });

  it("maps unknown to Pending", () => {
    expect(mapNuveiStatus("PENDING")).toBe("Pending");
  });
});
```

### Key Areas to Test

| Module                     | What to Test                                                          |
| -------------------------- | --------------------------------------------------------------------- |
| `nuvei.client.ts`          | Checksum calculation, request signing, error handling, DMN validation |
| `payment-converter.ts`     | Transaction type mapping, status mapping, interfaceCode derivation    |
| `nuvei-event.converter.ts` | DMN body parsing, cent amount conversion, timestamp parsing           |
| `webhooks.ts`              | Checksum validation, idempotency, error responses                     |
| `payments.ts`              | openOrder flow, capture/cancel/refund flows                           |

## Test Cards

### Successful Transactions

| Card Number        | Brand      | 3DS | Scenario              |
| ------------------ | ---------- | --- | --------------------- |
| `4000027891380961` | Visa       | No  | Standard approval     |
| `4000023104448253` | Visa       | Yes | 3DS enrolled approval |
| `5111168888888888` | Mastercard | No  | MC standard approval  |

### Failed Transactions

| Card Number        | Scenario           |
| ------------------ | ------------------ |
| `4000020000000002` | Declined           |
| `4000020000000051` | Insufficient funds |
| `4000020000000069` | Expired card       |
| `4000020000000119` | Lost card          |

### 3DS Scenarios

| Card Number        | Scenario              |
| ------------------ | --------------------- |
| `4000020000005376` | 3DS frictionless      |
| `4000020000003222` | 3DS step-up challenge |

> Always confirm with [Nuvei sandbox docs](https://docs.nuvei.com/integration/testing/testing-cards/) — test card numbers may change.

## Manual Testing Checklist

Use this checklist for end-to-end verification in the sandbox:

### Deployment Verification

- [ ] Connector deploys without errors
- [ ] `GET /health` returns `{"status":"ok"}`
- [ ] `GET /status` returns all checks as `UP`
- [ ] Post-deploy script logs the DMN URL

### Payment Flow

- [ ] Create a Checkout session in commercetools
- [ ] Nuvei widget loads in the browser (enabler)
- [ ] Complete a test card payment (card: `4000027891380961`)
- [ ] commercetools Payment has an `Authorization` transaction (Success)
- [ ] `paymentStatus.interfaceCode` is `authorized`
- [ ] DMN was received and processed (check logs)

### Capture

- [ ] Trigger capture via Payment Intents API (`capturePayment` action)
- [ ] commercetools Payment has a `Charge` transaction (Success)
- [ ] `paymentStatus.interfaceCode` is `paid`

### Cancel Authorization

- [ ] Trigger cancel via Payment Intents API (`cancelPayment` action)
- [ ] commercetools Payment has a `CancelAuthorization` transaction (Success)
- [ ] `paymentStatus.interfaceCode` is `cancelled`

### Refund

- [ ] Trigger refund via Payment Intents API (`refundPayment` action)
- [ ] commercetools Payment has a `Refund` transaction (Success)
- [ ] `paymentStatus.interfaceCode` is `refunded`

### Error Handling

- [ ] Declined card (`4000020000000002`) → Payment shows `Authorization` (Failure)
- [ ] Invalid DMN checksum → Processor returns 400
- [ ] Duplicate DMN → No duplicate transaction created
- [ ] Missing/invalid session → Auth error returned

## Browser Sandbox Testing

For end-to-end testing with a real browser:

### Setup

1. Deploy the connector to a Connect preview environment.
2. Create a commercetools Checkout session pointing to the deployed connector.
3. Open the checkout page in Chrome.

### Testing Approach

1. **Normal flow:** Complete payment with test card, verify DMN arrival, check CT Payment state.
2. **3DS flow:** Use an enrolled card, complete the 3DS challenge, verify authorization.
3. **Declined flow:** Use a declined card, verify the widget shows the error and CT Payment reflects failure.
4. **Timeout flow:** Let a payment session expire, verify no stale state persists.

### Using DevTools

- Monitor the **Network** tab for `/payments` and `/webhooks/nuvei` requests.
- Check the **Console** for enabler errors.
- Inspect the commercetools Payment via ImpEx or Merchant Center after each test.
