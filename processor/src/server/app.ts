import { paymentSDK } from "../payment-sdk.js";
import { NuveiPaymentService } from "../services/nuvei-payment.service.js";

const paymentService = new NuveiPaymentService({
  ctCartService: paymentSDK.ctCartService,
  ctPaymentService: paymentSDK.ctPaymentService,
  ctOrderService: paymentSDK.ctOrderService,
});

export const app = {
  services: {
    paymentService,
  },
};
