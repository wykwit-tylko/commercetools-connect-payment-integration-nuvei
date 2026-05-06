import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockValidateDmnChecksum = vi.fn();

vi.mock("../../../src/clients/nuvei.client", () => ({
  nuveiClient: () => ({
    validateDmnChecksum: mockValidateDmnChecksum,
  }),
}));

vi.mock("../../../src/config/config", () => ({
  getConfig: () => ({
    nuveiDmnChecksumAlgorithm: "sha256",
  }),
  config: {},
}));

vi.mock("../../../src/libs/logger/index", () => ({
  log: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock("../../../src/libs/fastify/hooks/nuvei-header-auth.hook", () => ({
  NuveiHeaderAuthHook: class {
    authenticate = () => async () => {};
  },
}));

vi.mock("../../../src/dtos/nuvei-payment.dto", () => ({}));

vi.mock("../../../src/dtos/operations/payment-intents.dto", () => ({
  PaymentIntentResponseSchema: { type: "object" },
  PaymentModificationStatus: { APPROVED: "approved", REJECTED: "rejected" },
}));

vi.mock("../../../src/services/nuvei-payment.service", () => ({
  NuveiPaymentService: class {},
}));

// ---------------------------------------------------------------------------
// Import after mocks
// ---------------------------------------------------------------------------

import { nuveiWebhookRoutes } from "../../../src/routes/nuvei-payment.route";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface RouteEntry {
  method: string;
  url: string;
  opts: any;
  handler: (request: any, reply: any) => Promise<any>;
}

function buildApp() {
  const routes: RouteEntry[] = [];

  const fastify = {
    post: vi.fn((url: string, opts: any, handler: any) => {
      routes.push({ method: "POST", url, opts, handler });
    }),
  } as any;

  return { fastify, routes };
}

function makeReply() {
  const sent: unknown[] = [];
  const statusResult = {
    send: vi.fn((b: unknown) => {
      sent.push(b);
    }),
  };
  return {
    status: vi.fn((_c: number) => statusResult),
    send: vi.fn((b: unknown) => {
      sent.push(b);
    }),
    code: vi.fn((_c: number) => statusResult),
    _sent: sent,
    statusResult,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("webhook route", () => {
  const mockProcessNuveiDmn = vi.fn();

  const paymentService = {
    processNuveiDmn: mockProcessNuveiDmn,
  } as any;

  let app: ReturnType<typeof buildApp>;
  let nuveiHeaderAuthHook: any;

  beforeEach(async () => {
    mockValidateDmnChecksum.mockReset();
    mockProcessNuveiDmn.mockReset();
    app = buildApp();

    const { NuveiHeaderAuthHook } =
      await import("../../../src/libs/fastify/hooks/nuvei-header-auth.hook");
    nuveiHeaderAuthHook = new NuveiHeaderAuthHook();

    await nuveiWebhookRoutes(app.fastify, { paymentService, nuveiHeaderAuthHook } as any);
  });

  it("valid DMN body with correct checksum → calls processNuveiDmn, returns 200", async () => {
    const webhookRoute = app.routes.find((r) => r.url === "/nuvei");
    expect(webhookRoute).toBeDefined();

    mockValidateDmnChecksum.mockReturnValue(true);
    mockProcessNuveiDmn.mockResolvedValue(undefined);

    const body = {
      merchant_unique_id: "payment-1",
      TransactionID: "tx-1",
      advanceResponseChecksum: "abc123",
    };

    const reply = makeReply();
    await webhookRoute!.handler({ body } as any, reply);

    expect(mockValidateDmnChecksum).toHaveBeenCalledWith(body, "sha256");
    expect(mockProcessNuveiDmn).toHaveBeenCalledWith(body);
    expect(reply.status).toHaveBeenCalledWith(200);
  });

  it("invalid DMN checksum → returns 400", async () => {
    const webhookRoute = app.routes.find((r) => r.url === "/nuvei");
    expect(webhookRoute).toBeDefined();

    mockValidateDmnChecksum.mockReturnValue(false);

    const body = {
      merchant_unique_id: "payment-1",
      advanceResponseChecksum: "bad-checksum",
    };

    const reply = makeReply();
    await webhookRoute!.handler({ body } as any, reply);

    expect(mockProcessNuveiDmn).not.toHaveBeenCalled();
    expect(reply.status).toHaveBeenCalledWith(400);
  });

  it("processNuveiDmn throws → returns 500", async () => {
    const webhookRoute = app.routes.find((r) => r.url === "/nuvei");
    expect(webhookRoute).toBeDefined();

    mockValidateDmnChecksum.mockReturnValue(true);
    mockProcessNuveiDmn.mockRejectedValue(new Error("Processing error"));

    const body = {
      merchant_unique_id: "payment-1",
      advanceResponseChecksum: "valid-checksum",
    };

    const reply = makeReply();
    await webhookRoute!.handler({ body } as any, reply);

    expect(reply.status).toHaveBeenCalledWith(500);
  });
});
