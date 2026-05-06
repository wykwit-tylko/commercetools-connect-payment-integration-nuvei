# Architecture

## Overview

The Nuvei commercetools Connector integrates [Nuvei](https://www.nuvei.com/) as a Payment Service Provider (PSP) with [commercetools](https://www.commercetools.com/) as the commerce platform. It follows the official [commercetools Payment Integration Template](https://docs.commercetools.com/connect/templates/payment-integration) architecture.

**Nuvei** is the source of truth for payment execution state. **commercetools** is the source of truth for cart amounts, order references, and payment records. **DMN webhooks** are the eventual-consistency mechanism for final state reconciliation.

## Connector Shape

| Application | Type      | Purpose                                                                                                      |
| ----------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `enabler`   | `assets`  | Frontend library wrapping the Nuvei Simply Connect widget. Served as static JS to the browser.               |
| `processor` | `service` | Backend service orchestrating payment operations with Nuvei and updating commercetools Payment transactions. |

## Payment Flow

```
┌──────────┐    ┌──────────┐    ┌───────────┐    ┌──────────┐    ┌──────────────────┐
│ Customer  │───>│ Checkout  │───>│ Processor  │───>│  Nuvei   │───>│ Nuvei Widget     │
│ (Browser) │    │ (CT)     │    │ (Connect)  │    │ openOrder│    │ (Simply Connect) │
└──────────┘    └──────────┘    └───────────┘    └──────────┘    └────────┬─────────┘
                                                                      │
      ┌───────────────────────────────────────────────────────────────┘
      │  Customer completes payment in widget
      ▼
┌──────────┐    ┌───────────┐    ┌──────────┐
│ Nuvei    │───>│ Processor  │───>│ CT       │
│ DMN      │    │ /webhooks  │    │ Payment  │
└──────────┘    └───────────┘    └──────────┘

Step-by-step:
1. Customer initiates checkout in browser.
2. Checkout session calls Processor POST /payments (or /transactions).
3. Processor calls Nuvei openOrder → receives sessionToken.
4. Enabler loads Nuvei Simply Connect widget in browser with sessionToken.
5. Customer completes 3DS / payment in widget.
6. Processor confirms via POST /payments/confirm (or widget callback).
7. Nuvei sends DMN webhook to Processor POST /webhooks/nuvei.
8. Processor validates DMN checksum, maps transaction, updates CT Payment.
```

## Auth Models per Endpoint

| Route                       | Auth                                       | Purpose                                                |
| --------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| `GET /config`               | Session JWT                                | Return connector config (merchant ID, env) to frontend |
| `GET /status`               | JWT                                        | Health check: CT auth + Nuvei reachability             |
| `GET /payment-components`   | JWT                                        | Supported drop-in/component types                      |
| `POST /payment-intents/:id` | OAuth2 + `manage_checkout_payment_intents` | Capture, cancel, refund actions                        |
| `POST /transactions`        | OAuth2 + `manage_checkout_transactions`    | Server-driven payment creation                         |
| `POST /payments`            | Session JWT                                | Create CT Payment + Nuvei openOrder                    |
| `POST /payments/confirm`    | Session JWT                                | Verify Nuvei payment → CT Authorization                |
| `POST /webhooks/nuvei`      | Raw body checksum                          | DMN notification processing                            |
| `GET /health`               | None                                       | Liveness probe                                         |

## Transaction Mapping

### Nuvei Transaction Type → commercetools TransactionType

| Nuvei             | commercetools         |
| ----------------- | --------------------- |
| `Auth`, `PreAuth` | `Authorization`       |
| `Settle`, `Sale`  | `Charge`              |
| `Credit`          | `Refund`              |
| `Void`            | `CancelAuthorization` |
| `Chargeback`      | `Chargeback`          |

### Nuvei Status → commercetools TransactionState

| Nuvei `ppp_status` | CT `TransactionState` |
| ------------------ | --------------------- |
| `OK`               | `Success`             |
| `FAIL`             | `Failure`             |
| other              | `Pending`             |

### paymentStatus.interfaceCode

| Condition                   | `interfaceCode` |
| --------------------------- | --------------- |
| Authorization Success       | `authorized`    |
| Charge Success              | `paid`          |
| Refund Success              | `refunded`      |
| CancelAuthorization Success | `cancelled`     |
| Any Failure                 | `failed`        |

## Nuvei API Surface

| Operation           | Endpoint                             | Checksum |
| ------------------- | ------------------------------------ | -------- |
| `openOrder`         | `POST /ppp/api/v1/openOrder`         | Signed   |
| `getPaymentStatus`  | `POST /ppp/api/v1/getPaymentStatus`  | Unsigned |
| `settleTransaction` | `POST /ppp/api/v1/settleTransaction` | Signed   |
| `voidTransaction`   | `POST /ppp/api/v1/voidTransaction`   | Signed   |
| `refundTransaction` | `POST /ppp/api/v1/refundTransaction` | Signed   |

All signed requests use SHA-256 checksums (configurable to MD5 via `NUVEI_DMN_CHECKSUM_ALGORITHM`) over a concatenation of specific field values + the secret key.

## Custom Types Policy

**None.** This connector uses native commercetools Payment fields exclusively:

- `interfaceId` — Nuvei transaction ID
- `paymentMethodInfo.method` — card brand or payment method
- `paymentStatus.interfaceCode` — `authorized`, `paid`, `refunded`, `cancelled`, `failed`
- `transactions[]` — standard Authorization/Charge/Refund/CancelAuthorization entries

No Custom Types are created during post-deploy. No Custom Type cleanup is needed during pre-undeploy.

## File Structure

```
nuvei-commercetools-connector/
├── connect.yaml                          # Connect deployment descriptor
├── package.json                          # Root workspace config
├── pnpm-workspace.yaml                   # pnpm workspace definition
├── PLAN.md                               # Implementation plan
├── docs/
│   ├── ARCHITECTURE.md                   # This file
│   ├── DEPLOYMENT.md                     # Deployment guide
│   ├── NUVEI_SETUP.md                    # Nuvei sandbox setup
│   ├── OPERATIONS.md                     # Operations runbooks
│   └── TESTING.md                        # Testing guide
├── enabler/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   └── src/
│       ├── index.ts                      # Public API surface
│       ├── main.ts                       # Entry point
│       ├── dropin/
│       │   └── dropin-embedded.ts        # Embedded drop-in integration
│       ├── payment-enabler/
│       │   └── payment-enabler.ts        # Payment enabler wrapper
│       └── services/
│           └── api-service.ts            # Processor API client
└── processor/
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts                      # Entry point — starts Fastify server
        ├── config.ts                     # Legacy config (kept for compatibility)
        ├── config/
        │   └── config.ts                 # Primary configuration
        ├── server.ts                     # Fastify server builder
        ├── connectors/
        │   ├── post-deploy.ts            # Connect post-deploy script
        │   └── pre-undeploy.ts           # Connect pre-undeploy script
        ├── routes/
        │   ├── health.ts                 # GET /health
        │   ├── payments.ts               # Payment CRUD + actions
        │   └── webhooks.ts               # POST /webhooks/nuvei (DMN)
        ├── clients/
        │   └── nuvei.client.ts           # Nuvei REST API client + checksum
        ├── services/
        │   ├── payment-converter.ts      # Transaction type/status mapping
        │   ├── types/
        │   │   └── operation.type.ts     # Operation type definitions
        │   └── converters/
        │       └── nuvei-event.converter.ts  # DMN → CT Payment update converter
        ├── dtos/
        │   └── operations/
        │       ├── config.dto.ts         # Config response schema
        │       ├── status.dto.ts         # Status response schema
        │       ├── transaction.dto.ts    # Transaction draft/response schemas
        │       ├── payment-intents.dto.ts    # Payment intent schemas
        │       └── payment-components.dto.ts # Component listing schemas
        └── libs/
            ├── logger/
            │   └── index.ts              # Structured JSON logger
            └── fastify/
                ├── context/
                │   └── context.ts         # Request context + auth helpers
                └── dtos/
                    └── error.dto.ts       # Error response schemas
```
