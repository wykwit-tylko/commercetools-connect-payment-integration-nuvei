/**
 * API service – thin fetch wrapper around the Nuvei processor backend.
 *
 * Every request carries the commercetools session ID so the processor can
 * correlate the call with the correct cart / payment.
 */

/** Shape of the response returned by `GET /payments`. */
export type GetPaymentResponse = {
  sessionToken: string;
  paymentReference: string;
  merchantReturnUrl?: string;
};

/** Shape of the response returned by `POST /payments/confirmPayments/:ref`. */
export type ConfirmPaymentResponse = {
  outcome: string;
};

/** Public contract exposed to consuming code. */
export type ApiService = {
  getPayment: () => Promise<GetPaymentResponse>;
  confirmPayment: (opts: ConfirmPaymentRequest) => Promise<ConfirmPaymentResponse>;
};

/** Parameters for the confirm-payment call. */
export type ConfirmPaymentRequest = {
  sessionToken: string;
  paymentReference: string;
};

/**
 * Creates an {@link ApiService} bound to a processor URL and session.
 */
export function apiService(opts: { baseApi: string; sessionId: string }): ApiService {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    "X-Session-ID": opts.sessionId,
  };

  return {
    async getPayment(): Promise<GetPaymentResponse> {
      const res = await fetch(`${opts.baseApi}/payments`, { headers });
      if (!res.ok) {
        throw new Error(`Failed to get payment: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },

    async confirmPayment(params: ConfirmPaymentRequest): Promise<ConfirmPaymentResponse> {
      const res = await fetch(
        `${opts.baseApi}/payments/confirmPayments/${params.paymentReference}`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ sessionToken: params.sessionToken }),
        },
      );
      if (!res.ok) {
        throw new Error(`Failed to confirm payment: ${res.status} ${res.statusText}`);
      }
      return res.json();
    },
  };
}
