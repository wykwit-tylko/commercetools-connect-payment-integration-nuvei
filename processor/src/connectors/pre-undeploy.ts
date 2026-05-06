/**
 * Pre-undeploy script for the Nuvei commercetools Connector.
 *
 * Runs before the processor service is removed via commercetools Connect.
 * Reminds the operator to remove the DMN webhook from the Nuvei dashboard,
 * since Nuvei does not support programmatic webhook deletion.
 *
 * This connector does NOT manage Custom Types, so there are no commercetools
 * resources to clean up.
 */
async function run() {
  try {
    console.log("========================================");
    console.log("Nuvei Connector — Pre-Undeploy");
    console.log("========================================");
    console.log("");
    console.log("ACTION REQUIRED: Remove the DMN webhook URL from your Nuvei dashboard:");
    console.log("  Settings > My Integration Settings > DMN URL");
    console.log("");
    console.log("No commercetools Custom Types were created by this connector.");
    console.log("No commercetools cleanup is required.");
    console.log("========================================");

    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`Pre-undeploy failed: ${message}\n`);
    process.exit(1);
  }
}

run();
