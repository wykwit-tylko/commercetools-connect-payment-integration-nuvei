import { FastifyRequest } from "fastify";
import { ErrorAuthErrorResponse } from "@commercetools/connect-payments-sdk";

/**
 * Lightweight pre-filter for Nuvei DMN webhook requests.
 * Checks for the presence of advanceResponseChecksum in the request body.
 * The actual cryptographic checksum validation is performed in the route handler
 * via nuveiClient.validateDmnChecksum().
 */
export class NuveiHeaderAuthHook {
  public authenticate() {
    return async (request: FastifyRequest): Promise<void> => {
      const body = request.body as Record<string, unknown> | undefined;
      if (body?.advanceResponseChecksum) {
        return;
      }
      throw new ErrorAuthErrorResponse("Nuvei DMN checksum is not present");
    };
  }
}
