/**
 * Nuvei Simply Connect Enabler – public interface definitions.
 *
 * These types model the contract between the commercetools Checkout
 * (or a custom storefront) and the Nuvei payment widget.
 */

/**
 * Entry point for creating payment components and drop-in builders.
 *
 * Usage:
 *   const enabler = new NuveiEnabler({
 *     processorUrl: '…',
 *     sessionId:    '…',
 *     merchantId:   '…',
 *     merchantSiteId: '…',
 *     env:          'test',
 *     onComplete:   (result) => { … },
 *   });
 *
 *   const builder = await enabler.createDropinBuilder(DropinType.embedded);
 *   const dropin  = builder.build({ showPayButton: true });
 *   dropin.mount('#payment-container');
 */
export interface PaymentEnabler {
  createComponentBuilder(type: string): Promise<PaymentComponentBuilder>;
  createDropinBuilder(type: DropinType): Promise<PaymentDropinBuilder>;
}

/**
 * A mounted payment component (e.g. a card element).
 */
export interface PaymentComponent {
  mount(selector: string): void;
  submit(): void;
  isValid?(): boolean;
  getState?(): {
    card?: {
      endDigits?: string;
      brand?: string;
      expiryDate?: string;
    };
  };
  isAvailable?(): Promise<boolean>;
}

/**
 * Builds a {@link PaymentComponent} from configuration.
 */
export interface PaymentComponentBuilder {
  componentHasSubmit?: boolean;
  build(config: ComponentOptions): PaymentComponent;
}

/**
 * Builds a {@link DropinComponent} from configuration.
 */
export interface PaymentDropinBuilder {
  dropinHasSubmit: boolean;
  build(config: DropinOptions): DropinComponent;
}

/**
 * A mounted drop-in component (renders the full Nuvei Simply Connect widget).
 */
export interface DropinComponent {
  mount(selector: string): void;
  submit(): void;
}

/**
 * Options passed to {@link NuveiEnabler} at construction time.
 */
export type EnablerOptions = {
  /** Base URL of the Nuvei processor backend. */
  processorUrl: string;
  /** commercetools session identifier forwarded as X-Session-ID. */
  sessionId: string;
  /** Locale string (e.g. "en_US"). Forwarded to the Nuvei widget when provided. */
  locale?: string;
  /** Nuvei merchant identifier. */
  merchantId: string;
  /** Nuvei merchant site identifier. */
  merchantSiteId: string;
  /** Nuvei environment: "test" maps to SafeCharge integration, "production" to live. */
  env: "test" | "production";
  /** Called when the Nuvei widget reports a completed payment. */
  onComplete?: (result: PaymentResult) => void;
  /** Called when the Nuvei widget or the enabler encounters an error. */
  onError?: (error: unknown) => void;
};

/**
 * Result returned by the Nuvei widget on payment completion.
 */
export type PaymentResult =
  | { isSuccess: true; paymentReference: string; sessionToken: string }
  | { isSuccess: false };

/**
 * Options for individual payment component builders.
 */
export type ComponentOptions = {
  showPayButton?: boolean;
  onPayButtonClick?: () => Promise<void>;
};

/**
 * Options for drop-in component builders.
 */
export type DropinOptions = {
  showPayButton?: boolean;
  onDropinReady?: () => Promise<void>;
  onPayButtonClick?: () => Promise<void>;
};

/**
 * Supported drop-in rendering modes.
 */
export enum DropinType {
  embedded = "embedded",
}

/**
 * Payment method type identifiers recognised by the enabler.
 */
export enum PaymentMethod {
  card = "card",
  dropin = "dropin",
}
