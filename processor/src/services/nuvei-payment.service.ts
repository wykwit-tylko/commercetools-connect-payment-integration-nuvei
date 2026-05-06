import {
  CommercetoolsCartService,
  CommercetoolsOrderService,
  CommercetoolsPaymentService,
  ErrorInvalidOperation,
  healthCheckCommercetoolsPermissions,
  statusHandler,
} from "@commercetools/connect-payments-sdk";
import {
  CancelPaymentRequest,
  CapturePaymentRequest,
  ConfigResponse,
  PaymentProviderModificationResponse,
  RefundPaymentRequest,
  ReversePaymentRequest,
  StatusResponse,
} from "./types/operation.type.js";
import { SupportedPaymentComponentsSchemaDTO } from "../dtos/operations/payment-components.dto.js";
import {
  PaymentModificationStatus,
  PaymentTransactions,
} from "../dtos/operations/payment-intents.dto.js";
import { TransactionDraftDTO, TransactionResponseDTO } from "../dtos/operations/transaction.dto.js";
import { AbstractPaymentService } from "./abstract-payment.service.js";
import { getConfig } from "../config/config.js";
import { appLogger, paymentSDK } from "../payment-sdk.js";
import { log } from "../libs/logger/index.js";
import {
  getCartIdFromContext,
  getMerchantReturnUrlFromContext,
} from "../libs/fastify/context/context.js";
import { nuveiClient } from "../clients/nuvei.client.js";
import { CtPaymentCreationService } from "./ct-payment-creation.service.js";
import {
  NuveiEventConverter,
  type NuveiDmnUpdateData,
} from "./converters/nuvei-event.converter.js";
import type { Payment } from "@commercetools/platform-sdk";

export type NuveiPaymentServiceOptions = {
  ctCartService: CommercetoolsCartService;
  ctPaymentService: CommercetoolsPaymentService;
  ctOrderService: CommercetoolsOrderService;
};

export class NuveiPaymentService extends AbstractPaymentService {
  private paymentCreationService: CtPaymentCreationService;
  private nuveiEventConverter: NuveiEventConverter;

  constructor(opts: NuveiPaymentServiceOptions) {
    super(opts.ctCartService, opts.ctPaymentService, opts.ctOrderService);
    this.paymentCreationService = new CtPaymentCreationService({
      ctCartService: opts.ctCartService,
      ctPaymentService: opts.ctPaymentService,
    });
    this.nuveiEventConverter = new NuveiEventConverter();
  }

  private formatAmount(amount: {
    centAmount: number;
    currencyCode: string;
    fractionDigits?: number;
  }): string {
    const fractionDigits =
      amount.fractionDigits ?? this.getCurrencyFractionDigits(amount.currencyCode);
    return (amount.centAmount / 10 ** fractionDigits).toFixed(fractionDigits);
  }

