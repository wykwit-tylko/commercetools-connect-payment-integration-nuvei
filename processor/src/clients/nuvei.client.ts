import crypto from "node:crypto";

export interface NuveiClientConfig {
  baseUrl: string;
  merchantId: string;
  merchantSiteId: string;
  secretKey: string;
  timeoutMs?: number;
}

export interface OpenOrderParams {
  amount: string;
  currency: string;
  userTokenId?: string;
  clientUniqueId: string;
}

export interface OpenOrderResult {
  internalRequestId: number;
  status: string;
  errCode: number;
  reason: string;
  merchantId: string;
  merchantSiteId: string;
  version: string;
  clientRequestId: string;
  sessionToken: string;
  clientUniqueId: string;
  orderId: number;
  userTokenId: string;
}

export interface PaymentStatusResponse {
  sessionToken?: string;
  version?: string;
  status?: "SUCCESS" | "ERROR";
  transactionStatus?: string;
  amount?: string;
  currency?: string;
  userPaymentOption?: { userPaymentOptionId?: string };
  customData?: string;
  clientUniqueId?: string;
  gwExtendedErrorCode?: number;
  gwErrorCode?: number;
  gwErrorReason?: string;
  paymentMethodErrorCode?: number;
  paymentMethodErrorReason?: string;
  authCode?: string;
  merchantSiteId?: string;
  transactionType?: "Sale" | "Auth";
  userTokenId?: string;
  transactionId?: string;
  errCode?: number;
  reason?: string;
  paymentOption?:
    | { type: "card"; uniqueCC: string; threeD: Record<string, unknown> }
    | {
        type: "alternativePaymentMethod";
        externalAccountID: string;
        externalAccountDescription: string;
        externalTransactionId: string;
        APMReferenceID: string;
        orderTransactionId: string;
        paymentMethod: string;
        userPaymentOptionId: string;
      };
  clientRequestId?: string;
}

export interface NuveiTransactionResponse {
  internalRequestId: number;
  status: string;
  errCode: number;
  reason: string;
  merchantId: string;
  merchantSiteId: string;
  version: string;
  clientRequestId: string;
  transactionId: string;
  [key: string]: unknown;
}

export class NuveiApiError extends Error {
  public constructor(public readonly responseBody: unknown) {
    super("Nuvei API request failed");
  }
}

type NuveiRequestPayload = Record<string, unknown> & {
  clientRequestId?: string;
  timeStamp?: string;
  checksum?: string;
};

export class NuveiClient {
  private baseUrl: string;
  private merchantId: string;
  private merchantSiteId: string;
  private secretKey: string;
  private timeoutMs: number;

  constructor(config: NuveiClientConfig) {
    if (!config.secretKey) {
      throw new Error("Nuvei secret key is required");
    }
    this.baseUrl = this.normalizeBaseUrl(config.baseUrl);
    this.merchantId = config.merchantId;
    this.merchantSiteId = config.merchantSiteId;
    this.secretKey = config.secretKey;
    this.timeoutMs = config.timeoutMs ?? 10_000;
  }

  async openOrder(params: OpenOrderParams): Promise<OpenOrderResult> {
    return this.sendSignedRequest<OpenOrderResult>(
      "openOrder",
      params as unknown as NuveiRequestPayload,
      [
        "merchantId",
        "merchantSiteId",
        "clientRequestId",
        "amount",
        "currency",
        "timeStamp",
        "secretKey",
      ],
    );
  }

  async getPaymentStatus(params: { sessionToken: string }): Promise<PaymentStatusResponse> {
    return this.sendRequest<PaymentStatusResponse>("getPaymentStatus", {
      sessionToken: params.sessionToken,
    });
  }

