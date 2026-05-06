# Nuvei Commercetools Connector

A production-ready [commercetools Connect](https://docs.commercetools.com/connect) payment Connector for [Nuvei](https://www.nuvei.com/), designed to work natively with **commercetools Checkout** (Complete Checkout and Payment Only modes).

## Architecture

This Connector follows the official commercetools [Payment Integration Template](https://docs.commercetools.com/connect/templates/payment-integration) architecture:

| Application | Type      | Purpose                                                                                              |
| ----------- | --------- | ---------------------------------------------------------------------------------------------------- |
| `enabler`   | `assets`  | Frontend library wrapping Nuvei Simply Connect widget. Served as static JS.                          |
| `processor` | `service` | Backend orchestrating payment operations with Nuvei and updating commercetools Payment transactions. |

## How it differs from the old Nuvei integration

- **No API Extensions.** The modern Connector does not block Payment creation via API Extensions. It uses Checkout sessions and direct Processor calls.
- **No separate DMN service.** Webhook handling is built into the Processor app.
- **Checkout compatible.** Works with Complete Checkout and Payment Only modes.
- **Hosted by commercetools Connect.** No custom Docker/Kubernetes hosting.
- **Session-based auth.** Uses JWT sessions instead of custom Basic Auth.

## Deployment

1. Create a GitHub release (tag) from this repository.
2. Create a **ConnectorStaged** in commercetools Connect pointing to this repo and tag.
3. Request preview → test → publish as **private Connector**.
4. Deploy to your project via Merchant Center or Connect API.
5. Configure the DMN URL in your **Nuvei dashboard** using the URL printed by the `postDeploy` script.

## Configuration

See `connect.yaml` for all required environment variables. Key ones:

| Variable                              | Description                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------- |
| `CTP_PROJECT_KEY`                     | commercetools project key                                                             |
| `CTP_CLIENT_ID` / `CTP_CLIENT_SECRET` | API Client with `manage_payments`, `manage_checkout_payment_intents`, `view_sessions` |
| `NUVEI_MERCHANT_ID`                   | From Nuvei dashboard                                                                  |
| `NUVEI_MERCHANT_SITE_ID`              | From Nuvei dashboard                                                                  |
| `NUVEI_SECRET_KEY`                    | From Nuvei dashboard                                                                  |
| `NUVEI_API_BASE_URL`                  | Nuvei REST API endpoint                                                               |

## DMN Setup

After deploying the Connector, the `postDeploy` script logs the public webhook URL. You must manually paste this into:

**Nuvei Dashboard → Settings → My Integration Settings → DMN URL**

Example: `https://service-xxx.europe-west1.gcp.commercetools.app/webhooks/nuvei`

## Development

```bash
# Install dependencies
pnpm install

# Build both packages
pnpm run build

# Type-check
pnpm run typecheck

# Run tests
pnpm run test

# Lint
pnpm run lint
```

## Project Status

MVP implementation complete. Supports:

- Card payments via Nuvei Simply Connect (embedded drop-in)
- Authorization-first flow with delayed capture for physical goods
- Capture, cancel, and refund via Payment Intents API
- DMN webhook processing with SHA-256 checksum validation
- Complete Checkout and Payment Only modes
- Custom checkout storefront direct usage
