import { describe, it, expect, vi, beforeEach } from "vitest";
import { PaymentModificationStatus } from "../../../src/dtos/operations/payment-intents.dto";

// ---------------------------------------------------------------------------
// Mock all external modules before importing the class under test.
// ---------------------------------------------------------------------------

const mockNuveiClientInstance = {
  settleTransaction: vi.fn(),
  voidTransaction: vi.fn(),
  refundTransaction: vi.fn(),
  openOrder: vi.fn(),
  getPaymentStatus: vi.fn(),
  isReachable: vi.fn(),
  validateDmnChecksum: vi.fn(),
};

vi.mock("../../../src/clients/nuvei.client", () => ({
  nuveiClient: () => mockNuveiClientInstance,
}));

vi.mock("../../../src/config/config", () => ({
  getConfig: () => ({
    nuveiEnv: "test",
    nuveiMerchantId: "merchant-123",
    nuveiMerchantSiteId: "site-456",
    nuveiSecretKey: "secret-key",
    nuveiApiBaseUrl: "https://sandbox.safecharge.com",
    nuveiDmnChecksumAlgorithm: "sha256",
    projectKey: "test-project",
    healthCheckTimeout: 5000,
    returnUrl: "https://example.com/return",
  }),
  config: {},
}));

vi.mock("../../../src/payment-sdk", () => ({
  appLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
  paymentSDK: {},
}));

vi.mock("../../../src/libs/logger/index", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../../src/libs/fastify/context/context", () => ({
  getCartIdFromContext: () => "cart-123",
  getMerchantReturnUrlFromContext: () => "https://example.com/return",
}));

const mockHasTransactionInState = vi.fn();
const mockGetPayment = vi.fn();
const mockUpdatePayment = vi.fn();
const mockGetCart = vi.fn();
const mockGetPaymentAmount = vi.fn();

vi.mock("@commercetools/connect-payments-sdk", () => ({
  CommercetoolsCartService: class {
    getCart = mockGetCart;
    getPaymentAmount = mockGetPaymentAmount;
  },
  CommercetoolsOrderService: class {},
  CommercetoolsPaymentService: class {
    getPayment = mockGetPayment;
    updatePayment = mockUpdatePayment;
    hasTransactionInState = mockHasTransactionInState;
  },
  ErrorInvalidOperation: class extends Error {
    constructor(message: string) {
      super(message);
      this.name = "ErrorInvalidOperation";
    }
  },
  healthCheckCommercetoolsPermissions: vi.fn(),
  statusHandler: vi.fn(),
}));

vi.mock("../../../src/services/ct-payment-creation.service", () => ({
  CtPaymentCreationService: class {
    handleCtPaymentCreation = vi.fn().mockResolvedValue("payment-ref-1");
  },
}));

vi.mock("../../../src/services/converters/nuvei-event.converter", () => ({
  NuveiEventConverter: class {
    convertDmnToPaymentUpdate = vi.fn().mockReturnValue({
      id: "payment-1",
      pspReference: "dmn-tx-1",
      transactions: [
        {
          type: "Charge",
          interactionId: "dmn-tx-1",
          amount: { centAmount: 1000, currencyCode: "USD" },
          state: "Success",
        },
      ],
      interfaceCode: "paid",
      paymentMethod: "Visa",
      paymentMethodName: { en: "Credit Card" },
    });
  },
}));

import { NuveiPaymentService } from "../../../src/services/nuvei-payment.service";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockPayment(overrides: Record<string, unknown> = {}) {
  return {
    id: "payment-1",
    interfaceId: "nuvei-tx-100",
    amountPlanned: { centAmount: 1000, currencyCode: "USD" },
    transactions: [],
    ...overrides,
  } as any;
}

