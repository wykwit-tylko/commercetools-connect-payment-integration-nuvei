import { Static, Type } from "@sinclair/typebox";

/**
 * Public shareable payment provider configuration. Do not include any sensitive data.
 */
export const ConfigResponseSchema = Type.Object({
  environment: Type.String(),
  merchantId: Type.String(),
  merchantSiteId: Type.String(),
});

export type ConfigResponseSchemaDTO = Static<typeof ConfigResponseSchema>;
