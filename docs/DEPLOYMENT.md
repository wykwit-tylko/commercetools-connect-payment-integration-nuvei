# Deployment Guide

## Prerequisites

- A **commercetools** project (Organization + Project)
- A **Nuvei** sandbox or production account with:
  - Merchant ID
  - Merchant Site ID
  - Secret Key
  - API Base URL
- A commercetools **API Client** with the following scopes:
  - `manage_payments`
  - `manage_orders`
  - `view_sessions`
  - `view_api_clients`
  - `manage_checkout_payment_intents`
  - `introspect_oauth_tokens`
- Node.js >= 20
- pnpm >= 9

## Environment Variables

All variables are configured in `connect.yaml` and set during Connector deployment in Merchant Center or via the Connect API.

### Standard Configuration

| Variable                       | Required | Default                                                                   | Description                                                              |
| ------------------------------ | -------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `CTP_PROJECT_KEY`              | Yes      | —                                                                         | commercetools project key                                                |
| `CTP_AUTH_URL`                 | Yes      | `https://auth.europe-west1.gcp.commercetools.com`                         | commercetools OAuth2 URL                                                 |
| `CTP_API_URL`                  | Yes      | `https://api.europe-west1.gcp.commercetools.com`                          | commercetools API URL                                                    |
| `CTP_SESSION_URL`              | Yes      | `https://session.europe-west1.gcp.commercetools.com`                      | Session API URL                                                          |
| `CTP_JWKS_URL`                 | Yes      | `https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json` | JWKS URL for JWT validation                                              |
| `CTP_JWT_ISSUER`               | Yes      | `https://mc-api.europe-west1.gcp.commercetools.com`                       | JWT issuer                                                               |
| `CTP_CHECKOUT_URL`             | Yes      | `https://checkout.europe-west1.gcp.commercetools.com`                     | Checkout API URL                                                         |
| `NUVEI_ENV`                    | Yes      | `test`                                                                    | Nuvei environment (`test` or `production`)                               |
| `NUVEI_MERCHANT_ID`            | Yes      | —                                                                         | Nuvei Merchant ID                                                        |
| `NUVEI_MERCHANT_SITE_ID`       | Yes      | —                                                                         | Nuvei Merchant Site ID                                                   |
| `NUVEI_API_BASE_URL`           | Yes      | —                                                                         | Nuvei REST API base URL                                                  |
| `NUVEI_DMN_CHECKSUM_ALGORITHM` | No       | `sha256`                                                                  | DMN checksum algorithm (`sha256` only)                                   |
| `CORS_ALLOWED_ORIGINS`         | No       | —                                                                         | Comma-separated additional browser origins allowed to call the processor |

### Secured Configuration

| Variable            | Required | Description                           |
| ------------------- | -------- | ------------------------------------- |
| `CTP_CLIENT_ID`     | Yes      | commercetools API Client ID           |
| `CTP_CLIENT_SECRET` | Yes      | commercetools API Client Secret       |
| `NUVEI_SECRET_KEY`  | Yes      | Nuvei Secret Key for checksum signing |

## Deployment Steps

### 1. Prepare the Connector Repository

```bash
# Clone and install dependencies
git clone <your-repo-url> nuvei-commercetools-connector
cd nuvei-commercetools-connector
pnpm install

# Build both applications
pnpm build
```

### 2. Create a Release Tag

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 3. Create the Connector in commercetools Connect

1. Go to **Merchant Center → Connect → My Connectors**.
2. Click **Create Connector**.
3. Point to your Git repository and the release tag.
4. The `connect.yaml` at the repo root defines the deployment configuration.

Alternatively, use the Connect API to create a `ConnectorStaged` resource.

### 4. Deploy to Your Project

1. In Merchant Center, select the Connector and click **Deploy**.
2. Fill in all required environment variables.
3. Confirm deployment.

The Connect runtime will:

- Deploy the `enabler` as static assets.
- Deploy the `processor` as a service on port 8080.
- Run the `postDeploy` script automatically.

### 5. Post-Deploy: Configure DMN URL

The `postDeploy` script logs the DMN webhook URL to the deployment logs. This URL has the format:

```
https://service-<id>.<region>.gcp.commercetools.app/webhooks/nuvei
```

**You must manually configure this URL in the Nuvei dashboard:**

1. Log in to your Nuvei dashboard.
2. Navigate to **Settings → My Integration Settings**.
3. Paste the webhook URL into the **DMN URL** field.
4. Save changes.

> **Important:** The connector will not receive payment notifications until the DMN URL is configured in Nuvei.

### 6. Verify Deployment

See the [Verification](#verification-steps) section below.

## Verification Steps

After deployment, verify each component:

### Health Check

```bash
curl https://service-<id>.<region>.gcp.commercetools.app/health
# Expected: {"status":"ok"}
```

### Status Check

```bash
curl -H "Authorization: Bearer <jwt>" \
  https://service-<id>.<region>.gcp.commercetools.app/status
# Expected: JSON with "status": "OK" and individual checks
```

### Payment Flow

1. Create a Checkout session in commercetools.
2. Complete a test card payment through the Nuvei widget.
3. Verify the commercetools Payment has an `Authorization` transaction in `Success` state.
4. Verify `paymentStatus.interfaceCode` is `authorized`.

### Webhook Verification

1. After a test payment, check the processor logs for incoming DMN requests.
2. Verify the DMN was processed (checksum validated, transaction added).
3. If DMNs are not arriving, check the Nuvei dashboard DMN URL configuration.

### Nuvei SDK Integrity

The enabler loads Nuvei's documented Web SDK v1 URL:

```text
https://cdn.safecharge.com/safecharge_resources/v1/websdk/safecharge.js
```

Nuvei does not currently document a semver-pinned CDN path for this SDK. The enabler pins the current CDN asset with Subresource Integrity (SRI). At the time of pinning, the CDN file header identified the asset as `websdk v1.0`, `v1.160.0 / 3/27/2026`.

When Nuvei intentionally updates the SDK, browser loading will fail until the SRI value is updated. Recompute it with:

```bash
curl -fsSL "https://cdn.safecharge.com/safecharge_resources/v1/websdk/safecharge.js" \
  | openssl dgst -sha384 -binary \
  | openssl base64 -A
```

Then update `NUVEI_SDK_INTEGRITY` in `enabler/src/dropin/dropin-embedded.ts` after reviewing the new SDK release.

## Updating the Connector

1. Create a new release tag in your repository.
2. Update the Connector in Merchant Center to the new tag.
3. Redeploy — the `preUndeploy` and `postDeploy` scripts will run automatically.
4. Verify the DMN URL has not changed (it typically stays the same for the same deployment).

## Undeploying

1. In Merchant Center, select the Connector deployment and click **Undeploy**.
2. The `preUndeploy` script will run and remind you to remove the DMN URL from the Nuvei dashboard.
3. **Manually remove the DMN URL** from the Nuvei dashboard to stop webhook delivery.
