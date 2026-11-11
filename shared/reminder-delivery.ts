/** Success means provider acceptance, not proof the customer read the reminder. */
export type ReminderDeliveryResult =
  | { status: "succeeded"; detail: string }
  | { status: "failed"; detail: string; retryable: boolean };

/** Only explicit rate-limit rejections are automatically retried. A timeout or
 * connection loss can happen after acceptance; neither provider supports a
 * delivery idempotency key, so retrying those could duplicate a reminder. */
export function rejectedReminderDelivery(status?: number): ReminderDeliveryResult {
  return {
    status: "failed",
    detail: status ? `Provider rejected request (HTTP ${status}).` : "Delivery could not be confirmed; automatic retry disabled to prevent duplicates.",
    retryable: status === 429,
  };
}
