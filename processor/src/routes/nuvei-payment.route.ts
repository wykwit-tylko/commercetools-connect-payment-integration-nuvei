import { SessionHeaderAuthenticationHook } from "@commercetools/connect-payments-sdk";
import { Type } from "@sinclair/typebox";
import { FastifyInstance, FastifyPluginOptions } from "fastify";
import {
  PaymentResponseSchema,
  PaymentResponseSchemaDTO,
  PaymentMethodOptionsSchema,
  PaymentMethodOptionsSchemaDTO,
  PaymentConfirmRequestSchema,
  PaymentConfirmRequestSchemaDTO,
} from "../dtos/nuvei-payment.dto.js";
import {
  PaymentIntentResponseSchema,
  PaymentModificationStatus,
} from "../dtos/operations/payment-intents.dto.js";
import { NuveiPaymentService } from "../services/nuvei-payment.service.js";
import { NuveiHeaderAuthHook } from "../libs/fastify/hooks/nuvei-header-auth.hook.js";
import { nuveiClient } from "../clients/nuvei.client.js";
import { log } from "../libs/logger/index.js";
import { getConfig } from "../config/config.js";

type PaymentRoutesOptions = {
  paymentService: NuveiPaymentService;
  sessionHeaderAuthHook: SessionHeaderAuthenticationHook;
};

type WebhookRoutesOptions = {
  paymentService: NuveiPaymentService;
  nuveiHeaderAuthHook: NuveiHeaderAuthHook;
};

/**
 * Payment routes for the Nuvei connector.
 *
 * GET / - Create a payment intent (backward compatible, no options)
 * POST / - Create a payment intent with payment method options
 * POST /confirmPayments/:id - Confirm a payment after Nuvei widget completion
 */
export const paymentRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & PaymentRoutesOptions,
) => {
  // GET / - Backward compatible endpoint (no payment method options)
  fastify.get<{ Reply: PaymentResponseSchemaDTO }>(
    "/",
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (_, reply) => {
      const resp = await opts.paymentService.createPaymentIntent();
      return reply.status(200).send(resp);
    },
  );

  // POST / - New endpoint with payment method options support
  fastify.post<{ Body: PaymentMethodOptionsSchemaDTO; Reply: PaymentResponseSchemaDTO }>(
    "/",
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        body: PaymentMethodOptionsSchema,
        response: {
          200: PaymentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const resp = await opts.paymentService.createPaymentIntent(request.body);
      return reply.status(200).send(resp);
    },
  );

  fastify.post<{
    Body: PaymentConfirmRequestSchemaDTO;
    Reply: { outcome: "approved" | "rejected" };
    Params: { id: string };
  }>(
    "/confirmPayments/:id",
    {
      preHandler: [opts.sessionHeaderAuthHook.authenticate()],
      schema: {
        params: {
          $id: "paramsSchema",
          type: "object",
          properties: {
            id: Type.String(),
          },
          required: ["id"],
        },
        body: PaymentConfirmRequestSchema,
        response: {
          200: PaymentIntentResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const { id } = request.params;
      try {
        await opts.paymentService.confirmPayment(id, request.body.sessionToken);

        return reply.status(200).send({ outcome: PaymentModificationStatus.APPROVED });
      } catch (error) {
        log.error("Payment confirmation failed", {
          error: error instanceof Error ? error.message : "Unknown error",
          paymentId: id,
        });
        return reply.status(400).send({ outcome: PaymentModificationStatus.REJECTED });
      }
    },
  );
};

/**
 * Webhook routes for Nuvei DMN (Direct Merchant Notification).
 *
 * POST /nuvei - Receive and process Nuvei DMN webhooks
 */
export const nuveiWebhookRoutes = async (
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & WebhookRoutesOptions,
) => {
  fastify.post(
    "/nuvei",
    {
      preHandler: [opts.nuveiHeaderAuthHook.authenticate()],
      config: { rawBody: true },
    },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      const config = getConfig();

      const isValid = nuveiClient().validateDmnChecksum(body, config.nuveiDmnChecksumAlgorithm);
      if (!isValid) {
        log.error("Invalid DMN checksum received.", {
          merchantId: String(body.merchant_id),
        });
        return reply.status(400).send({ error: "Invalid checksum." });
      }

      try {
        await opts.paymentService.processNuveiDmn(body);
        return reply.status(200).send();
      } catch (error) {
        log.error("Error processing Nuvei DMN", {
          error: error instanceof Error ? error.message : "Unknown error",
        });
        return reply.status(500).send({ error: "Processing failed." });
      }
    },
  );
};
