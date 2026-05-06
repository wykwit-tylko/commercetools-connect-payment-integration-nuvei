import {
  Cart,
  CommercetoolsCartService,
  CommercetoolsPaymentService,
} from "@commercetools/connect-payments-sdk";
import { PaymentTransactions } from "../dtos/operations/payment-intents.dto.js";
import { getConfig } from "../config/config.js";
import { log } from "../libs/logger/index.js";
import { NUVEI_PAYMENT_INTERFACE } from "../constants.js";

export type CtPaymentCreationServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
};

export class CtPaymentCreationService {
  private ctCartService: CommercetoolsCartService;
  private ctPaymentService: CommercetoolsPaymentService;

  constructor(opts: CtPaymentCreationServiceOptions) {
    this.ctCartService = opts.ctCartService;
    this.ctPaymentService = opts.ctPaymentService;
  }

  /**
   * Creates a Commercetools Payment with the given amountPlanned, interfaceId, and an Initial Authorization transaction.
   * Associates the payment with the cart.
   *
   * @param opts.interactionId - The Nuvei sessionToken / transaction ID to use as interfaceId
   * @param opts.amountPlanned - The planned amount for the payment
   * @param opts.cart - The cart to associate the payment with
   * @returns The created payment ID
   */
  public async handleCtPaymentCreation(opts: {
    interactionId: string;
    amountPlanned: { centAmount: number; currencyCode: string };
    cart: Cart;
  }): Promise<string> {
    const response = await this.ctPaymentService.createPayment({
      amountPlanned: opts.amountPlanned,
      interfaceId: opts.interactionId,
      paymentMethodInfo: {
        paymentInterface: NUVEI_PAYMENT_INTERFACE,
        method: "nuvei",
        name: { en: "Nuvei" },
      },
      ...(opts.cart.customerId
        ? { customer: { typeId: "customer", id: opts.cart.customerId } }
        : opts.cart.anonymousId
          ? { anonymousId: opts.cart.anonymousId }
          : null),
      transactions: [
        {
          type: PaymentTransactions.AUTHORIZATION,
          amount: opts.amountPlanned,
          state: "Initial",
          interactionId: opts.interactionId,
        },
      ],
    });

    const paymentId = response.id;

    await this.ctCartService.addPayment({
      resource: {
        id: opts.cart.id,
        version: opts.cart.version,
      },
      paymentId,
    });

    log.info("Commercetools Payment and initial transaction created.", {
      ctCartId: opts.cart.id,
      ctPaymentId: paymentId,
      interactionId: opts.interactionId,
    });

    return paymentId;
  }

  /**
   * Returns metadata for the payment, containing cart ID and project key.
   */
  public getPaymentMetadata(cart: Cart): Record<string, string> {
    const { projectKey } = getConfig();
    return {
      cart_id: cart.id,
      project_key: projectKey,
    };
  }
}
