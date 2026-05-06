import { describe, it, expect } from "vitest";
import { DropinEmbeddedBuilder } from "../../src/dropin/dropin-embedded";
import type { EnablerOptions } from "../../src/payment-enabler/payment-enabler";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEnablerOptions(): EnablerOptions {
  return {
    processorUrl: "https://localhost:8080",
    sessionId: "session-123",
    merchantId: "merchant-123",
    merchantSiteId: "site-456",
    env: "test",
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("DropinEmbeddedBuilder", () => {
  it("build() returns a DropinComponent instance", () => {
    const builder = new DropinEmbeddedBuilder(makeEnablerOptions());
    const dropin = builder.build({ showPayButton: true });

    // The returned object must satisfy the DropinComponent interface
    expect(dropin).toBeDefined();
    expect(typeof dropin.mount).toBe("function");
    expect(typeof dropin.submit).toBe("function");
  });

  it("dropinHasSubmit is true", () => {
    const builder = new DropinEmbeddedBuilder(makeEnablerOptions());
    expect(builder.dropinHasSubmit).toBe(true);
  });
});
