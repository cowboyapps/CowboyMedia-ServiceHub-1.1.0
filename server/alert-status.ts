// Route-level orchestration for keeping service statuses in sync after an alert
// mutation. A service's `status` is derived from the most-severe active alert
// covering it (see `storage.recomputeServiceStatus`). Every alert route that
// changes which alerts cover which services must (1) recompute each affected
// service and (2) broadcast a `service_updated` event so connected clients
// refresh. That orchestration used to be duplicated inline across the create,
// edit, add-update, resolve, and delete routes; a future edit to any one path
// could silently drop the recompute/broadcast. Centralising it here keeps the
// per-path "which services are affected" logic in one testable place.

export interface AlertStatusDeps {
  // Recompute and persist a single service's derived status.
  recompute: (serviceId: string) => Promise<unknown> | unknown;
  // Notify connected clients that a service's status may have changed.
  broadcast: (message: { type: "service_updated"; serviceId: string }) => void;
}

// Dedupe the given service ids, recompute each, and broadcast a `service_updated`
// event for each. Returns the unique ids that were processed (handy for tests
// and callers that want to know exactly what was touched).
async function applyRecompute(
  serviceIds: string[],
  deps: AlertStatusDeps,
): Promise<string[]> {
  const unique = Array.from(new Set(serviceIds.filter(Boolean)));
  for (const serviceId of unique) {
    await deps.recompute(serviceId);
    deps.broadcast({ type: "service_updated", serviceId });
  }
  return unique;
}

// create / add-update / resolve / delete: recompute exactly the services the
// alert covers. For delete, the caller must capture the covered ids BEFORE the
// alert (and its junction rows) are removed.
export function recomputeForCoveredServices(
  serviceIds: string[],
  deps: AlertStatusDeps,
): Promise<string[]> {
  return applyRecompute(serviceIds, deps);
}

// edit: a service can be added to or removed from an alert, so recompute the
// union of the previously- and newly-covered ids. Without the previous ids, a
// service dropped from the alert would keep a stale non-operational status.
export function recomputeForServiceChange(
  previousServiceIds: string[],
  newServiceIds: string[],
  deps: AlertStatusDeps,
): Promise<string[]> {
  return applyRecompute(previousServiceIds.concat(newServiceIds), deps);
}
