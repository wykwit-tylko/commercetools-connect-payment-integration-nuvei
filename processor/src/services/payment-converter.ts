import type { TransactionType, TransactionState } from "@commercetools/platform-sdk";

/**
 * Map Nuvei transaction types to commercetools TransactionTypes
 */
export function mapNuveiTransactionType(nuveiType: string): TransactionType {
  switch (nuveiType) {
    case "Auth":
    case "PreAuth":
      return "Authorization";
    case "Settle":
    case "Sale":
      return "Charge";
    case "Credit":
      return "Refund";
    case "Void":
      return "CancelAuthorization";
    case "Chargeback":
      return "Chargeback";
    default:
      return "Authorization";
  }
}

/**
 * Map Nuvei DMN status to commercetools TransactionState
 */
export function mapNuveiStatus(nuveiStatus: string): TransactionState {
  switch (nuveiStatus.toUpperCase()) {
    case "OK":
      return "Success";
    case "FAIL":
      return "Failure";
    default:
      return "Pending";
  }
}

/**
 * Derive paymentStatus.interfaceCode from transaction details
 */
export function getStatusInterfaceCode(
  transactionType: TransactionType,
  transactionState: TransactionState,
  totalCentAmount: number,
  plannedCentAmount?: number,
): string | undefined {
  if (transactionState === "Failure") {
    return "failed";
  }

  if (transactionState !== "Success" || totalCentAmount !== plannedCentAmount) {
    return undefined;
  }

  switch (transactionType) {
    case "Authorization":
      return "authorized";
    case "Charge":
      return "paid";
    case "Refund":
      return "refunded";
    case "CancelAuthorization":
      return "cancelled";
    default:
      return undefined;
  }
}
