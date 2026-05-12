export type GroupableUpdate = {
  id: string;
  serviceId: string;
  createdAt: string | Date;
};

export type ServiceUpdateGroup<T extends GroupableUpdate> = {
  key: string;
  serviceId: string;
  head: T;
  items: T[];
};

export const SERVICE_UPDATE_GROUP_WINDOW_MS = 30 * 60 * 1000;

/**
 * Collapse a list of service updates (assumed sorted newest-first) into
 * groups of consecutive same-service updates whose adjacent timestamps fall
 * within `windowMs` of each other.
 */
export function groupServiceUpdates<T extends GroupableUpdate>(
  updates: T[] | undefined,
  windowMs: number = SERVICE_UPDATE_GROUP_WINDOW_MS,
): ServiceUpdateGroup<T>[] {
  if (!updates || updates.length === 0) return [];
  const result: ServiceUpdateGroup<T>[] = [];
  for (const u of updates) {
    const last = result[result.length - 1];
    const prevItem = last?.items[last.items.length - 1];
    if (
      last &&
      prevItem &&
      last.serviceId === u.serviceId &&
      Math.abs(new Date(prevItem.createdAt).getTime() - new Date(u.createdAt).getTime()) <= windowMs
    ) {
      last.items.push(u);
    } else {
      result.push({ key: u.id, serviceId: u.serviceId, head: u, items: [u] });
    }
  }
  return result;
}
