// Tiny cross-component signal so the custom PWA install banner and the
// customer SetupReminder dialog never appear at the same time. The reminder is
// a modal (Radix Dialog with an overlay); the install banner is a non-modal
// bottom bar. Without coordination the banner would sit dimmed behind the
// reminder's overlay, which reads as two stacked popups. The reminder owns the
// "is open" bit and the banner subscribes to it via useSyncExternalStore.

let setupReminderOpen = false;
const listeners = new Set<() => void>();

export function setSetupReminderOpen(next: boolean): void {
  if (setupReminderOpen === next) return;
  setupReminderOpen = next;
  for (const listener of listeners) listener();
}

export function getSetupReminderOpen(): boolean {
  return setupReminderOpen;
}

export function subscribeSetupReminder(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
