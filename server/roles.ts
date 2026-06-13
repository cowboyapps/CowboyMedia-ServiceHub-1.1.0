/**
 * Shared role helpers.
 *
 * `isStaffRole` is the single source of truth for "is this account a staff
 * account?" — used by the customer-only WHMCS billing routes to reject staff
 * (admin / master_admin) outright. Consolidated here so the set of staff roles
 * lives in ONE place: a missed copy would silently re-open a customer-only
 * action to staff.
 */
export function isStaffRole(role: string | null | undefined): boolean {
  return role === "admin" || role === "master_admin";
}

/**
 * "Should this account be blocked from the customer-only WHMCS billing routes?"
 *
 * Only UNLINKED staff are blocked. A staff member who is ALSO a real WHMCS
 * customer (their own account carries a `whmcs_client_id`) is a legitimate
 * customer and must be served their OWN billing — every billing route scopes its
 * data to the session user's own linked client, so serving them leaks nothing.
 *
 * The original block rejected ALL staff on the assumption that staff never have
 * a `whmcs_client_id`; that broke the owner (a master_admin who is also a paying
 * customer), whose billing page 403'd into "Billing unavailable". This helper is
 * the single source of truth so the carve-out can't drift across routes.
 */
export function isUnlinkedStaff(
  role: string | null | undefined,
  whmcsClientId: number | null | undefined,
): boolean {
  return isStaffRole(role) && !whmcsClientId;
}
