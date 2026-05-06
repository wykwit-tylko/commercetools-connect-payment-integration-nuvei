import { FastifyInstance } from "fastify";
import { paymentRoutes, nuveiWebhookRoutes } from "../../routes/nuvei-payment.route.js";
import { app } from "../app.js";
import { paymentSDK } from "../../payment-sdk.js";
import { NuveiHeaderAuthHook } from "../../libs/fastify/hooks/nuvei-header-auth.hook.js";

export default async function (server: FastifyInstance) {
  const nuveiHeaderAuthHook = new NuveiHeaderAuthHook();

  await server.register(paymentRoutes, {
    prefix: "/payments",
    paymentService: app.services.paymentService,
    sessionHeaderAuthHook: paymentSDK.sessionHeaderAuthHookFn,
  });

  await server.register(nuveiWebhookRoutes, {
    prefix: "/webhooks",
    paymentService: app.services.paymentService,
    nuveiHeaderAuthHook,
  });
}
