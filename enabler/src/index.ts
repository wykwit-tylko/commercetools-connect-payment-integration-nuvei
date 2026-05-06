/**
 * Nuvei Simply Connect Enabler for commercetools Checkout.
 *
 * This library wraps the Nuvei frontend widget and exposes a standard
 * interface that commercetools Checkout (and custom storefronts) can consume.
 */

import type {
  PaymentComponentBuilder,
  PaymentDropinBuilder,
  PaymentEnabler,
} from "./payment-enabler/payment-enabler.js";
import { DropinType } from "./payment-enabler/payment-enabler.js";
import { DropinEmbeddedBuilder } from "./dropin/dropin-embedded.js";

export * from "./payment-enabler/payment-enabler.js";
export { DropinEmbeddedBuilder } from "./dropin/dropin-embedded.js";

export class NuveiEnabler implements PaymentEnabler {
  private opts: import("./payment-enabler/payment-enabler.js").EnablerOptions;

  constructor(opts: import("./payment-enabler/payment-enabler.js").EnablerOptions) {
    this.opts = opts;
  }

  async createComponentBuilder(_type: string): Promise<PaymentComponentBuilder> {
    throw new Error(
      "Individual component types are not supported. Use the embedded dropin instead.",
    );
  }

  async createDropinBuilder(type: DropinType): Promise<PaymentDropinBuilder> {
    if (type !== DropinType.embedded) {
      throw new Error(`Dropin type "${type}" is not supported.`);
    }
    return new DropinEmbeddedBuilder(this.opts);
  }
}
