# Production Plan: Nuvei Connector for commercetools Connect

Reference repositories: `stripe-connector/`, `adyen-connector/`, `payment-template/`

---

## 1. Goals, Non-Goals, Assumptions

### 1.1 Goals

Build a **private Organization Connector** for Nuvei that:

- works with **commercetools Complete Checkout**
- works with **commercetools Payment Only**
- can also be used by a **custom checkout storefront** using the same enabler/processor
- supports **physical goods** with:
  - `Authorization` during checkout
  - `Capture` later via Checkout Payment Intents API
- uses **TypeScript**, **pnpm**, **Fastify**, **Typebox**, **oxlint**, **oxfmt**
- defaults to **SHA-256** and avoids weaker crypto unless Nuvei forces otherwise
- is structured for **parallel implementation**
- is hardened enough for preview/sandbox/prod rollout in Connect

### 1.2 Non-goals

The connector will **not** in its initial scope:

- manage merchant business rules for fulfillment
- create or manage orders outside what Checkout already does
- become an OMS, ERP, fraud, or tax integration
- support every Nuvei payment method on day one
- support subscriptions/recurring billing in the first implementation pass
- store extra custom fields in commercetools unless there is a proven need

### 1.3 Assumptions

- Nuvei integration target is the **existing Simply Connect / REST v1 style flow** already used by the current merchant setup.
- The merchant has **Nuvei sandbox credentials** or can obtain them.
- DMN webhook configuration is **manual in Nuvei dashboard**.
- The connector will be deployed through **commercetools Connect**, not self-hosted.
- Complete Checkout and Payment Only are both required.
- Physical goods means **manual capture is the default business mode**.

### 1.4 Open questions to resolve before coding

1. Is MVP limited to cards, or are wallets/APMs required immediately?
2. Does the merchant need stored payment methods in phase 1?
3. Does Nuvei require redirect/3DS callbacks beyond the widget contract?
4. Any merchant-specific payment descriptors, metadata, or reconciliation requirements?
5. Can `merchant_unique_id = commercetools payment ID` serve as the canonical correlation everywhere?
6. Should `Payment Only` and `Complete Checkout` ship together, or may one follow the other?

---

## 2. Architecture Decisions

### 2.1 Connector shape

Use the standard Connect payment architecture:

- `enabler` (`assets`)
- `processor` (`service`)

Do **not** use:

- commercetools API Extensions for payment creation
- a separate standalone DMN app
- direct frontend calls to commercetools Payments API from the browser

### 2.2 Why this is the correct model

This matches `payment-template/`, `stripe-connector/`, and `adyen-connector/`. It avoids the deprecated pattern used by the old Nuvei and old Adyen integrations.

### 2.3 Source-of-truth model

- **Nuvei** is source of truth for payment execution state.
- **commercetools** is source of truth for cart amounts, order references, and payment records.
- **Webhooks/DMN** are the eventual-consistency mechanism for final state reconciliation.

### 2.4 Default payment lifecycle

- Checkout phase: create Nuvei payment session and authorize
- Fulfillment phase: capture later using Checkout Payment Intents API
- Cancellation phase: cancel authorization if order is not fulfilled
- Refund phase: partial/full refund supported after capture

---

## 3. Phased Scope

### Phase 0: Discovery & Contract Validation

Reduce unknowns before coding.

Deliverables:

- Confirm Nuvei API surface required
- Confirm DMN payload formats from sandbox
- Confirm frontend contract the enabler must satisfy for hosted Checkout
- Confirm endpoints needed for custom checkout direct usage
- Confirm if Custom Types are actually needed
- Document test cards / test scenarios from Nuvei

Exit criteria: API surface agreed, Checkout modes confirmed, MVP scope frozen.

### Phase 1: MVP (hosted Checkout + Payment Only)

Cards only, production-critical core.

**Included:** Complete Checkout & Payment Only, `openOrder`, authorization confirmation, DMN webhook processing, capture/cancel-authorization/refund via Payment Intents API, health/status endpoint.

**Excluded:** Express payments, stored payment methods, APMs, recurring transactions.

Exit criteria: Card payment in sandbox, authorization → CT Payment, capture/refund via Payment Intents, duplicate DMNs idempotent.

### Phase 2: Custom Checkout Direct Usage

Same enabler/processor usable outside hosted Checkout from merchant storefront.

Included: Direct enabler loading, stable processor contract, session creation guidance for BFF, merchant return URL handling.

### Phase 3: Production Hardening

Structured logging, log redaction, deployment docs, retry policy, timeout budgets, Chrome browser E2E, CI quality gates.

### Phase 4: Optional Enhancements (post-stability)

Stored payment methods, express payments, Apple Pay / Google Pay, APMs, merchant-specific display fields.

### Locked scope for implementation start

Cards only. Complete Checkout + Payment Only. Custom checkout enabler support. Authorization-first, delayed capture. DMN webhook processing. No stored payment methods, no express payments, no Custom Types unless Phase 0 proves necessary.

