import type { RNToWebMessage, WebToRNMessage } from './types.js';

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (data: string) => void;
    };
  }
}

const VALID_INCOMING_TYPES = new Set([
  'load',
  'settings',
  'fonts',
  'goto',
  'next',
  'prev',
  'suppress-taps',
  'highlights',
  'clear-selection',
  'scene-placeholders',
  'scene-update',
  'scene-display-mode',
]);

/**
 * Send a structured bridge message to React Native WebView, falling back to
 * window.parent.postMessage for browser development harnesses.
 */
export function postToHost(message: WebToRNMessage): void {
  const payload = JSON.stringify(message);
  if (window.ReactNativeWebView?.postMessage) {
    window.ReactNativeWebView.postMessage(payload);
    return;
  }
  if (window.parent && window.parent !== window) {
    window.parent.postMessage(payload, '*');
  }
}

/**
 * Subscribe to incoming bridge messages from React Native WebView or parent window.
 */
export function subscribeHostMessages(
  onMessage: (msg: RNToWebMessage) => void,
  onError: (errMsg: string) => void,
): () => void {
  const handleEvent = (event: Event) => {
    const rawData = (event as MessageEvent).data;
    if (rawData === undefined || rawData === null) return;

    let parsed: unknown = rawData;
    if (typeof rawData === 'string') {
      const trimmed = rawData.trim();
      if (!trimmed.startsWith('{')) return;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        onError(`Invalid bridge JSON: ${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }

    if (!parsed || typeof parsed !== 'object') return;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.type !== 'string' || !VALID_INCOMING_TYPES.has(candidate.type)) {
      return;
    }

    try {
      onMessage(candidate as RNToWebMessage);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  window.addEventListener('message', handleEvent);
  document.addEventListener('message', handleEvent);

  return () => {
    window.removeEventListener('message', handleEvent);
    document.removeEventListener('message', handleEvent);
  };
}
