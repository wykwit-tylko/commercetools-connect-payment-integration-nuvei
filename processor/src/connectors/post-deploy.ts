/**
 * Post-deploy script for the Nuvei commercetools Connector.
 *
 * Runs after the processor service is deployed via commercetools Connect.
 * Logs the DMN webhook URL that must be configured manually in the Nuvei dashboard,
 * since Nuvei does not support programmatic webhook registration.
 *
 * This connector does NOT create Custom Types. It uses native commercetools Payment
 * fields (interfaceId, paymentMethodInfo, paymentStatus, transactions) exclusively.
 */
async function run() {
  try {
    const serviceUrl = process.env.CONNECT_SERVICE_URL || "";

    const dmnUrl = `${serviceUrl}/webhooks/nuvei`;

    console.log("========================================");
    console.log("Nuvei Connector — Post-Deploy");
    console.log("========================================");
    console.log(`DMN Webhook URL: ${dmnUrl}`);
    console.log("");
    console.log("ACTION REQUIRED: Configure this URL in your Nuvei dashboard:");
    console.log("  Settings > My Integration Settings > DMN URL");
    console.log("");
    console.log("No Custom Types are created by this connector.");
    console.log("========================================");

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Post-deploy failed: ${message}\n`);
    process.exit(1);
  }
}

run();
