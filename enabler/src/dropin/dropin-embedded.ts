/**
 * Embedded drop-in builder and component.
 *
 * Dynamically loads the Nuvei Simply Connect (SafeCharge) Web SDK,
 * fetches a session token from the processor, and renders the widget
 * inside the merchant's page.
 */

import type {
  DropinComponent,
  DropinOptions,
  EnablerOptions,
  PaymentDropinBuilder,
} from "../payment-enabler/payment-enabler.js";
import { apiService } from "../services/api-service.js";

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

export class DropinEmbeddedBuilder implements PaymentDropinBuilder {
  public dropinHasSubmit = true;

  private opts: EnablerOptions;

  constructor(opts: EnablerOptions) {
    this.opts = opts;
  }

  build(config: DropinOptions): DropinComponent {
    return new DropinComponents({
      baseOptions: this.opts,
      dropinOptions: config,
    });
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/**
 * CDN URL for the Nuvei / SafeCharge Web SDK.
 *
 * Nuvei documents this unversioned URL for Web SDK v1. The fetched asset is
 * currently identified by Nuvei as `websdk v1.0`, `v1.160.0 / 3/27/2026`.
 * Keep the SRI hash in sync when deliberately accepting a Nuvei SDK update.
 */
const NUVEI_SDK_URL = "https://cdn.safecharge.com/safecharge_resources/v1/websdk/safecharge.js";
const NUVEI_SDK_INTEGRITY =
  "sha384-S5b4DOR5dVcXV9iTeCds2A4KbxfU7z9yv7cMfJA76JlXu9wnrgM7IqFstB7lT8Gv";

/** Shape of the result callback from the Nuvei widget. */
interface NuveiResult {
  transactionStatus: string;
  sessionToken: string;
  errCode: number;
  reason: string;
}

class DropinComponents implements DropinComponent {
  private readonly baseOptions: EnablerOptions;
  private readonly dropinOptions: DropinOptions;
  private readonly api: ReturnType<typeof apiService>;

  constructor(opts: { baseOptions: EnablerOptions; dropinOptions: DropinOptions }) {
    this.baseOptions = opts.baseOptions;
    this.dropinOptions = opts.dropinOptions;
    this.api = apiService({
      baseApi: opts.baseOptions.processorUrl,
      sessionId: opts.baseOptions.sessionId,
    });
  }

  // -- public interface -----------------------------------------------------

  mount(selector: string): void {
    this.loadSdk().then(() => this.initNuveiWidget(selector));
  }

  submit(): void {
    // The Nuvei Simply Connect widget handles its own submit flow
    // (card form → 3DS → result). There is no external submit trigger.
  }

  // -- private helpers ------------------------------------------------------

  /** Returns a promise that resolves once the SafeCharge script is loaded. */
  private loadSdk(): Promise<void> {
    return new Promise((resolve, reject) => {
      // Avoid loading the script more than once.
      const existing = document.querySelector(
        `script[src="${NUVEI_SDK_URL}"]`,
      ) as HTMLScriptElement | null;
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
        } else {
          existing.addEventListener("load", () => resolve());
          existing.addEventListener("error", () => reject(new Error("Failed to load Nuvei SDK")));
        }
        return;
      }

      const script = document.createElement("script");
      script.src = NUVEI_SDK_URL;
      script.integrity = NUVEI_SDK_INTEGRITY;
      script.crossOrigin = "anonymous";
      script.referrerPolicy = "no-referrer";
      script.dataset.loaded = "false";
      script.onload = () => {
        script.dataset.loaded = "true";
        resolve();
      };
      script.onerror = () => reject(new Error("Failed to load Nuvei SDK script"));
      document.head.appendChild(script);
    });
  }

  /** Fetches session data from the processor and renders the widget. */
  private async initNuveiWidget(selector: string): Promise<void> {
    try {
      // 1. Obtain session token from the processor.
      const paymentRes = await this.api.getPayment();

      // 2. Initialise the Nuvei SDK.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const SafeCharge = (window as any).SafeCharge;
      if (!SafeCharge) {
        throw new Error("Nuvei SafeCharge SDK not found on window after script load");
      }

      const sfc = SafeCharge({
        env: this.baseOptions.env === "test" ? "int" : "prod",
        merchantId: this.baseOptions.merchantId,
        merchantSiteId: this.baseOptions.merchantSiteId,
        locale: this.baseOptions.locale,
      });

      // 3. Create and render the payment form.
      sfc.createPayment({
        sessionToken: paymentRes.sessionToken,
        cardHolderName: true,
        billingAddress: {
          country: "US",
          email: "",
        },
        renderTo: selector,
        onResult: (result: NuveiResult) => {
          this.handleNuveiResult(result, paymentRes.paymentReference);
        },
      });

      // 4. Notify the host that the drop-in is ready.
      await this.dropinOptions.onDropinReady?.();
    } catch (error) {
      this.baseOptions.onError?.(error);
    }
  }

  /** Processes the result callback from the Nuvei widget. */
  private handleNuveiResult(result: NuveiResult, paymentReference: string): void {
    if (result.transactionStatus === "APPROVED") {
      this.api
        .confirmPayment({
          sessionToken: result.sessionToken,
          paymentReference,
        })
        .then(() => {
          this.baseOptions.onComplete?.({
            isSuccess: true,
            paymentReference,
            sessionToken: result.sessionToken,
          });
        })
        .catch((err: unknown) => {
          this.baseOptions.onError?.(err);
        });
    } else {
      this.baseOptions.onError?.(
        new Error(result.reason || `Payment failed (status: ${result.transactionStatus})`),
      );
    }
  }
}