---

## 4. Functional Requirements

### 4.1 Processor endpoints

| Route                          | Auth                                       | Purpose                                             |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------- |
| `GET /config`                  | Session JWT                                | Connector config (merchant ID, env, keys)           |
| `GET /status`                  | JWT                                        | Health check: CT auth + Nuvei reachability          |
| `GET /payment-components`      | JWT                                        | Supported drop-in / component types                 |
| `POST /payment-intents/:id`    | OAuth2 + `manage_checkout_payment_intents` | Capture, cancel, refund actions                     |
| `POST /transactions`           | OAuth2 + `manage_checkout_transactions`    | Server-driven payment creation                      |
| `POST /nuvei/payments`         | Session JWT                                | Deferred intent: CT Payment + Nuvei openOrder       |
| `POST /nuvei/payments/confirm` | Session JWT                                | Verify Nuvei payment → CT Authorization transaction |
| `POST /nuvei/webhooks`         | Raw body checksum                          | Nuvei DMN notification processing                   |

### 4.2 Transaction mapping

| Nuvei             | commercetools         |
| ----------------- | --------------------- |
| `Auth`, `PreAuth` | `Authorization`       |
| `Settle`, `Sale`  | `Charge`              |
| `Credit`          | `Refund`              |
| `Void`            | `CancelAuthorization` |
| `Chargeback`      | `Chargeback`          |

| Nuvei `ppp_status` | CT `TransactionState` |
| ------------------ | --------------------- |
| `OK`               | `Success`             |
| `FAIL`             | `Failure`             |
| other              | `Pending`             |

### 4.3 Nuvei API endpoints used

| Operation           | Endpoint                             |
| ------------------- | ------------------------------------ |
| `openOrder`         | `POST /ppp/api/v1/openOrder`         |
| `getPaymentStatus`  | `POST /ppp/api/v1/getPaymentStatus`  |
| `settleTransaction` | `POST /ppp/api/v1/settleTransaction` |
| `voidTransaction`   | `POST /ppp/api/v1/voidTransaction`   |
| `refundTransaction` | `POST /ppp/api/v1/refundTransaction` |

### 4.4 Physical goods lifecycle

1. **Checkout**: Nuvei session + authorization
2. **Fulfillment**: capture via Checkout Payment Intents API
3. **Cancellation**: cancel authorization if unfulfilled
4. **Refund**: partial/full refund after capture

### 4.5 Enabler contract

The enabler is a **thin wrapper** around the Nuvei frontend widget. Business logic lives in the processor.

- Direct asset import from the connector deployment URL
- Constructor: `{ processorUrl, sessionId, merchantId, merchantSiteId, env, onComplete, onError }`
- Drop-in or component builder pattern matching Checkout expectations
- Custom checkout direct usage from merchant storefront

### 4.6 Custom Types policy

**Default: none.** Use native Payment fields (`interfaceId`, `paymentMethodInfo`, `paymentStatus`, `transactions`). Only add Custom Types if Phase 0 proves a concrete requirement.

---

## 5. Security

### 5.1 Cryptography

- Default to **SHA-256** for all checksum/signature operations.
- Do **not** support MD5 unless Nuvei sandbox or production demonstrably requires it.
- If fallback support is unavoidable, make it explicit, feature-flagged, and documented as legacy.

### 5.2 Authentication

Every route must have the right auth model:

- `sessionHeaderAuthHook.authenticate()` for frontend/session routes
- `oauth2AuthHook.authenticate()` + `authorizationHook.authorize(...)` for server-managed operations
- `jwtAuthHook.authenticate()` for status and internal routes
- webhook route must rely on raw payload verification as its cryptographic guard

### 5.3 Webhook/DMN verification

- preserve raw request body
- validate checksum using timing-safe comparison
- reject malformed checksums immediately
- verify merchant identity
- treat duplicate DMNs as normal and idempotent

### 5.4 Data handling

- no PAN or raw card data ever stored or logged
- redact secrets, tokens, and checksum material from logs
- do not leak raw errors to clients

### 5.5 Least privilege scopes

MVP processor client scopes (start here, add only when needed):

- `manage_payments`
- `view_sessions`
- `view_api_clients`
- `manage_checkout_payment_intents`
- `introspect_oauth_tokens`

Potentially needed later: `manage_orders`, `manage_types`, `view_types`, `manage_payment_methods`.

---

## 6. Connect Runtime & Tooling

### 6.1 Package management

Use `pnpm` + root `packageManager` field + `corepack`. Validate `pnpm` in preview deployments since Connect examples use `npm`.

Post-deploy script form:

```yaml
postDeploy: corepack enable && pnpm install --frozen-lockfile && pnpm --filter processor run connector:post-deploy
```

### 6.2 Runtime constraints

- Processor: HTTP on port `8080`
- Each app has valid `start` and `gcp-build`/build scripts
- Enabler assets: deterministic and committed or reproducibly built

