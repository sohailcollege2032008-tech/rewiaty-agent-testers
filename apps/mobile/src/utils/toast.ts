export type ToastPayload = {
  id: number;
  message: string;
};

type ToastListener = (toast: ToastPayload | null) => void;

const listeners = new Set<ToastListener>();
let nextToastId = 1;
let currentToast: ToastPayload | null = null;
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

const DEFAULT_TOAST_DURATION_MS = 2600;

/** Broadcast a short non-blocking toast message to the root overlay. */
export function showToast(message: string, durationMs = DEFAULT_TOAST_DURATION_MS): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  const payload: ToastPayload = { id: nextToastId++, message };
  currentToast = payload;
  for (const listener of listeners) {
    listener(payload);
  }
  if (durationMs > 0) {
    dismissTimer = setTimeout(() => {
      dismissTimer = null;
      if (currentToast?.id === payload.id) {
        currentToast = null;
        for (const listener of listeners) {
          listener(null);
        }
      }
    }, durationMs);
  }
}

export function clearToast(): void {
  if (dismissTimer !== null) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  currentToast = null;
  for (const listener of listeners) {
    listener(null);
  }
}

export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  if (currentToast) {
    listener(currentToast);
  }
  return () => {
    listeners.delete(listener);
  };
}