function createService() {
  const ctCartService = { getCart: mockGetCart, getPaymentAmount: mockGetPaymentAmount };
  const ctPaymentService = {
    getPayment: mockGetPayment,
    updatePayment: mockUpdatePayment,
    hasTransactionInState: mockHasTransactionInState,
  };
  const ctOrderService = {};

  mockGetCart.mockResolvedValue({
    id: "cart-123",
    totalPrice: { centAmount: 1000, currencyCode: "USD" },
    paymentInfo: { payments: [{ typeId: "payment", id: "payment-1" }] },
  });
  mockGetPaymentAmount.mockResolvedValue({ centAmount: 1000, currencyCode: "USD" });
  mockGetPayment.mockResolvedValue(makeMockPayment());
  mockUpdatePayment.mockResolvedValue(undefined);

  const service = new NuveiPaymentService({
    ctCartService: ctCartService as any,
    ctPaymentService: ctPaymentService as any,
    ctOrderService: ctOrderService as any,
  });

  return { service };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("NuveiPaymentService", () => {
  beforeEach(() => {
    mockNuveiClientInstance.settleTransaction.mockReset();
    mockNuveiClientInstance.voidTransaction.mockReset();
    mockNuveiClientInstance.refundTransaction.mockReset();
    mockNuveiClientInstance.openOrder.mockReset();
    mockNuveiClientInstance.getPaymentStatus.mockReset();
    mockNuveiClientInstance.isReachable.mockReset();
    mockNuveiClientInstance.validateDmnChecksum.mockReset();
    mockHasTransactionInState.mockReset();
    mockGetPayment.mockReset();
    mockUpdatePayment.mockReset();
    mockGetCart.mockReset();
    mockGetPaymentAmount.mockReset();
  });

  // -------------------------------------------------------------------------
  // config()
  // -------------------------------------------------------------------------
  describe("config()", () => {
    it("returns correct environment, merchantId, merchantSiteId", async () => {
      const { service } = createService();
      const result = await service.config();
      expect(result).toEqual({
        environment: "test",
        merchantId: "merchant-123",
        merchantSiteId: "site-456",
      });
    });
  });

  // -------------------------------------------------------------------------
  // getSupportedPaymentComponents()
  // -------------------------------------------------------------------------
  describe("getSupportedPaymentComponents()", () => {
    it("returns embedded dropin and card component", async () => {
      const { service } = createService();
      const result = await service.getSupportedPaymentComponents();
      expect(result.dropins).toContainEqual({ type: "embedded" });
      expect(result.components).toContainEqual({ type: "card" });
      expect(result.express).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  // capturePayment()
  // -------------------------------------------------------------------------
  describe("capturePayment()", () => {
    it("calls settleTransaction and returns APPROVED", async () => {
      const { service } = createService();

      mockNuveiClientInstance.settleTransaction.mockResolvedValue({
        transactionId: "settle-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      const result = await service.capturePayment({
        payment: makeMockPayment(),
        amount: { centAmount: 1000, currencyCode: "USD" },
      });

      expect(mockNuveiClientInstance.settleTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "10.00",
          currency: "USD",
          relatedTransactionId: "nuvei-tx-100",
        }),
      );
      expect(result.outcome).toBe(PaymentModificationStatus.APPROVED);
      expect(result.pspReference).toBe("settle-tx-1");
    });

    it("uses the successful authorization transaction as relatedTransactionId", async () => {
      const { service } = createService();

      mockNuveiClientInstance.settleTransaction.mockResolvedValue({
        transactionId: "settle-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      await service.capturePayment({
        payment: makeMockPayment({
          interfaceId: "session-token-1",
          transactions: [
            { type: "Authorization", state: "Initial", interactionId: "session-token-1" },
            { type: "Authorization", state: "Success", interactionId: "auth-tx-1" },
          ],
        }),
        amount: { centAmount: 1234, currencyCode: "KWD", fractionDigits: 3 } as any,
      });

      expect(mockNuveiClientInstance.settleTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "1.234",
          relatedTransactionId: "auth-tx-1",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // cancelPayment()
  // -------------------------------------------------------------------------
  describe("cancelPayment()", () => {
    it("calls voidTransaction and returns APPROVED", async () => {
      const { service } = createService();

      mockNuveiClientInstance.voidTransaction.mockResolvedValue({
        transactionId: "void-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      const result = await service.cancelPayment({
        payment: makeMockPayment(),
      });

      expect(mockNuveiClientInstance.voidTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "10.00",
          currency: "USD",
          relatedTransactionId: "nuvei-tx-100",
        }),
      );
      expect(result.outcome).toBe(PaymentModificationStatus.APPROVED);
      expect(result.pspReference).toBe("void-tx-1");
    });

    it("uses the successful authorization transaction as relatedTransactionId", async () => {
      const { service } = createService();

      mockNuveiClientInstance.voidTransaction.mockResolvedValue({
        transactionId: "void-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      await service.cancelPayment({
        payment: makeMockPayment({
          interfaceId: "session-token-1",
          transactions: [
            { type: "Authorization", state: "Initial", interactionId: "session-token-1" },
            { type: "Authorization", state: "Success", interactionId: "auth-tx-1" },
          ],
        }),
      });

      expect(mockNuveiClientInstance.voidTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedTransactionId: "auth-tx-1",
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // refundPayment()
  // -------------------------------------------------------------------------
  describe("refundPayment()", () => {
    it("calls refundTransaction and returns RECEIVED", async () => {
      const { service } = createService();

      mockNuveiClientInstance.refundTransaction.mockResolvedValue({
        transactionId: "refund-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      const result = await service.refundPayment({
        payment: makeMockPayment(),
        amount: { centAmount: 1000, currencyCode: "USD" },
      });

      expect(mockNuveiClientInstance.refundTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "10.00",
          currency: "USD",
          relatedTransactionId: "nuvei-tx-100",
        }),
      );
      expect(result.outcome).toBe(PaymentModificationStatus.RECEIVED);
      expect(result.pspReference).toBe("refund-tx-1");
    });

    it("uses an explicit transactionId before payment.interfaceId", async () => {
      const { service } = createService();

      mockNuveiClientInstance.refundTransaction.mockResolvedValue({
        transactionId: "refund-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      await service.refundPayment({
        payment: makeMockPayment({ interfaceId: "session-token-1" }),
        amount: { centAmount: 1000, currencyCode: "USD" },
        transactionId: "charge-tx-1",
      });

      expect(mockNuveiClientInstance.refundTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          relatedTransactionId: "charge-tx-1",
        }),
      );
    });
  });

  describe("createPaymentIntent()", () => {
    it("formats zero-decimal currencies without forcing cents", async () => {
      const { service } = createService();

      mockGetCart.mockResolvedValue({ id: "cart-1", version: 1 });
      mockGetPaymentAmount.mockResolvedValue({
        centAmount: 1000,
        currencyCode: "JPY",
        fractionDigits: 0,
      });
      mockNuveiClientInstance.openOrder.mockResolvedValue({ sessionToken: "session-token-1" });

      await service.createPaymentIntent();

      expect(mockNuveiClientInstance.openOrder).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: "1000",
          currency: "JPY",
        }),
      );
    });
  });

  describe("confirmPayment()", () => {
    it("stores the Nuvei transactionId for approved payments", async () => {
      const { service } = createService();

      mockNuveiClientInstance.getPaymentStatus.mockResolvedValue({
        status: "SUCCESS",
        transactionStatus: "APPROVED",
        transactionId: "auth-tx-1",
        amount: "10.00",
        currency: "USD",
      });
      mockGetPayment.mockResolvedValue(makeMockPayment({ interfaceId: "session-token-1" }));

      await service.confirmPayment("payment-1", "session-token-1");

      expect(mockUpdatePayment).toHaveBeenCalledWith(
        expect.objectContaining({
          pspReference: "auth-tx-1",
          transaction: expect.objectContaining({
            interactionId: "auth-tx-1",
          }),
        }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // reversePayment()
  // -------------------------------------------------------------------------
  describe("reversePayment()", () => {
    it("with Charge → calls refundPayment", async () => {
      const { service } = createService();

      mockHasTransactionInState
        .mockReturnValueOnce(true) // hasCharge = true
        .mockReturnValueOnce(false) // hasRefund = false
        .mockReturnValueOnce(false); // hasCancelAuthorization = false

      mockNuveiClientInstance.refundTransaction.mockResolvedValue({
        transactionId: "refund-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      const result = await service.reversePayment({
        payment: makeMockPayment(),
        merchantReference: "ref-1",
      });

      expect(result.outcome).toBe(PaymentModificationStatus.RECEIVED);
    });

    it("with Authorization → calls cancelPayment", async () => {
      const { service } = createService();

      mockHasTransactionInState
        .mockReturnValueOnce(false) // hasCharge = false
        .mockReturnValueOnce(false) // hasRefund = false
        .mockReturnValueOnce(false) // hasCancelAuthorization = false
        .mockReturnValueOnce(true) // hasAuthorization = true
        .mockReturnValueOnce(false); // hasCancelAuthorization = false (re-check in wasPaymentReverted)

      mockNuveiClientInstance.voidTransaction.mockResolvedValue({
        transactionId: "void-tx-1",
        status: "SUCCESS",
        errCode: 0,
      });

      const result = await service.reversePayment({
        payment: makeMockPayment(),
        merchantReference: "ref-1",
      });

      expect(result.outcome).toBe(PaymentModificationStatus.APPROVED);
    });

    it("with neither Charge nor Authorization → throws ErrorInvalidOperation", async () => {
      const { service } = createService();

      mockHasTransactionInState.mockReturnValue(false);

      await expect(
        service.reversePayment({
          payment: makeMockPayment(),
          merchantReference: "ref-1",
        }),
      ).rejects.toThrow("There is no successful payment transaction to reverse.");
    });
  });

  // -------------------------------------------------------------------------
  // processNuveiDmn()
  // -------------------------------------------------------------------------
  describe("processNuveiDmn()", () => {
    it("with valid checksum adds transaction to CT payment", async () => {
      const { service } = createService();

      mockNuveiClientInstance.validateDmnChecksum.mockReturnValue(true);
      mockGetPayment.mockResolvedValue(
        makeMockPayment({
          amountPlanned: { centAmount: 1000, currencyCode: "USD" },
          transactions: [],
        }),
      );
      mockNuveiClientInstance.getPaymentStatus.mockResolvedValue({
        status: "SUCCESS",
        transactionStatus: "APPROVED",
        transactionId: "dmn-tx-1",
        sessionToken: "nuvei-tx-100",
        amount: "10.00",
        currency: "USD",
      });

      const body: Record<string, unknown> = {
        merchant_unique_id: "payment-1",
        TransactionID: "dmn-tx-1",
        totalAmount: "10.00",
        currency: "USD",
        transactionType: "Sale",
        ppp_status: "OK",
        Status: "APPROVED",
      };

      await service.processNuveiDmn(body);

      expect(mockGetPayment).toHaveBeenCalledWith({ id: "payment-1" });
      expect(mockUpdatePayment).toHaveBeenCalled();
    });

    it("rejects DMN when Nuvei status transaction does not match", async () => {
      const { service } = createService();

      mockNuveiClientInstance.validateDmnChecksum.mockReturnValue(true);
      mockNuveiClientInstance.getPaymentStatus.mockResolvedValue({
        status: "SUCCESS",
        transactionStatus: "APPROVED",
        transactionId: "different-tx",
        sessionToken: "nuvei-tx-100",
        amount: "10.00",
        currency: "USD",
      });

      const body: Record<string, unknown> = {
        merchant_unique_id: "payment-1",
        TransactionID: "dmn-tx-1",
        totalAmount: "10.00",
        currency: "USD",
        transactionType: "Sale",
        ppp_status: "OK",
        Status: "APPROVED",
      };

      await expect(service.processNuveiDmn(body)).rejects.toThrow(
        "Nuvei payment status transaction does not match DMN",
      );
      expect(mockUpdatePayment).not.toHaveBeenCalled();
    });

    it("with duplicate transactionId skips update", async () => {
      const { service } = createService();

      mockNuveiClientInstance.validateDmnChecksum.mockReturnValue(true);
      mockGetPayment.mockResolvedValue(
        makeMockPayment({
          transactions: [{ interactionId: "existing-tx-1", type: "Charge", state: "Success" }],
        }),
      );

      const body: Record<string, unknown> = {
        merchant_unique_id: "payment-1",
        TransactionID: "existing-tx-1",
        totalAmount: "10.00",
        currency: "USD",
        transactionType: "Sale",
        ppp_status: "OK",
      };

      await service.processNuveiDmn(body);

      expect(mockUpdatePayment).not.toHaveBeenCalled();
    });

    it("with invalid checksum throws error", async () => {
      const { service } = createService();

      mockNuveiClientInstance.validateDmnChecksum.mockReturnValue(false);

      await expect(service.processNuveiDmn({})).rejects.toThrow("Invalid DMN checksum");
    });
  });
});
