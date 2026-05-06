import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("@commercetools/connect-payments-sdk", () => ({
  SessionHeaderAuthenticationHook: class {
    authenticate = () => async () => {};
  },
  Oauth2AuthenticationHook: class {
    authenticate = () => async () => {};
  },
  JWTAuthenticationHook: class {
    authenticate = () => async () => {};
  },
  AuthorityAuthorizationHook: class {
    authorize =
      (..._perms: string[]) =>
      async () => {};
  },
}));

vi.mock("@sinclair/typebox", () => ({
  Type: {
    String: () => ({ type: "string" }),
  },
}));

vi.mock("../../../src/dtos/operations/config.dto", () => ({
  ConfigResponseSchema: { type: "object" },
  ConfigResponseSchemaDTO: {},
}));

vi.mock("../../../src/dtos/operations/payment-components.dto", () => ({
  SupportedPaymentComponentsSchema: { type: "object" },
}));

vi.mock("../../../src/dtos/operations/payment-intents.dto", () => ({
  PaymentIntentRequestSchema: { type: "object" },
  PaymentIntentRequestSchemaDTO: {},
  PaymentIntentResponseSchema: { type: "object" },
  PaymentIntentResponseSchemaDTO: {},
}));

vi.mock("../../../src/dtos/operations/status.dto", () => ({
  StatusResponseSchema: { type: "object" },
  StatusResponseSchemaDTO: {},
}));

vi.mock("../../../src/dtos/operations/transaction.dto", () => ({
  TransactionDraft: { type: "object" },
  TransactionDraftDTO: {},
  TransactionResponse: { type: "object" },
  TransactionResponseDTO: {},
}));

vi.mock("../../../src/services/abstract-payment.service", () => ({
  AbstractPaymentService: class {},
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { operationsRoute } from "../../../src/routes/operation.route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RouteEntry {
  method: string;
  url: string;
  handler: (request: any, reply: any) => Promise<any>;
}

function buildApp() {
  const routes: RouteEntry[] = [];

  const fastify = {
    get: vi.fn((url: string, _opts: any, handler: any) => {
      routes.push({ method: "GET", url, handler });
    }),
    post: vi.fn((url: string, _opts: any, handler: any) => {
      routes.push({ method: "POST", url, handler });
    }),
  } as any;

  return { fastify, routes };
}

function makeReply() {
  const sent: unknown[] = [];
  const codes: number[] = [];
  const reply = {
    code: vi.fn((_c: number) => reply),
    status: vi.fn((_c: number) => reply),
    send: vi.fn((body: unknown) => {
      sent.push(body);
    }),
    _sent: sent,
    _codes: codes,
  };
  return reply;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("operation routes", () => {
  const paymentService = {
    config: vi.fn(),
    status: vi.fn(),
    getSupportedPaymentComponents: vi
      .fn()
      .mockResolvedValue({ dropins: [], components: [], express: [] }),
    modifyPayment: vi.fn(),
    handleTransaction: vi.fn(),
  };

  let app: ReturnType<typeof buildApp>;

  beforeEach(async () => {
    vi.restoreAllMocks();
    paymentService.config.mockResolvedValue({
      environment: "test",
      merchantId: "m1",
      merchantSiteId: "s1",
    });
    paymentService.status.mockResolvedValue({ status: "UP" });
    paymentService.modifyPayment.mockResolvedValue({ outcome: "approved" });

    app = buildApp();

    const {
      SessionHeaderAuthenticationHook,
      Oauth2AuthenticationHook,
      JWTAuthenticationHook,
      AuthorityAuthorizationHook,
    } = await import("@commercetools/connect-payments-sdk");

    await operationsRoute(app.fastify, {
      sessionHeaderAuthHook: new SessionHeaderAuthenticationHook(),
      oauth2AuthHook: new Oauth2AuthenticationHook(),
      jwtAuthHook: new JWTAuthenticationHook(),
      authorizationHook: new AuthorityAuthorizationHook(),
      paymentService: paymentService as any,
    } as any);
  });

  it("registers /config route that delegates to paymentService.config()", async () => {
    const configRoute = app.routes.find((r) => r.url === "/config");
    expect(configRoute).toBeDefined();
    expect(configRoute!.method).toBe("GET");

    const reply = makeReply();
    await configRoute!.handler({}, reply);

    expect(paymentService.config).toHaveBeenCalledOnce();
    expect(reply.send).toHaveBeenCalledWith({
      environment: "test",
      merchantId: "m1",
      merchantSiteId: "s1",
    });
    expect(reply.code).toHaveBeenCalledWith(200);
  });

  it("registers /status route that delegates to paymentService.status()", async () => {
    const statusRoute = app.routes.find((r) => r.url === "/status");
    expect(statusRoute).toBeDefined();
    expect(statusRoute!.method).toBe("GET");

    const reply = makeReply();
    await statusRoute!.handler({}, reply);

    expect(paymentService.status).toHaveBeenCalledOnce();
    expect(reply.send).toHaveBeenCalledWith({ status: "UP" });
    expect(reply.code).toHaveBeenCalledWith(200);
  });

  it("registers /payment-intents/:id route that extracts params and calls modifyPayment()", async () => {
    const modifyRoute = app.routes.find((r) => r.url === "/payment-intents/:id");
    expect(modifyRoute).toBeDefined();
    expect(modifyRoute!.method).toBe("POST");

    const request = {
      params: { id: "payment-42" },
      body: {
        actions: [{ action: "capturePayment", amount: { centAmount: 1000, currencyCode: "USD" } }],
      },
    };
    const reply = makeReply();
    await modifyRoute!.handler(request, reply);

    expect(paymentService.modifyPayment).toHaveBeenCalledWith({
      paymentId: "payment-42",
      data: request.body,
    });
    expect(reply.status).toHaveBeenCalledWith(200);
    expect(reply.send).toHaveBeenCalledWith({ outcome: "approved" });
  });
});
