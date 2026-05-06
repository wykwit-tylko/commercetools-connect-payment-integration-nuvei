import { ConfigResponseSchemaDTO } from "../../dtos/operations/config.dto.js";
import {
  AmountSchemaDTO,
  PaymentIntentRequestSchemaDTO,
  PaymentModificationStatus,
} from "../../dtos/operations/payment-intents.dto.js";
import { StatusResponseSchemaDTO } from "../../dtos/operations/status.dto.js";
import type { Payment } from "@commercetools/platform-sdk";

export type CapturePaymentRequest = {
  amount: AmountSchemaDTO;
  payment: Payment;
  merchantReference?: string;
};

export type CancelPaymentRequest = {
  payment: Payment;
  merchantReference?: string;
};

export type RefundPaymentRequest = {
  amount: AmountSchemaDTO;
  payment: Payment;
  merchantReference?: string;
  transactionId?: string;
};

export type ReversePaymentRequest = {
  payment: Payment;
  merchantReference?: string;
};

export type PaymentProviderModificationResponse = {
  outcome: PaymentModificationStatus;
  pspReference: string;
};

export type ConfigResponse = ConfigResponseSchemaDTO;

export type StatusResponse = StatusResponseSchemaDTO;

export type ModifyPayment = {
  paymentId: string;
  data: PaymentIntentRequestSchemaDTO;
};
