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
