const listeners = new Set<() => void>();

export function requestTrackingSync() {
  for (const listener of listeners) listener();
}

export function onTrackingSync(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
