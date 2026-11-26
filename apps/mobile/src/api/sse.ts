import type { JobSseEvent } from './types';

/** One decoded SSE frame, before its `data:` JSON is parsed. */
export interface RawSseEvent {
  id?: string;
  event: string;
  data: string;
}

export interface ParseSseChunkResult {
  events: RawSseEvent[];
  /** Bytes after the last complete frame; prepend them to the next chunk. */
  remainder: string;
}

/** A blank line ends a frame; accept LF, CRLF and bare CR (proxies vary). */
const FRAME_SEPARATOR = /\r\n\r\n|\n\n|\r\r/;

function parseFrame(frame: string): RawSseEvent | null {
  const lines = frame.split(/\r\n|\n|\r/);
  let id: string | undefined;
  let event = '';
  const dataLines: string[] = [];

  for (const line of lines) {
    if (!line) continue;
    // `:` prefixed lines are comments/heartbeats from the server; ignore them entirely.
    if (line.startsWith(':')) continue;

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);

    switch (field) {
      case 'id':
        if (!value.includes('\0')) id = value;
        break;
      case 'event':
        event = value;
        break;
      case 'data':
        dataLines.push(value);
        break;
      default:
        break;
    }
  }

  const data = dataLines.join('\n');
  // Keep frames that carry an id (so Last-Event-ID advances) or a payload.
  if (!id && !data && !event) return null;
  if (!event && !data) return null;

  return {
    ...(id === undefined ? {} : { id }),
    event: event || 'message',
    data,
  };
}

/**
 * Incrementally decode an SSE byte buffer into complete frames.
 *
 * The remainder is returned untouched so the caller can prepend it to the next chunk; this is
 * what makes a UTF-8 Arabic payload split across two chunks decode correctly.
 */
export function parseSseChunk(buffer: string): ParseSseChunkResult {
  const events: RawSseEvent[] = [];
  let remainder = buffer;

  for (;;) {
    const match = FRAME_SEPARATOR.exec(remainder);
    if (!match || match.index === undefined) break;

    const frame = remainder.slice(0, match.index);
    remainder = remainder.slice(match.index + match[0].length);
    const parsed = parseFrame(frame);
    if (parsed) events.push(parsed);
  }

  return { events, remainder };
}

export interface SubscribeJobEventsOptions {
  baseUrl: string;
  jobId: string;
  getAccessToken?: () => string | null | Promise<string | null>;
  fetchImpl?: typeof fetch;
  lastEventId?: string;
  signal?: AbortSignal;
  maxReconnects?: number;
  retryDelayMs?: number;
  onEvent: (event: JobSseEvent) => void;
  onError?: (error: Error) => void;
}

export interface SubscribeJobEventsResult {
  lastEventId?: string;
  closedByTerminalEvent: boolean;
}

const KNOWN_EVENTS = new Set<string>([
  'job.status',
  'job.stage',
  'page.progress',
  'chapter.ready',
  'budget.mode_changed',
  'job.queued',
  'job.completed',
  'job.failed',
  'heartbeat',
]);

function isTerminalEvent(event: string, data: unknown): boolean {
  if (event === 'job.completed' || event === 'job.failed') return true;
  if (event === 'job.status') {
    const status = (data as { status?: unknown } | null)?.status;
    return status === 'cancelled';
  }
  return false;
}

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(finish, ms);
    function finish(): void {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', finish);
      resolve();
    }
    signal?.addEventListener?.('abort', finish);
  });
}

