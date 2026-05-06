# Operations Guide

## Health Check Endpoint

### `GET /health`

Returns a simple liveness probe. No authentication required.

```bash
curl https://service-<id>.<region>.gcp.commercetools.app/health
```

**Response:**

```json
{ "status": "ok" }
```

Use this for load balancer health checks and uptime monitoring.

## Status Endpoint

### `GET /status`

Returns a detailed health report including commercetools connectivity and Nuvei API reachability. Requires JWT authentication.

```bash
curl -H "Authorization: Bearer <jwt>" \
  https://service-<id>.<region>.gcp.commercetools.app/status
```

**Response:**

```json
{
  "status": "OK",
  "timestamp": "2024-07-15T14:00:43.068Z",
  "version": "1.0.0",
  "metadata": {
    "name": "@nuvei-commercetools/processor"
  },
  "checks": [
    {
      "name": "CoCo Permissions",
      "status": "UP"
    },
    {
      "name": "Nuvei API",
      "status": "UP"
    }
  ]
}
```

### Interpreting the Status Response

| Field                     | Meaning                                                       |
| ------------------------- | ------------------------------------------------------------- |
| `status: "OK"`            | All checks passed                                             |
| `status: "ERROR"`         | One or more checks failed — check individual `checks` entries |
| `checks[].status: "UP"`   | This component is reachable and functioning                   |
| `checks[].status: "DOWN"` | This component is unreachable or returned an error            |
| `checks[].message`        | Error details when status is `DOWN`                           |

## Common Issues and Runbooks

### 1. DMN Misconfiguration

**Symptoms:**

- Payments complete in the Nuvei widget but commercetools Payment stays in `Pending` state.
- No `Authorization` transaction appears on the Payment.
- Processor logs show no incoming DMN requests.

**Diagnosis:**

1. Check processor logs for DMN requests around the time of the test payment.
2. Verify the DMN URL is set in the Nuvei dashboard (**Settings → My Integration Settings → DMN URL**).
3. Confirm the URL matches exactly: `https://service-<id>.<region>.gcp.commercetools.app/webhooks/nuvei`.

**Resolution:**

1. Set or correct the DMN URL in the Nuvei dashboard.
2. Re-process a test payment.
3. If Nuvei does not deliver DMNs, contact Nuvei support.

### 2. Nuvei API Errors

**Symptoms:**

- `openOrder` calls fail with non-zero `errCode`.
- `settleTransaction`, `voidTransaction`, or `refundTransaction` return errors.
- Status check shows "Nuvei API" as `DOWN`.

**Diagnosis:**

1. Check processor logs for `NuveiApiError` entries — the `responseBody` field contains the Nuvei error details.
2. Common error codes:
   - `errCode: 1` — General error (check `reason` field)
   - `errCode: 1001` — Invalid checksum (verify `NUVEI_SECRET_KEY`)
   - `errCode: 1002` — Invalid merchant ID
   - `errCode: 1003` — Invalid merchant site ID

**Resolution:**

1. Verify `NUVEI_MERCHANT_ID`, `NUVEI_MERCHANT_SITE_ID`, and `NUVEI_SECRET_KEY` are correct.
2. Verify `NUVEI_API_BASE_URL` matches the correct environment (`test` vs `production`).
3. Check that the Nuvei account is active and not suspended.
4. If the error persists, contact Nuvei support with the `clientRequestId` from the logs.

### 3. Checksum Failures

**Symptoms:**

- DMN requests return HTTP 400.
- Processor logs show "checksum validation failed" or similar messages.
- Payments remain in `Pending` state despite Nuvei showing `OK`.

**Diagnosis:**

1. Check processor logs for the received `advanceResponseChecksum` value.
2. Compare the `NUVEI_DMN_CHECKSUM_ALGORITHM` setting with what Nuvei is sending:
   - Default: `sha256` (64 hex characters)
   - Legacy: `md5` (32 hex characters)
3. Verify `NUVEI_SECRET_KEY` matches the key configured in the Nuvei dashboard.

**Resolution:**

1. If the algorithm is wrong, update `NUVEI_DMN_CHECKSUM_ALGORITHM` in the Connector configuration.
2. If the secret key is wrong, update `NUVEI_SECRET_KEY`.
3. Redeploy the connector with the corrected configuration.

### 4. Auth Scope Issues

**Symptoms:**

- Status check shows "CoCo Permissions" as `DOWN`.
- Payment operations fail with 401/403 errors from commercetools.
- `POST /payment-intents/:id` returns authentication errors.

**Diagnosis:**

1. Check the status endpoint for specific permission errors.
2. Verify the API Client has all required scopes:
   - `manage_payments`
   - `manage_orders`
   - `view_sessions`
   - `view_api_clients`
   - `manage_checkout_payment_intents`
   - `introspect_oauth_tokens`
3. Verify `CTP_CLIENT_ID` and `CTP_CLIENT_SECRET` are correct.

**Resolution:**

1. Update the API Client scopes in commercetools Merchant Center (**Settings → API Clients**).
2. Update `CTP_CLIENT_ID` and `CTP_CLIENT_SECRET` in the Connector configuration if rotated.
3. Redeploy the connector.

### 5. Deployment Failures

**Symptoms:**

- Connector deployment fails in Merchant Center.
- `postDeploy` script exits with code 1.
- Processor service is not reachable after deployment.

**Diagnosis:**

1. Check the deployment logs in Merchant Center for error details.
2. Common causes:
   - Missing required environment variables
   - Build failure (`tsc` or `vite` errors)
   - `postDeploy` script crash

**Resolution:**

1. Ensure all required environment variables are set (see `connect.yaml`).
2. Build the connector locally to verify:
   ```bash
   pnpm install
   pnpm build
   ```
3. Run the post-deploy script locally to verify:
   ```bash
   CONNECT_SERVICE_URL=https://example.com pnpm --filter processor run connector:post-deploy
   ```
4. Fix any TypeScript or runtime errors and redeploy.

## Monitoring Recommendations

- Monitor `GET /health` every 30 seconds for liveness.
- Monitor `GET /status` every 60 seconds for dependency health.
- Alert on:
  - Consecutive health check failures (3+)
  - Status showing any check as `DOWN` for > 5 minutes
  - Elevated HTTP 5xx error rates
  - DMN processing latency exceeding 5 seconds

## Log Format

All processor logs are structured JSON with the following fields:

| Field           | Description                         |
| --------------- | ----------------------------------- |
| `level`         | Log level (`info`, `warn`, `error`) |
| `message`       | Human-readable message              |
| `correlationId` | Request correlation ID              |
| `requestId`     | Fastify request ID                  |
| `projectKey`    | commercetools project key           |
| `timestamp`     | ISO 8601 timestamp                  |

No secrets, PANs, or raw card data are logged.
