import { TransactionData } from "@commercetools/connect-payments-sdk";
import {
  mapNuveiTransactionType,
  mapNuveiStatus,
  getStatusInterfaceCode,
} from "../payment-converter.js";

export interface NuveiDmnUpdateData {
  id: string;
  pspReference: string;
  transactions: TransactionData[];
  paymentMethod?: string;
  paymentMethodName?: { en: string };
  interfaceCode?: string;
  totalCentAmount?: number;
}

function getRequiredString(body: Record<string, unknown>, key: string): string {
  const value = getOptionalString(body, key);
  if (!value) {
    throw new Error(`Missing required DMN field: ${key}`);
  }
  return value;
}

function getRequiredStringFromKeys(body: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = getOptionalString(body, key);
    if (value) {
      return value;
    }
  }
  throw new Error(`Missing required DMN field: ${keys.join(" or ")}`);
}

function getOptionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim() || undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

function parseCentAmount(amount: unknown): number {
  const parsedAmount = Number(amount);
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    throw new Error("Invalid totalAmount in DMN");
  }
  return Math.round(parsedAmount * 100);
}

export class NuveiEventConverter {
  /**
   * Converts a Nuvei DMN (Direct Merchant Notification) body into a structured
   * payment update payload compatible with CommercetoolsPaymentService.updatePayment().
   */
  public convertDmnToPaymentUpdate(
    body: Record<string, unknown>,
    plannedCentAmount?: number,
  ): NuveiDmnUpdateData {
    const paymentId = getRequiredString(body, "merchant_unique_id");
    const transactionId = getRequiredStringFromKeys(body, ["TransactionID", "TransactionId"]);
    const totalCentAmount = parseCentAmount(body.totalAmount);
    const nuveiTransactionType = getRequiredString(body, "transactionType");
    const nuveiStatus = getRequiredString(body, "ppp_status");
    const currency = getRequiredString(body, "currency");
    const transactionType = mapNuveiTransactionType(nuveiTransactionType);
    const transactionState = mapNuveiStatus(nuveiStatus);

    const transaction: TransactionData = {
      type: transactionType,
      interactionId: transactionId,
      amount: {
        centAmount: totalCentAmount,
        currencyCode: currency,
      },
      state: transactionState,
    };

    const interfaceCode = getStatusInterfaceCode(
      transactionType,
      transactionState,
      totalCentAmount,
      plannedCentAmount,
    );

    const cardCompany = getOptionalString(body, "cardCompany");
    const cardType = getOptionalString(body, "cardType");

    return {
      id: paymentId,
      pspReference: transactionId,
      transactions: [transaction],
      ...(interfaceCode && { interfaceCode }),
      ...(cardCompany && { paymentMethod: cardCompany }),
      ...(cardType && { paymentMethodName: { en: cardType } }),
      totalCentAmount,
    };
  }
}