function decodeUtf8(bytes: Uint8Array): string {
  let out = '';
  let index = 0;
  while (index < bytes.length) {
    const first = bytes[index] ?? 0;
    index += 1;
    if (first < 0x80) {
      out += String.fromCharCode(first);
      continue;
    }

    let extra = 0;
    let codePoint = 0;
    if ((first & 0xe0) === 0xc0) {
      extra = 1;
      codePoint = first & 0x1f;
    } else if ((first & 0xf0) === 0xe0) {
      extra = 2;
      codePoint = first & 0x0f;
    } else if ((first & 0xf8) === 0xf0) {
      extra = 3;
      codePoint = first & 0x07;
    } else {
      continue; // Invalid leading byte: drop it rather than corrupt the following text.
    }
    if (index + extra > bytes.length) break;
    for (let offset = 0; offset < extra; offset += 1) {
      codePoint = (codePoint << 6) | ((bytes[index + offset] ?? 0) & 0x3f);
    }
    index += extra;
    out += String.fromCodePoint(codePoint);
  }
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** Safe, user-facing text for a transport failure. Raw fetch/stream text is never forwarded. */
const TRANSPORT_ERROR_MESSAGE = 'تعذّر الاتصال ببث التقدّم';

function safeTransportError(status?: number): Error {
  return new Error(status === undefined ? TRANSPORT_ERROR_MESSAGE : `${TRANSPORT_ERROR_MESSAGE} (${status})`);
}

/**
 * Follow `GET /v1/jobs/{jobId}/events`.
 *
 * Streams through `response.body.getReader()` when the runtime provides it (web, Node 18+), and
 * falls back to a single `response.text()` pass otherwise — React Native's fetch and Jest mock
 * responses commonly have no readable `body`. Reconnects honour `Last-Event-ID`, and the promise
 * resolves without reconnecting once a terminal event arrives or the caller aborts.
 *
 * `maxReconnects` is a hard budget for the whole subscription: `1 + maxReconnects` fetches at
 * most. A `200 OK` whose stream closes before a terminal event consumes one reconnect exactly
 * like a network failure does — otherwise a proxy answering an empty `200` would spin forever.
 */
export async function subscribeToJobEvents(
  options: SubscribeJobEventsOptions,
): Promise<SubscribeJobEventsResult> {
  const {
    baseUrl,
    jobId,
    getAccessToken,
    fetchImpl,
    signal,
    onEvent,
    onError,
    maxReconnects = 3,
    retryDelayMs = 1000,
  } = options;

  const doFetch = fetchImpl ?? fetch;
  const url = `${baseUrl.replace(/\/+$/, '')}/v1/jobs/${encodeURIComponent(jobId)}/events`;

  let lastEventId = options.lastEventId;
  let reconnects = 0;
  let terminal = false;

  while (!signal?.aborted) {
    const headers: Record<string, string> = {
      Accept: 'text/event-stream',
      'Cache-Control': 'no-cache',
    };
    if (getAccessToken) {
      const token = await getAccessToken();
      if (token) headers.Authorization = `Bearer ${token}`;
    }
    if (lastEventId) headers['Last-Event-ID'] = lastEventId;

    let response: Response;
    try {
      response = await doFetch(url, { method: 'GET', headers, ...(signal ? { signal } : {}) });
    } catch {
      if (signal?.aborted) break;
      // The raw error text may echo the request (and therefore the token) — never forward it.
      if (reconnects >= maxReconnects) {
        onError?.(safeTransportError());
        break;
      }
      reconnects += 1;
      await wait(retryDelayMs, signal);
      continue;
    }

    if (!response.ok) {
      const status = response.status;
      const retryable = status === 429 || status >= 500;
      const err = safeTransportError(status);
      if (!retryable || reconnects >= maxReconnects) {
        onError?.(err);
        break;
      }
      reconnects += 1;
      await wait(retryDelayMs, signal);
      continue;
    }

    let buffer = '';

    const dispatch = (text: string): boolean => {
      buffer += text;
      const { events, remainder } = parseSseChunk(buffer);
      buffer = remainder;

      for (const raw of events) {
        // An `onEvent` handler may abort mid-chunk: stop before the next frame is delivered
        // and before `Last-Event-ID` moves past an event the caller never saw.
        if (signal?.aborted) return false;
        if (!raw.data) continue;
        if (!KNOWN_EVENTS.has(raw.event)) continue;

        let payload: unknown;
        try {
          payload = JSON.parse(raw.data);
        } catch {
          // A malformed frame is skipped rather than killing a long-lived stream, and its id
          // is not consumed: a reconnect replays it instead of silently skipping it.
          continue;
        }

        onEvent({ event: raw.event, ...(raw.id === undefined ? {} : { id: raw.id }), data: payload } as JobSseEvent);
        // Only a dispatched frame advances the resume point.
        if (raw.id !== undefined) lastEventId = raw.id;
        if (isTerminalEvent(raw.event, payload)) return true;
      }
      return false;
    };

    try {
      const body = (response as unknown as { body?: ReadableStream<Uint8Array> | null }).body;
      if (body && typeof (body as ReadableStream<Uint8Array>).getReader === 'function') {
        const reader = body.getReader();
        const decoder = typeof TextDecoder === 'undefined' ? null : new TextDecoder('utf-8');
        // Hermes without TextDecoder accumulates bytes and decodes once at the end.
        const pendingParts: Uint8Array[] = [];
        for (;;) {
          if (signal?.aborted) break;
          const { done, value } = await reader.read();
          if (done) break;
          if (!value) continue;
          const text = decoder ? decoder.decode(value, { stream: true }) : '';
          if (!decoder) pendingParts.push(value);
          if (decoder && dispatch(text)) {
            terminal = true;
            break;
          }
        }
        if (!terminal) {
          const tail = decoder ? decoder.decode() : decodeUtf8(concatBytes(pendingParts));
          if (tail && dispatch(tail)) terminal = true;
        }
        if (terminal) {
          try {
            await reader.cancel();
          } catch {
            // The stream may already be closed; nothing to clean up.
          }
        }
      } else {
        const text = await response.text();
        if (dispatch(text)) terminal = true;
      }
    } catch {
      if (signal?.aborted) break;
      if (terminal) break;
      if (reconnects >= maxReconnects) {
        onError?.(safeTransportError());
        break;
      }
      reconnects += 1;
      await wait(retryDelayMs, signal);
      continue;
    }

    if (terminal) break;
    if (signal?.aborted) break;

    // The stream ended without a terminal event (empty body, proxy cut-off, partial events):
    // resume from Last-Event-ID, but always spend one reconnect from the budget.
    if (reconnects >= maxReconnects) {
      onError?.(new Error('انتهى بث التقدّم قبل اكتمال المهمة'));
      break;
    }
    reconnects += 1;
    await wait(retryDelayMs, signal);
  }

  return { ...(lastEventId === undefined ? {} : { lastEventId }), closedByTerminalEvent: terminal };
}

/** Type guard for callers that only care about one event kind. */
export function isJobSseEvent<E extends JobSseEvent['event']>(
  event: JobSseEvent,
  name: E,
): event is Extract<JobSseEvent, { event: E }> {
  return event.event === name;
}