### 6.3 Linting & formatting

`oxlint` + `oxfmt`. Optionally: `tsc --noEmit`, `vitest`.

### 6.4 Dependencies

Latest stable, pinned lockfile, Dependabot, no unnecessary deps.

---

## 7. Repository Structure

```text
nuvei-commercetools-connector/
├── connect.yaml
├── package.json
├── pnpm-workspace.yaml
├── pnpm-lock.yaml
├── oxlintrc.json
├── .editorconfig, .gitignore, README.md
├── docs/
│   ├── DEPLOYMENT.md
│   ├── TESTING.md
│   ├── NUVEI_SETUP.md
│   ├── OPERATIONS.md
│   └── ARCHITECTURE.md
├── enabler/
│   ├── package.json, tsconfig.json, vite.config.ts
│   ├── src/
│   └── test/
└── processor/
    ├── package.json, tsconfig.json
    ├── src/
    └── test/
```

Keep packages separate. No internal shared packages until duplication is proven.

---

## 8. Browser & Sandbox Validation

Chrome E2E is available. Minimum test matrix:

| Scenario                    | Validates           |
| --------------------------- | ------------------- |
| Successful authorization    | Core flow           |
| Failed authorization        | Error handling      |
| Pending/async authorization | DMN reconciliation  |
| Capture after authorization | Payment Intents API |
| Cancel authorization        | Payment Intents API |
| Refund after capture        | Payment Intents API |
| Duplicate DMN               | Idempotency         |
| Invalid checksum DMN        | Security            |
| Expired/invalid session     | Auth handling       |

Test environments: local (Connect-style), preview deployment, sandbox deployment.

---

## 9. Observability & Operations

### 9.1 Logging

Structured JSON logs with correlation ID, request ID, payment ID, cart ID. No secrets.

### 9.2 Status endpoint

`GET /status` verifies: CT auth/scopes, Nuvei API reachability, feature-specific config.

### 9.3 Runbooks needed

DMN misconfiguration, Nuvei outage, repeated checksum failures, auth scope issues, deployment failures.

### 9.4 Retry/timeouts

Short outbound HTTP timeouts. Explicit retry only where safe. Idempotency-key protection for payment creation.

---

## 10. Parallel Workstreams

Designed for minimal file conflicts. Each workstream owns a distinct set of files.

| WS  | Owner       | Files                                                                                       | Output                                                      |
| --- | ----------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| A   | Spec        | `docs/ARCHITECTURE.md`, `docs/NUVEI_SETUP.md`                                               | Nuvei API list, payloads, webhook format, Checkout contract |
| B   | Infra       | Root config files only                                                                      | pnpm workspace, oxlint/oxfmt, CI skeleton                   |
| C   | Framework   | `processor/src/config/`, `server/`, `libs/`, `payment-sdk.ts`                               | Bootable Fastify app, auth hooks, error handling            |
| D   | Integration | `processor/src/clients/`, `services/converters/`, related DTOs                              | Pure request/response mapping, no route ownership           |
| E   | Domain      | `processor/src/routes/`, `services/nuvei-payment.service.ts`, `abstract-payment.service.ts` | Endpoint behavior, payment lifecycle orchestration          |
| F   | Frontend    | `enabler/**`                                                                                | Browser asset library, processor integration                |
| G   | Deploy      | `processor/src/connectors/`, `docs/DEPLOYMENT.md`, `docs/OPERATIONS.md`                     | postDeploy, preUndeploy, rollout guide                      |
| H   | QA          | `enabler/test/`, `processor/test/`                                                          | Unit, integration, browser tests                            |

### Conflict boundaries

- Only E owns route files
- Only D owns converters and Nuvei client
- Only C owns server/bootstrap
- Only F touches `enabler/`
- Only G touches deployment scripts

### Delivery order

| Stage | Workstreams                                 |
| ----- | ------------------------------------------- |
| 0     | A, B                                        |
| 1     | C, D, F                                     |
| 2     | E, G                                        |
| 3     | H, browser verification, preview deploy     |
| 4     | Sandbox deploy, production readiness review |

---

## 11. Production Readiness Checklist

- [ ] Preview deployment works in Connect
- [ ] Sandbox deployment works in Connect
- [ ] Cards authorize in hosted Checkout
- [ ] Cards authorize in Payment Only
- [ ] Custom checkout direct enabler flow works
- [ ] Capture via Payment Intents API works
- [ ] Cancel authorization via Payment Intents API works
- [ ] Refund via Payment Intents API works
- [ ] Duplicate DMNs do not duplicate transactions
- [ ] Invalid DMNs rejected
- [ ] No secrets in logs
- [ ] Status endpoint reports meaningful failures
- [ ] All API client scopes documented and validated
- [ ] Merchant DMN setup guide complete
- [ ] CI passes
- [ ] Browser sandbox test matrix passes
