export const config = {
  // Required by Payment SDK
  projectKey: process.env.CTP_PROJECT_KEY || "payment-integration",
  clientId: process.env.CTP_CLIENT_ID || "xxx",
  clientSecret: process.env.CTP_CLIENT_SECRET || "xxx",
  jwksUrl:
    process.env.CTP_JWKS_URL ||
    "https://mc-api.europe-west1.gcp.commercetools.com/.well-known/jwks.json",
  jwtIssuer: process.env.CTP_JWT_ISSUER || "https://mc-api.europe-west1.gcp.commercetools.com",
  authUrl: process.env.CTP_AUTH_URL || "https://auth.europe-west1.gcp.commercetools.com",
  apiUrl: process.env.CTP_API_URL || "https://api.europe-west1.gcp.commercetools.com",
  sessionUrl: process.env.CTP_SESSION_URL || "https://session.europe-west1.gcp.commercetools.com/",
  checkoutUrl:
    process.env.CTP_CHECKOUT_URL || "https://checkout.europe-west1.gcp.commercetools.com",
  healthCheckTimeout: parseInt(process.env.HEALTH_CHECK_TIMEOUT || "5000"),

  // Required by logger
  loggerLevel: process.env.LOGGER_LEVEL || "info",

  // Nuvei provider config
  nuveiEnv: (process.env.NUVEI_ENV || "test") as "test" | "production",
  nuveiMerchantId: process.env.NUVEI_MERCHANT_ID || "",
  nuveiMerchantSiteId: process.env.NUVEI_MERCHANT_SITE_ID || "",
  nuveiSecretKey: process.env.NUVEI_SECRET_KEY || "",
  nuveiApiBaseUrl: process.env.NUVEI_API_BASE_URL || "",
  nuveiDmnChecksumAlgorithm: "sha256" as const,

  // Connector service config
  serviceUrl: process.env.CONNECT_SERVICE_URL || "",
  port: parseInt(process.env.PORT || "8080"),

  // Payment Providers config
  returnUrl: process.env.RETURN_URL || "",
  corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
};

export const getConfig = () => {
  return config;
};

export function validateConfig(): void {
  const requiredValues = {
    CTP_PROJECT_KEY: config.projectKey,
    CTP_CLIENT_ID: config.clientId,
    CTP_CLIENT_SECRET: config.clientSecret,
    CTP_AUTH_URL: config.authUrl,
    CTP_API_URL: config.apiUrl,
    CTP_SESSION_URL: config.sessionUrl,
    CTP_CHECKOUT_URL: config.checkoutUrl,
    CTP_JWKS_URL: config.jwksUrl,
    CTP_JWT_ISSUER: config.jwtIssuer,
    NUVEI_MERCHANT_ID: config.nuveiMerchantId,
    NUVEI_MERCHANT_SITE_ID: config.nuveiMerchantSiteId,
    NUVEI_SECRET_KEY: config.nuveiSecretKey,
    NUVEI_API_BASE_URL: config.nuveiApiBaseUrl,
  };

  const missing = Object.entries(requiredValues)
    .filter(([, value]) => !value || value === "xxx")
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(", ")}`);
  }

  if (
    process.env.NUVEI_DMN_CHECKSUM_ALGORITHM &&
    process.env.NUVEI_DMN_CHECKSUM_ALGORITHM !== "sha256"
  ) {
    throw new Error("NUVEI_DMN_CHECKSUM_ALGORITHM must be sha256");
  }

  const httpsUrls = {
    CTP_AUTH_URL: config.authUrl,
    CTP_API_URL: config.apiUrl,
    CTP_SESSION_URL: config.sessionUrl,
    CTP_CHECKOUT_URL: config.checkoutUrl,
    CTP_JWKS_URL: config.jwksUrl,
    CTP_JWT_ISSUER: config.jwtIssuer,
    NUVEI_API_BASE_URL: config.nuveiApiBaseUrl,
    ...(config.returnUrl ? { RETURN_URL: config.returnUrl } : {}),
    ...Object.fromEntries(
      config.corsAllowedOrigins.map((origin, index) => [`CORS_ALLOWED_ORIGINS[${index}]`, origin]),
    ),
  };

  for (const [key, value] of Object.entries(httpsUrls)) {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:") {
      throw new Error(`${key} must use HTTPS`);
    }
  }
}
