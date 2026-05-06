import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import { NuveiClient, NuveiApiError } from "../../../src/clients/nuvei.client";

const TEST_SECRET = "test-secret-key-1234567890";
const TEST_BASE_URL = "https://sandbox.safecharge.com";

function makeClient(overrides?: { secretKey?: string; baseUrl?: string }): NuveiClient {
  return new NuveiClient({
    baseUrl: overrides?.baseUrl ?? TEST_BASE_URL,
    merchantId: "test-merchant-id",
    merchantSiteId: "test-site-id",
    secretKey: overrides?.secretKey ?? TEST_SECRET,
  });
}

describe("NuveiClient", () => {
  let client: NuveiClient;

  beforeEach(() => {
    client = makeClient();
    vi.restoreAllMocks();
  });

  // ---------------------------------------------------------------------------
  // validateDmnChecksum
  // ---------------------------------------------------------------------------

  describe("validateDmnChecksum", () => {
    it("returns true for valid SHA256 checksum", () => {
      const body: Record<string, unknown> = {
        totalAmount: "10.00",
        currency: "USD",
        responseTimeStamp: "2025-01-01T00:00:00",
        PPP_TransactionID: "12345",
        Status: "APPROVED",
        productId: "prod-1",
      };

      const checksumInput =
        TEST_SECRET +
        String(body.totalAmount) +
        String(body.currency) +
        String(body.responseTimeStamp) +
        String(body.PPP_TransactionID) +
        String(body.Status) +
        String(body.productId);

      const expectedChecksum = crypto.createHash("sha256").update(checksumInput).digest("hex");
      body.advanceResponseChecksum = expectedChecksum;

      const result = client.validateDmnChecksum(body);
      expect(result).toBe(true);
    });

    it("returns false for invalid checksum", () => {
      const body: Record<string, unknown> = {
        totalAmount: "10.00",
        currency: "USD",
        responseTimeStamp: "2025-01-01T00:00:00",
        PPP_TransactionID: "12345",
        Status: "APPROVED",
        productId: "prod-1",
        advanceResponseChecksum: "0000000000000000000000000000000000000000000000000000000000000000",
      };

      const result = client.validateDmnChecksum(body);
      expect(result).toBe(false);
    });

    it("rejects MD5 checksums", () => {
      const body: Record<string, unknown> = {
        totalAmount: "10.00",
        currency: "USD",
        responseTimeStamp: "2025-01-01T00:00:00",
        PPP_TransactionID: "12345",
        Status: "APPROVED",
        productId: "prod-1",
      };

      const checksumInput =
        TEST_SECRET +
        String(body.totalAmount) +
        String(body.currency) +
        String(body.responseTimeStamp) +
        String(body.PPP_TransactionID) +
        String(body.Status) +
        String(body.productId);

      const expectedChecksum = crypto.createHash("md5").update(checksumInput).digest("hex");
      body.advanceResponseChecksum = expectedChecksum;

      const result = client.validateDmnChecksum(body, "md5" as "sha256");
      expect(result).toBe(false);
    });

    it("returns false when computed and received checksums have different lengths (timing-safe)", () => {
      const body: Record<string, unknown> = {
        totalAmount: "10.00",
        currency: "USD",
        responseTimeStamp: "2025-01-01T00:00:00",
        PPP_TransactionID: "12345",
        Status: "APPROVED",
        productId: "prod-1",
        // Short checksum that does not match the sha256 hex length of 64
        advanceResponseChecksum: "abcdef",
      };

      const result = client.validateDmnChecksum(body);
      expect(result).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // openOrder
  // ---------------------------------------------------------------------------

  describe("openOrder", () => {
    it("sends a signed request with a checksum", async () => {
      let capturedBody: Record<string, unknown> | undefined;

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (_url: string | URL | Request, init?: RequestInit) => {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              internalRequestId: 1,
              status: "SUCCESS",
              errCode: 0,
              reason: "",
              merchantId: "test-merchant-id",
              merchantSiteId: "test-site-id",
              version: "1.0",
              clientRequestId: "req-1",
              sessionToken: "session-abc",
              clientUniqueId: "cart-1",
              orderId: 100,
              userTokenId: "",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      );

      await client.openOrder({
        amount: "10.00",
        currency: "USD",
        clientUniqueId: "cart-1",
      });

      expect(capturedBody).toBeDefined();
      expect(capturedBody!.checksum).toBeDefined();
      expect(typeof capturedBody!.checksum).toBe("string");
      expect(capturedBody!.merchantId).toBe("test-merchant-id");
      expect(capturedBody!.merchantSiteId).toBe("test-site-id");
    });
  });

  // ---------------------------------------------------------------------------
  // getPaymentStatus
  // ---------------------------------------------------------------------------

  describe("getPaymentStatus", () => {
    it("does NOT include a checksum in the request body", async () => {
      let capturedBody: Record<string, unknown> | undefined;

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (_url: string | URL | Request, init?: RequestInit) => {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              status: "SUCCESS",
              transactionStatus: "APPROVED",
              errCode: 0,
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      );

      await client.getPaymentStatus({ sessionToken: "session-abc" });

      expect(capturedBody).toBeDefined();
      expect(capturedBody!.checksum).toBeUndefined();
      expect(capturedBody!.sessionToken).toBe("session-abc");
    });
  });

  // ---------------------------------------------------------------------------
  // settleTransaction
  // ---------------------------------------------------------------------------

  describe("settleTransaction", () => {
    it("sends a signed request with proper checksum", async () => {
      let capturedBody: Record<string, unknown> | undefined;

      vi.spyOn(globalThis, "fetch").mockImplementation(
        async (_url: string | URL | Request, init?: RequestInit) => {
          capturedBody = JSON.parse(init?.body as string);
          return new Response(
            JSON.stringify({
              internalRequestId: 1,
              status: "SUCCESS",
              errCode: 0,
              reason: "",
              merchantId: "test-merchant-id",
              merchantSiteId: "test-site-id",
              version: "1.0",
              clientRequestId: "req-1",
              transactionId: "tx-999",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      );

      const result = await client.settleTransaction({
        amount: "10.00",
        currency: "USD",
        relatedTransactionId: "tx-100",
      });

      expect(capturedBody!.checksum).toBeDefined();
      expect(result.transactionId).toBe("tx-999");
    });
  });

  // ---------------------------------------------------------------------------
  // Error handling
  // ---------------------------------------------------------------------------

  describe("error handling", () => {
    it("throws NuveiApiError when errCode != 0", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            errCode: 1,
            reason: "Invalid request",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });

      await expect(client.getPaymentStatus({ sessionToken: "session-abc" })).rejects.toThrow(
        NuveiApiError,
      );
    });

    it("throws NuveiApiError when HTTP status != 200", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            status: "ERROR",
            errCode: 0,
          }),
          { status: 500, headers: { "content-type": "application/json" } },
        );
      });

      await expect(client.getPaymentStatus({ sessionToken: "session-abc" })).rejects.toThrow(
        NuveiApiError,
      );
    });
  });
});
