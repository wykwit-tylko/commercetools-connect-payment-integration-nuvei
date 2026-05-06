import { Static, Type } from "@sinclair/typebox";

export const PaymentResponseSchema = Type.Object({
  cartId: Type.String(),
  sessionToken: Type.String(),
  paymentReference: Type.String(),
  merchantReturnUrl: Type.String(),
});

export type PaymentResponseSchemaDTO = Static<typeof PaymentResponseSchema>;

export const PaymentMethodOptionsSchema = Type.Object({
  paymentMethodOptions: Type.Optional(
    Type.Record(Type.String(), Type.Record(Type.String(), Type.Unknown())),
  ),
});

export type PaymentMethodOptionsSchemaDTO = Static<typeof PaymentMethodOptionsSchema>;

export const PaymentConfirmRequestSchema = Type.Object({
  sessionToken: Type.String({ minLength: 1 }),
});

export type PaymentConfirmRequestSchemaDTO = Static<typeof PaymentConfirmRequestSchema>;