  async isReachable(): Promise<boolean> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      await fetch(this.baseUrl, {
        method: "HEAD",
        signal: controller.signal,
      });
      return true;
    } finally {
      clearTimeout(timeout);
    }
  }

  async settleTransaction(params: {
    amount: string;
    currency: string;
    relatedTransactionId: string;
    authCode?: string;
    clientUniqueId?: string;
    comment?: string;
  }): Promise<NuveiTransactionResponse> {
    return this.sendSignedRequest<NuveiTransactionResponse>(
      "settleTransaction",
      params as unknown as NuveiRequestPayload,
      [
        "merchantId",
        "merchantSiteId",
        "clientRequestId",
        "clientUniqueId",
        "amount",
        "currency",
        "relatedTransactionId",
        "authCode",
        "comment",
        "urlDetails",
        "timeStamp",
        "secretKey",
      ],
    );
  }

  async voidTransaction(params: {
    amount: string;
    currency: string;
    relatedTransactionId: string;
    authCode?: string;
    clientUniqueId?: string;
    comment?: string;
  }): Promise<NuveiTransactionResponse> {
    return this.sendSignedRequest<NuveiTransactionResponse>(
      "voidTransaction",
      params as unknown as NuveiRequestPayload,
      [
        "merchantId",
        "merchantSiteId",
        "clientRequestId",
        "clientUniqueId",
        "amount",
        "currency",
        "relatedTransactionId",
        "authCode",
        "comment",
        "urlDetails",
        "timeStamp",
        "secretKey",
      ],
    );
  }

  async refundTransaction(params: {
    amount: string;
    currency: string;
    relatedTransactionId: string;
    authCode?: string;
    clientUniqueId?: string;
    comment?: string;
  }): Promise<NuveiTransactionResponse> {
    return this.sendSignedRequest<NuveiTransactionResponse>(
      "refundTransaction",
      params as unknown as NuveiRequestPayload,
      [
        "merchantId",
        "merchantSiteId",
        "clientRequestId",
        "clientUniqueId",
        "amount",
        "currency",
        "relatedTransactionId",
        "authCode",
        "comment",
        "urlDetails",
        "timeStamp",
        "secretKey",
      ],
    );
  }

  validateDmnChecksum(body: Record<string, unknown>, algorithm: "sha256" = "sha256"): boolean {
    const totalAmount = String(body.totalAmount ?? "");
    const currency = String(body.currency ?? "");
    const responseTimeStamp = String(body.responseTimeStamp ?? "");
    const pppTransactionId = String(body.PPP_TransactionID ?? body.PPP_TransactionId ?? "");
    const status = String(body.Status ?? "");
    const productId = String(body.productId ?? "");

    const checksumInput =
      this.secretKey +
      totalAmount +
      currency +
      responseTimeStamp +
      pppTransactionId +
      status +
      productId;

    const computedChecksum = crypto.createHash(algorithm).update(checksumInput).digest("hex");
    const receivedChecksum = String(body.advanceResponseChecksum ?? "");

    return this.timingSafeHexEqual(computedChecksum, receivedChecksum);
  }

  private async sendSignedRequest<ResponseType>(
    endpoint: string,
    payload: NuveiRequestPayload,
    checksumFields: string[],
  ): Promise<ResponseType> {
    const requestPayload = this.withMerchantFields(payload);
    requestPayload.checksum = this.calculateChecksum(
      this.buildChecksumInput(requestPayload, checksumFields),
    );
    return this.sendRequest<ResponseType>(endpoint, requestPayload);
  }

  private async sendRequest<ResponseType>(
    endpoint: string,
    payload: NuveiRequestPayload,
  ): Promise<ResponseType> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}/${endpoint}.do`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseBody = (await response.json()) as { errCode?: number | string };

      if (
        !response.ok ||
        (responseBody.errCode !== undefined && Number(responseBody.errCode) !== 0)
      ) {
        throw new NuveiApiError(responseBody);
      }

      return responseBody as ResponseType;
    } finally {
      clearTimeout(timeout);
    }
  }

  private withMerchantFields(payload: NuveiRequestPayload): NuveiRequestPayload {
    return {
      ...payload,
      merchantId: this.merchantId,
      merchantSiteId: this.merchantSiteId,
      clientRequestId: payload.clientRequestId ?? crypto.randomUUID(),
      timeStamp: payload.timeStamp ?? this.getTimestamp(),
    };
  }

  private buildChecksumInput(payload: NuveiRequestPayload, checksumFields: string[]): string {
    return checksumFields.map((field) => this.getChecksumFieldValue(payload, field)).join("");
  }

  private getChecksumFieldValue(payload: NuveiRequestPayload, field: string): string {
    if (field === "secretKey") {
      return this.secretKey;
    }
    if (field === "urlDetails") {
      const urlDetails = payload.urlDetails as { notificationUrl?: string } | undefined;
      return urlDetails?.notificationUrl ?? "";
    }
    const value = payload[field];
    if (value === undefined || value === null) {
      return "";
    }
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      return String(value);
    }
    return "";
  }

  private normalizeBaseUrl(configuredBaseUrl: string): string {
    const baseUrl = new URL(configuredBaseUrl);
    if (!baseUrl.pathname.endsWith("/api/v1")) {
      baseUrl.pathname = `${baseUrl.pathname.replace(/\/$/, "")}/api/v1`;
    }
    if (baseUrl.protocol !== "https:") {
      throw new Error("Nuvei API base URL must use HTTPS");
    }
    return baseUrl.toString().replace(/\/$/, "");
  }

  private getTimestamp(): string {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    const day = String(now.getUTCDate()).padStart(2, "0");
    const hours = String(now.getUTCHours()).padStart(2, "0");
    const minutes = String(now.getUTCMinutes()).padStart(2, "0");
    const seconds = String(now.getUTCSeconds()).padStart(2, "0");
    return `${year}${month}${day}${hours}${minutes}${seconds}`;
  }

  private calculateChecksum(checkString: string): string {
    return crypto.createHash("sha256").update(checkString).digest("hex");
  }

  private timingSafeHexEqual(expected: string, received: string): boolean {
    const expectedLength = 64;
    const hexPattern = new RegExp(`^[\\da-f]{${expectedLength}}$`, "i");
    if (!hexPattern.test(expected) || !hexPattern.test(received)) {
      return false;
    }
    return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(received, "hex"));
  }
}

import { getConfig } from "../config/config.js";

let _nuveiClient: NuveiClient | undefined;

export function nuveiClient(): NuveiClient {
  if (!_nuveiClient) {
    const config = getConfig();
    _nuveiClient = new NuveiClient({
      baseUrl: config.nuveiApiBaseUrl,
      merchantId: config.nuveiMerchantId,
      merchantSiteId: config.nuveiMerchantSiteId,
      secretKey: config.nuveiSecretKey,
    });
  }
  return _nuveiClient;
}
