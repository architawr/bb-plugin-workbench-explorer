/**
 * An in-app confirmation instead of window.confirm, which looks like the
 * operating system rather than BB. Callers await an answer; one host
 * component draws whichever request is pending.
 */
export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel: string;
}

interface Pending extends ConfirmRequest {
  resolve: (confirmed: boolean) => void;
}

let pending: Pending | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

export function requestConfirm(request: ConfirmRequest): Promise<boolean> {
  // A newer question replaces an unanswered one, which counts as declined.
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { ...request, resolve };
    emit();
  });
}

export function answerConfirm(confirmed: boolean): void {
  const current = pending;
  pending = null;
  current?.resolve(confirmed);
  emit();
}

export function getPendingConfirm(): ConfirmRequest | null {
  return pending;
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