  private getCurrencyFractionDigits(currencyCode: string): number {
    return (
      new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode,
      }).resolvedOptions().maximumFractionDigits ?? 2
    );
  }

  private getTransactionInteractionId(
    payment: Payment,
    transactionType: string,
  ): string | undefined {
    for (let index = payment.transactions.length - 1; index >= 0; index -= 1) {
      const transaction = payment.transactions[index];
      if (
        transaction.type === transactionType &&
        transaction.state === "Success" &&
        transaction.interactionId
      ) {
        return transaction.interactionId;
      }
    }

    return undefined;
  }

  private redactToken(token: string): string {
    if (token.length <= 10) {
      return "[redacted]";
    }
    return `${token.slice(0, 6)}...[redacted]...${token.slice(-4)}`;
  }

  private paymentHasInteraction(payment: Payment, interactionId: string): boolean {
    return (
      payment.interfaceId === interactionId ||
      (payment.transactions ?? []).some((tx) => tx.interactionId === interactionId)
    );
  }

  private async assertSessionPaymentAccess(
    paymentReference: string,
    sessionToken: string,
    payment: Payment,
  ): Promise<void> {
    if (!this.paymentHasInteraction(payment, sessionToken)) {
      throw new Error("Payment does not match Nuvei session token");
    }

    const cartId = getCartIdFromContext();
    const cart = await this.ctCartService.getCart({ id: cartId });
    const paymentRefs = cart.paymentInfo?.payments ?? [];
    const isPaymentOnCart = paymentRefs.some((paymentRef) => paymentRef.id === paymentReference);

    if (!isPaymentOnCart) {
      throw new Error("Payment does not belong to authenticated cart session");
    }
  }

  private assertNuveiStatusMatchesPayment(
    statusBody: Record<string, unknown>,
    payment: Payment,
    cartId: string,
    requireFinancialFields = false,
  ): void {
    const clientUniqueId = statusBody.clientUniqueId;
    if (clientUniqueId !== undefined && String(clientUniqueId) !== cartId) {
      throw new Error("Nuvei payment status does not match cart");
    }

    const currency = statusBody.currency;
    if (requireFinancialFields && currency === undefined) {
      throw new Error("Nuvei payment status is missing currency");
    }
    if (currency !== undefined && String(currency) !== payment.amountPlanned.currencyCode) {
      throw new Error("Nuvei payment status currency does not match payment");
    }

    const amount = statusBody.amount;
    if (requireFinancialFields && amount === undefined) {
      throw new Error("Nuvei payment status is missing amount");
    }
    if (amount !== undefined) {
      const statusCentAmount = this.parseAmountToCentAmount(
        amount,
        payment.amountPlanned.currencyCode,
      );
      if (statusCentAmount !== payment.amountPlanned.centAmount) {
        throw new Error("Nuvei payment status amount does not match payment");
      }
    }
  }

  private assertDmnMatchesConfig(body: Record<string, unknown>): void {
    const config = getConfig();
    const merchantId = body.merchant_id ?? body.merchantId;
    const merchantSiteId = body.merchant_site_id ?? body.merchantSiteId;

    if (merchantId !== undefined && String(merchantId) !== config.nuveiMerchantId) {
      throw new Error("DMN merchant_id does not match configured merchant");
    }

    if (merchantSiteId !== undefined && String(merchantSiteId) !== config.nuveiMerchantSiteId) {
      throw new Error("DMN merchant_site_id does not match configured merchant site");
    }
  }

  private assertDmnUpdateMatchesPayment(
    updateData: {
      transactions: Array<{
        amount?: { centAmount: number; currencyCode: string };
        state?: string;
        type?: string;
      }>;
    },
    payment: Payment,
  ): void {
    for (const tx of updateData.transactions) {
      if (!tx.amount) {
        continue;
      }

      if (tx.amount.currencyCode !== payment.amountPlanned.currencyCode) {
        throw new Error("DMN currency does not match payment");
      }

      if (
        tx.state === "Success" &&
        (tx.type === PaymentTransactions.AUTHORIZATION || tx.type === PaymentTransactions.CHARGE) &&
        tx.amount.centAmount !== payment.amountPlanned.centAmount
      ) {
        throw new Error("DMN amount does not match payment");
      }
    }
  }

  private async assertDmnMatchesNuveiStatus(
    updateData: NuveiDmnUpdateData,
    payment: Payment,
  ): Promise<void> {
    const successfulPaymentTransaction = updateData.transactions.find(
      (tx) =>
        tx.state === "Success" &&
        (tx.type === PaymentTransactions.AUTHORIZATION || tx.type === PaymentTransactions.CHARGE),
    );

    if (!successfulPaymentTransaction) {
      return;
    }

    if (!payment.interfaceId) {
      throw new Error("Payment is missing Nuvei session token");
    }

    const statusBody = await nuveiClient().getPaymentStatus({ sessionToken: payment.interfaceId });

    if (statusBody.status !== "SUCCESS" || statusBody.transactionStatus !== "APPROVED") {
      throw new Error("Nuvei payment status does not confirm successful DMN");
    }

    if (statusBody.sessionToken !== undefined && statusBody.sessionToken !== payment.interfaceId) {
      throw new Error("Nuvei payment status session token does not match payment");
    }

    if (!statusBody.transactionId) {
      throw new Error("Nuvei payment status is missing transactionId");
    }

    if (statusBody.transactionId !== updateData.pspReference) {
      throw new Error("Nuvei payment status transaction does not match DMN");
    }

    this.assertNuveiStatusMatchesPayment(
      statusBody as Record<string, unknown>,
      payment,
      String(statusBody.clientUniqueId ?? ""),
      true,
    );
  }

  private parseAmountToCentAmount(amount: unknown, currencyCode: string): number {
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount)) {
      throw new Error("Invalid Nuvei amount");
    }
    const fractionDigits = this.getCurrencyFractionDigits(currencyCode);
    return Math.round(parsedAmount * 10 ** fractionDigits);
  }

  /**
   * Get configurations
   *
   * @remarks
   * Returns Nuvei-specific configuration for the frontend.
   *
   * @returns Promise with object containing environment, merchantId, merchantSiteId
   */
  public async config(): Promise<ConfigResponse> {
    const config = getConfig();
    return {
      environment: config.nuveiEnv,
      merchantId: config.nuveiMerchantId,
      merchantSiteId: config.nuveiMerchantSiteId,
    };
  }

  /**
   * Get status
   *
   * @remarks
   * Checks CT permissions and Nuvei API reachability.
   *
   * @returns Promise with status response
   */
  public async status(): Promise<StatusResponse> {
    const config = getConfig();
    const handler = await statusHandler({
      timeout: config.healthCheckTimeout,
      log: appLogger,
      checks: [
        healthCheckCommercetoolsPermissions({
          requiredPermissions: [
            "manage_payments",
            "view_sessions",
            "view_api_clients",
            "manage_checkout_payment_intents",
            "introspect_oauth_tokens",
          ],
          ctAuthorizationService: paymentSDK.ctAuthorizationService,
          projectKey: config.projectKey,
        }),
        async () => {
          try {
            await nuveiClient().isReachable();
            return {
              name: "Nuvei Status check",
              status: "UP",
              message: "Nuvei API is reachable",
            };
          } catch (e) {
            return {
              name: "Nuvei Status check",
              status: "DOWN",
              message: "Nuvei API is not reachable. Please check the logs for more details.",
              details: {
                error: e instanceof Error ? e.message : String(e),
              },
            };
          }
        },
      ],
      metadataFn: async () => ({
        name: "@nuvei-commercetools/processor",
      }),
    })();

    return handler.body;
  }

  /**
   * Get supported payment components
   *
   * @remarks
   * Returns the supported payment components for the Nuvei integration.
   *
   * @returns Promise with supported payment components
   */
  public async getSupportedPaymentComponents(): Promise<SupportedPaymentComponentsSchemaDTO> {
    return {
      dropins: [
        {
          type: "embedded",
        },
      ],
      components: [
        {
          type: "card",
        },
      ],
      express: [],
    };
  }

  /**
   * Capture payment in Nuvei (settleTransaction)
   *
   * @remarks
   * Settles a previously authorized transaction in Nuvei.
   *
   * @param request - contains the amount and Payment
   * @returns Promise with outcome and PSP reference
   */
  public async capturePayment(
    request: CapturePaymentRequest,
  ): Promise<PaymentProviderModificationResponse> {
    try {
      const interfaceId =
        this.getTransactionInteractionId(request.payment, PaymentTransactions.AUTHORIZATION) ??
        (request.payment.interfaceId as string);
      const amount = request.amount;
      const formattedAmount = this.formatAmount(amount);
      const currency = amount.currencyCode;

      log.info("Capturing payment via Nuvei settleTransaction.", {
        paymentId: request.payment.id,
        interfaceId,
        amount: formattedAmount,
        currency,
      });

      const response = await nuveiClient().settleTransaction({
        amount: formattedAmount,
        currency,
        relatedTransactionId: interfaceId,
      });

      log.info("Nuvei settleTransaction completed.", {
        paymentId: request.payment.id,
        interfaceId,
        outcome: PaymentModificationStatus.APPROVED,
      });

      return {
        outcome: PaymentModificationStatus.APPROVED,
        pspReference:
          ((response as Record<string, unknown>).transactionId as string) || interfaceId,
      };
    } catch (error) {
      log.error("Error capturing payment in Nuvei", {
        error: error instanceof Error ? error.message : String(error),
        paymentId: request.payment.id,
      });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Cancel payment in Nuvei (voidTransaction)
   *
   * @remarks
   * Voids a previously authorized transaction in Nuvei.
   *
   * @param request - contains the Payment
   * @returns Promise with outcome and PSP reference
   */
  public async cancelPayment(
    request: CancelPaymentRequest,
  ): Promise<PaymentProviderModificationResponse> {
    try {
      const interfaceId =
        this.getTransactionInteractionId(request.payment, PaymentTransactions.AUTHORIZATION) ??
        (request.payment.interfaceId as string);
      const amount = request.payment.amountPlanned;
      const formattedAmount = this.formatAmount(amount);
      const currency = amount.currencyCode;

      log.info("Canceling payment via Nuvei voidTransaction.", {
        paymentId: request.payment.id,
        interfaceId,
      });

      const response = await nuveiClient().voidTransaction({
        amount: formattedAmount,
        currency,
        relatedTransactionId: interfaceId,
      });

      log.info("Nuvei voidTransaction completed.", {
        paymentId: request.payment.id,
        interfaceId,
        outcome: PaymentModificationStatus.APPROVED,
      });

      return {
        outcome: PaymentModificationStatus.APPROVED,
        pspReference:
          ((response as Record<string, unknown>).transactionId as string) || interfaceId,
      };
    } catch (error) {
      log.error("Error canceling payment in Nuvei", {
        error: error instanceof Error ? error.message : String(error),
        paymentId: request.payment.id,
      });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Refund payment in Nuvei (refundTransaction)
   *
   * @remarks
   * Refunds a previously captured transaction in Nuvei. Uses RECEIVED outcome
   * since refunds may be processed asynchronously.
   *
   * @param request - contains the amount and Payment
   * @returns Promise with outcome and PSP reference
   */
  public async refundPayment(
    request: RefundPaymentRequest,
  ): Promise<PaymentProviderModificationResponse> {
    try {
      const interfaceId =
        request.transactionId ??
        this.getTransactionInteractionId(request.payment, PaymentTransactions.CHARGE) ??
        (request.payment.interfaceId as string);
      const amount = request.amount;
      const formattedAmount = this.formatAmount(amount);
      const currency = amount.currencyCode;

      log.info("Refunding payment via Nuvei refundTransaction.", {
        paymentId: request.payment.id,
        interfaceId,
        amount: formattedAmount,
        currency,
      });

      const response = await nuveiClient().refundTransaction({
        amount: formattedAmount,
        currency,
        relatedTransactionId: interfaceId,
      });

      log.info("Nuvei refundTransaction completed.", {
        paymentId: request.payment.id,
        interfaceId,
        outcome: PaymentModificationStatus.RECEIVED,
      });

      return {
        outcome: PaymentModificationStatus.RECEIVED,
        pspReference:
          ((response as Record<string, unknown>).transactionId as string) || interfaceId,
      };
    } catch (error) {
      log.error("Error refunding payment in Nuvei", {
        error: error instanceof Error ? error.message : String(error),
        paymentId: request.payment.id,
      });
      return {
        outcome: PaymentModificationStatus.REJECTED,
        pspReference: request.payment.interfaceId as string,
      };
    }
  }

  /**
   * Reverse payment
   *
   * @remarks
   * Automatically determines whether to refund or cancel based on existing transactions.
   * If Charge exists and no refund/cancel → refund
   * If Authorization exists and no cancel → cancel
   * Otherwise throws ErrorInvalidOperation
   *
   * @param request - contains the Payment
   * @returns Promise with outcome and PSP reference
   */
  public async reversePayment(
    request: ReversePaymentRequest,
  ): Promise<PaymentProviderModificationResponse> {
    const hasCharge = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: "Charge",
      states: ["Success"],
    });
    const hasRefund = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: "Refund",
      states: ["Success", "Pending"],
    });
    const hasCancelAuthorization = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: "CancelAuthorization",
      states: ["Success", "Pending"],
    });

    const wasPaymentReverted = hasRefund || hasCancelAuthorization;

    if (hasCharge && !wasPaymentReverted) {
      return this.refundPayment({
        payment: request.payment,
        merchantReference: request.merchantReference,
        amount: request.payment.amountPlanned,
      });
    }

    const hasAuthorization = this.ctPaymentService.hasTransactionInState({
      payment: request.payment,
      transactionType: "Authorization",
      states: ["Success"],
    });

    if (hasAuthorization && !wasPaymentReverted) {
      return this.cancelPayment({ payment: request.payment });
    }

    throw new ErrorInvalidOperation("There is no successful payment transaction to reverse.");
  }

  /**
   * Handle the payment transaction request
   *
   * @remarks
   * Creates a Nuvei openOrder session and a corresponding CT Payment.
   *
   * @param transactionDraft - the incoming request payload
   * @returns Promise with transaction status
   */
  public async handleTransaction(
    transactionDraft: TransactionDraftDTO,
  ): Promise<TransactionResponseDTO> {
    try {
      const cart = await this.ctCartService.getCart({ id: transactionDraft.cartId });

      const amountPlanned =
        transactionDraft.amount ?? (await this.ctCartService.getPaymentAmount({ cart }));

      const formattedAmount = this.formatAmount(amountPlanned);

      log.info("Opening Nuvei order for transaction.", {
        cartId: cart.id,
        amount: formattedAmount,
        currency: amountPlanned.currencyCode,
      });

      const openOrderResponse = await nuveiClient().openOrder({
        amount: formattedAmount,
        currency: amountPlanned.currencyCode,
        clientUniqueId: cart.id,
      });

      const sessionToken = openOrderResponse.sessionToken;

      await this.paymentCreationService.handleCtPaymentCreation({
        interactionId: sessionToken,
        amountPlanned,
        cart,
      });

      log.info("Transaction created successfully.", {
        cartId: cart.id,
        sessionToken: this.redactToken(sessionToken),
      });

      return {
        transactionStatus: {
          state: "Pending",
          errors: [],
        },
      };
    } catch (error) {
      log.error("Error handling transaction", {
        error: error instanceof Error ? error.message : String(error),
        cartId: transactionDraft.cartId,
      });

      return {
        transactionStatus: {
          state: "Failed",
          errors: [
            {
              code: "PaymentRejected",
              message: "Failed to create payment transaction.",
            },
          ],
        },
      };
    }
  }

  /**
   * Create a payment intent (openOrder) with Nuvei
   *
   * @remarks
   * Creates a Nuvei openOrder session and a corresponding CT Payment.
   *
   * @param options - Optional payment method options
   * @returns Promise with cartId, sessionToken, paymentReference, merchantReturnUrl
   */
  public async createPaymentIntent(_options?: {
    paymentMethodOptions?: Record<string, Record<string, unknown>>;
  }): Promise<{
    cartId: string;
    sessionToken: string;
    paymentReference: string;
    merchantReturnUrl: string;
  }> {
    try {
      const cartId = getCartIdFromContext();
      const cart = await this.ctCartService.getCart({ id: cartId });
      const amountPlanned = await this.ctCartService.getPaymentAmount({ cart });
      const formattedAmount = this.formatAmount(amountPlanned);

      log.info("Creating Nuvei payment intent via openOrder.", {
        cartId: cart.id,
        amount: formattedAmount,
        currency: amountPlanned.currencyCode,
      });

      const openOrderResponse = await nuveiClient().openOrder({
        amount: formattedAmount,
        currency: amountPlanned.currencyCode,
        clientUniqueId: cart.id,
      });

      const sessionToken = openOrderResponse.sessionToken;

      const paymentReference = await this.paymentCreationService.handleCtPaymentCreation({
        interactionId: sessionToken,
        amountPlanned,
        cart,
      });

      const config = getConfig();
      const merchantReturnUrl = getMerchantReturnUrlFromContext() || config.returnUrl;

      log.info("Payment intent created successfully.", {
        cartId: cart.id,
        sessionToken: this.redactToken(sessionToken),
        paymentReference,
      });

      return {
        cartId: cart.id,
        sessionToken,
        paymentReference,
        merchantReturnUrl,
      };
    } catch (error) {
      log.error("Error creating payment intent", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Confirm a payment after frontend Nuvei widget completion
   *
   * @remarks
   * Verifies the payment status with Nuvei and updates the CT Payment
   * with the appropriate Authorization transaction state.
   *
   * @param paymentReference - The CT Payment ID
   * @param sessionToken - The Nuvei session token
   * @returns Promise indicating success
   */
  public async confirmPayment(
    paymentReference: string,
    sessionToken: string,
  ): Promise<{ success: boolean }> {
    try {
      log.info("Confirming payment with Nuvei.", {
        paymentReference,
        sessionToken: this.redactToken(sessionToken),
      });

      const ctPayment = await this.ctPaymentService.getPayment({ id: paymentReference });
      await this.assertSessionPaymentAccess(paymentReference, sessionToken, ctPayment);

      const paymentStatus = await nuveiClient().getPaymentStatus({ sessionToken });
      const statusBody = paymentStatus as Record<string, unknown>;
      const isApproved =
        statusBody.status === "SUCCESS" && statusBody.transactionStatus === "APPROVED";
      const cartId = getCartIdFromContext();
      this.assertNuveiStatusMatchesPayment(statusBody, ctPayment, cartId, isApproved);

      if (isApproved) {
        const transactionId = statusBody.transactionId as string | undefined;
        if (!transactionId) {
          throw new Error("Missing Nuvei transactionId for approved payment");
        }

        log.info("Payment approved by Nuvei.", {
          paymentReference,
          sessionToken: this.redactToken(sessionToken),
          transactionId,
        });

        await this.ctPaymentService.updatePayment({
          id: ctPayment.id,
          pspReference: transactionId,
          transaction: {
            type: PaymentTransactions.AUTHORIZATION,
            amount: ctPayment.amountPlanned,
            state: "Success",
            interactionId: transactionId,
          },
        });
      } else {
        log.info("Payment not approved by Nuvei.", {
          paymentReference,
          sessionToken: this.redactToken(sessionToken),
          status: String(statusBody.status),
          transactionStatus: String(statusBody.transactionStatus),
        });

        await this.ctPaymentService.updatePayment({
          id: ctPayment.id,
          pspReference: sessionToken,
          transaction: {
            type: PaymentTransactions.AUTHORIZATION,
            amount: ctPayment.amountPlanned,
            state: "Failure",
            interactionId: sessionToken,
          },
        });
      }

      return { success: true };
    } catch (error) {
      log.error("Error confirming payment", {
        error: error instanceof Error ? error.message : String(error),
        paymentReference,
        sessionToken: this.redactToken(sessionToken),
      });
      throw error;
    }
  }

  /**
   * Process a Nuvei DMN (Direct Merchant Notification) webhook
   *
   * @remarks
   * Validates the DMN checksum, checks idempotency, and updates the CT Payment
   * with the appropriate transaction and payment status.
   *
   * @param body - The DMN request body
   */
  public async processNuveiDmn(body: Record<string, unknown>): Promise<void> {
    const config = getConfig();

    const isValid = nuveiClient().validateDmnChecksum(body, config.nuveiDmnChecksumAlgorithm);
    if (!isValid) {
      throw new Error("Invalid DMN checksum");
    }

    this.assertDmnMatchesConfig(body);

    const paymentId = body.merchant_unique_id as string;
    if (!paymentId) {
      throw new Error("Missing merchant_unique_id in DMN body");
    }

    log.info("Processing Nuvei DMN.", {
      paymentId,
      transactionType: String(body.transactionType),
      pppStatus: String(body.ppp_status),
    });

    const ctPayment = await this.ctPaymentService.getPayment({ id: paymentId });

    const transactionId = (body.TransactionID as string) || (body.TransactionId as string);

    if (transactionId) {
      const existingInteractionIds = (ctPayment.transactions || [])
        .map((tx) => tx.interactionId)
        .filter((id): id is string => !!id);

      if (existingInteractionIds.includes(transactionId)) {
        log.info("DMN already processed, skipping.", {
          paymentId,
          transactionId,
        });
        return;
      }
    }

    const updateData = this.nuveiEventConverter.convertDmnToPaymentUpdate(
      body,
      ctPayment.amountPlanned?.centAmount,
    );
    this.assertDmnUpdateMatchesPayment(updateData, ctPayment);
    await this.assertDmnMatchesNuveiStatus(updateData, ctPayment);

    for (const tx of updateData.transactions) {
      await this.ctPaymentService.updatePayment({
        id: paymentId,
        pspReference: updateData.pspReference,
        transaction: tx,
      });
    }

    if (updateData.interfaceCode) {
      log.info("DMN interfaceCode determined.", {
        paymentId,
        interfaceCode: updateData.interfaceCode,
      });
    }

    if (updateData.paymentMethod) {
      await this.ctPaymentService.updatePayment({
        id: paymentId,
        pspReference: updateData.pspReference,
        paymentMethodInfo: {
          method: updateData.paymentMethod,
        },
      });
    }

    if (updateData.paymentMethodName) {
      await this.ctPaymentService.updatePayment({
        id: paymentId,
        pspReference: updateData.pspReference,
        paymentMethodInfo: {
          name: updateData.paymentMethodName,
        },
      });
    }

    log.info("DMN processed successfully.", {
      paymentId,
      transactionId: updateData.pspReference,
      interfaceCode: updateData.interfaceCode,
    });
  }
}
