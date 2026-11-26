import { parseSseChunk, subscribeToJobEvents } from '@/api/sse';
import type { JobSseEvent } from '@/api/types';

/** UTF-8 bytes without depending on the environment exposing TextEncoder. */
function toBytes(text: string): Uint8Array {
  const out: number[] = [];
  for (const char of text) {
    const cp = char.codePointAt(0) ?? 0;
    if (cp < 0x80) {
      out.push(cp);
    } else if (cp < 0x800) {
      out.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
    } else if (cp < 0x10000) {
      out.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    } else {
      out.push(
        0xf0 | (cp >> 18),
        0x80 | ((cp >> 12) & 0x3f),
        0x80 | ((cp >> 6) & 0x3f),
        0x80 | (cp & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

/** A Response whose `body` behaves like a native ReadableStream (web / Node path). */
function streamingResponse(chunks: string[]): Response {
  let index = 0;
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: {
      getReader() {
        return {
          read: async () => {
            const chunk = chunks[index];
            index += 1;
            return chunk === undefined
              ? { done: true, value: undefined }
              : { done: false, value: toBytes(chunk) };
          },
          cancel: async () => undefined,
        };
      },
    },
    text: async () => chunks.join(''),
  } as unknown as Response;
}

/** A Response whose body is a real `ReadableStream<Uint8Array>` over raw byte slices. */
function byteStreamResponse(chunks: Uint8Array[]): Response {
  if (typeof ReadableStream === 'undefined') {
    throw new Error('ReadableStream is not available in this test environment');
  }
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    body: stream,
    text: async () => '',
  } as unknown as Response;
}

/** A Response with no readable body, like React Native's fetch and most mocks. */
function textResponse(text: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    body: null,
    text: async () => text,
  } as unknown as Response;
}

function frame(id: string, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const statusEvent = {
  job_id: 'job_1',
  status: 'running',
  previous_status: 'queued',
  updated_at: '2026-11-27T10:00:00Z',
};

const chapterReadyEvent = {
  chapter_id: 'ch01',
  chapter_index: 1,
  title: 'الفصل الأول',
  message_ar: 'الفصل الأول جاهز، ابدأ اقرا',
  chapter_url: '/v1/books/bk_1/bundle/chapters/ch01',
  manifest_url: '/v1/books/bk_1/bundle/manifest',
};

const completedEvent = {
  job_id: 'job_1',
  book_id: 'bk_1',
  manifest_url: '/v1/books/bk_1/bundle/manifest',
  book_md_url: '/v1/books/bk_1/bundle/book.md',
  chapters_count: 3,
  pages_processed: 120,
};

function lastCall(mock: jest.Mock): { url: string; init: RequestInit } {
  const call = mock.mock.calls[mock.mock.calls.length - 1] as [string, RequestInit];
  return { url: call[0], init: call[1] };
}

describe('parseSseChunk', () => {
  it('decodes complete frames and keeps the incomplete tail as remainder', () => {
    const buffer =
      'id: 1\nevent: job.status\ndata: {"job_id":"job_1"}\n\n' +
      ': keepalive\n\n' +
      'id: 2\nevent: chapter.ready\ndata: {"chapter_id":"ch01"}\n\n' +
      'data: {"job_id":"jo';

    const { events, remainder } = parseSseChunk(buffer);

    expect(events).toEqual([
      { id: '1', event: 'job.status', data: '{"job_id":"job_1"}' },
      { id: '2', event: 'chapter.ready', data: '{"chapter_id":"ch01"}' },
    ]);
    expect(remainder).toBe('data: {"job_id":"jo');
  });

  it('joins multi-line data with newlines and handles CRLF', () => {
    const { events, remainder } = parseSseChunk('event: note\r\ndata: first\r\ndata: second\r\n\r\n');

    expect(remainder).toBe('');
    expect(events).toEqual([{ event: 'note', data: 'first\nsecond' }]);
  });

  it('ignores comment-only heartbeats', () => {
    const { events } = parseSseChunk(': ping\n\n: ping\n\n');
    expect(events).toEqual([]);
  });

  it('returns an unchanged remainder when no frame is complete yet', () => {
    const partial = 'id: 9\nevent: heartbeat\ndata: {"ts":';
    const { events, remainder } = parseSseChunk(partial);
    expect(events).toEqual([]);
    expect(remainder).toBe(partial);
  });

  it('keeps Arabic payloads intact when a frame is split between calls', () => {
    const full = `id: 7\nevent: chapter.ready\ndata: ${JSON.stringify(chapterReadyEvent)}\n\n`;
    const splitAt = full.indexOf('الفصل') + 1;

    const first = parseSseChunk(full.slice(0, splitAt));
    expect(first.events).toEqual([]);

    const second = parseSseChunk(first.remainder + full.slice(splitAt));
    expect(second.events).toHaveLength(1);
    const parsed = JSON.parse(second.events[0]?.data ?? '{}') as { message_ar?: string };
    expect(parsed.message_ar).toBe(chapterReadyEvent.message_ar);
  });
});

describe('subscribeToJobEvents', () => {
  it('dispatches typed events from a text() fallback response and closes on job.completed', async () => {
    const body =
      frame('1', 'job.status', statusEvent) +
      frame('2', 'heartbeat', { ts: '2026-11-27T10:00:05Z' }) +
      frame('3', 'chapter.ready', chapterReadyEvent) +
      frame('4', 'job.completed', completedEvent);

    const fetchImpl = jest.fn().mockResolvedValue(textResponse(body));
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: (event) => received.push(event),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(lastCall(fetchImpl).url).toBe('https://api.test/v1/jobs/job_1/events');
    expect(result.closedByTerminalEvent).toBe(true);
    expect(result.lastEventId).toBe('4');
    expect(received.map((event) => event.event)).toEqual([
      'job.status',
      'heartbeat',
      'chapter.ready',
      'job.completed',
    ]);

    const chapterReady = received[2];
    expect(chapterReady?.event).toBe('chapter.ready');
    if (chapterReady?.event === 'chapter.ready') {
      expect(chapterReady.data.message_ar).toBe('الفصل الأول جاهز، ابدأ اقرا');
      expect(chapterReady.id).toBe('3');
    }
  });

  it('reads a streaming body chunk-by-chunk without breaking Arabic across chunk boundaries', async () => {
    const body =
      frame('1', 'chapter.ready', chapterReadyEvent) + frame('2', 'job.completed', completedEvent);
    const splitPoint = body.indexOf('جاهز') + 1;
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(streamingResponse([body.slice(0, splitPoint), body.slice(splitPoint)]));
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: (event) => received.push(event),
    });

    expect(result.closedByTerminalEvent).toBe(true);
    expect(received).toHaveLength(2);
    const first = received[0];
    if (first?.event === 'chapter.ready') {
      expect(first.data.title).toBe('الفصل الأول');
    } else {
      throw new Error('expected chapter.ready first');
    }
  });

  it('sends Authorization from the token provider', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(frame('1', 'job.completed', completedEvent)));

    await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      getAccessToken: async () => 'jwt-token',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: () => undefined,
    });

    const headers = lastCall(fetchImpl).init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer jwt-token');
    expect(headers.Accept).toBe('text/event-stream');
  });

  it('reconnects with Last-Event-ID after a stream that ended without a terminal event', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(textResponse(frame('5', 'page.progress', {
        job_id: 'job_1',
        current_page: 10,
        total_pages: 100,
        percent: 10,
        stage: 'ocr',
      })))
      .mockResolvedValueOnce(
        textResponse(frame('6', 'job.completed', completedEvent)),
      );
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: 0,
      onEvent: (event) => received.push(event),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.closedByTerminalEvent).toBe(true);
    expect(result.lastEventId).toBe('6');
    expect(received.map((event) => event.event)).toEqual(['page.progress', 'job.completed']);

    const secondHeaders = lastCall(fetchImpl).init.headers as Record<string, string>;
    expect(secondHeaders['Last-Event-ID']).toBe('5');
  });

  it('honours lastEventId supplied by the caller on the first connection', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(textResponse(frame('9', 'job.completed', completedEvent)));

    await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      lastEventId: '8',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: () => undefined,
    });

    const headers = lastCall(fetchImpl).init.headers as Record<string, string>;
    expect(headers['Last-Event-ID']).toBe('8');
  });

  it('closes cleanly on job.status cancelled', async () => {
    const body =
      frame('1', 'job.status', { ...statusEvent, status: 'cancelled' }) +
      frame('2', 'job.completed', completedEvent);
    const fetchImpl = jest.fn().mockResolvedValue(textResponse(body));
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: 0,
      onEvent: (event) => received.push(event),
    });

    expect(result.closedByTerminalEvent).toBe(true);
    expect(received).toHaveLength(1);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('surfaces a terminal JobError without reconnecting', async () => {
    const failed = {
      job_id: 'job_1',
      error: {
        code: 'PROVIDER_AUTH',
        message: 'provider rejected the key',
        message_ar: 'المفتاح غير صالح',
        retryable: false,
      },
    };
    const fetchImpl = jest.fn().mockResolvedValue(textResponse(frame('1', 'job.failed', failed)));
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: (event) => received.push(event),
    });

    expect(result.closedByTerminalEvent).toBe(true);
    const failure = received[0];
    if (failure?.event === 'job.failed') {
      expect(failure.data.error.code).toBe('PROVIDER_AUTH');
    } else {
      throw new Error('expected job.failed');
    }
  });

  it('does not fetch at all when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = jest.fn();

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      signal: controller.signal,
      onEvent: () => undefined,
    });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result).toEqual({ closedByTerminalEvent: false });
  });

  it('reports a non-retryable HTTP failure once and stops', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(textResponse('{"error":{}}', 404));
    const onError = jest.fn();

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: () => undefined,
      onError,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.closedByTerminalEvent).toBe(false);
  });

  it('gives up after 1 + maxReconnects fetches when the server keeps answering 200 with an empty body', async () => {
    const fetchImpl = jest.fn(async () => textResponse(''));
    const onError = jest.fn();

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnects: 1,
      retryDelayMs: 0,
      onEvent: () => undefined,
      onError,
    });

    // Initial connection + exactly one reconnect: a 200 OK must not refill the budget.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.closedByTerminalEvent).toBe(false);
  });

  it('gives up after 1 + maxReconnects fetches when every stream carries only non-terminal events', async () => {
    const progress = frame('1', 'page.progress', {
      job_id: 'job_1',
      current_page: 1,
      total_pages: 10,
      percent: 10,
      stage: 'ocr',
    });
    const fetchImpl = jest.fn(async () => textResponse(progress));
    const received: JobSseEvent[] = [];
    const onError = jest.fn();

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnects: 1,
      retryDelayMs: 0,
      onEvent: (event) => received.push(event),
      onError,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(result.closedByTerminalEvent).toBe(false);
    // The events that did arrive were still delivered.
    expect(received).toHaveLength(2);
  });

  it('stop dispatching the remaining events of a chunk once onEvent aborts', async () => {
    const body =
      frame('1', 'job.status', statusEvent) +
      frame('2', 'page.progress', {
        job_id: 'job_1',
        current_page: 2,
        total_pages: 10,
        percent: 20,
        stage: 'ocr',
      }) +
      frame('3', 'job.completed', completedEvent);
    const fetchImpl = jest.fn().mockResolvedValue(textResponse(body));
    const controller = new AbortController();
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: 0,
      signal: controller.signal,
      onEvent: (event) => {
        received.push(event);
        controller.abort();
      },
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(result.closedByTerminalEvent).toBe(false);
    expect(received.map((event) => event.event)).toEqual(['job.status']);
    // The id of the delivered frame is kept; the skipped frames never advanced it.
    expect(result.lastEventId).toBe('1');
  });

  it('does not advance Last-Event-ID for a frame whose JSON does not parse', async () => {
    const broken = 'id: 2\nevent: page.progress\ndata: {"current_page":\n\n';
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(textResponse(frame('1', 'job.status', statusEvent) + broken))
      .mockResolvedValueOnce(textResponse(frame('3', 'job.completed', completedEvent)));
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryDelayMs: 0,
      onEvent: (event) => received.push(event),
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const secondHeaders = lastCall(fetchImpl).init.headers as Record<string, string>;
    // Frame 2 was skipped, so the resume point is still the last *dispatched* frame.
    expect(secondHeaders['Last-Event-ID']).toBe('1');
    expect(result.lastEventId).toBe('3');
  });

  it('sanitises a transport error so the access token never reaches onError', async () => {
    const token = 'jwt.secret.token-value';
    const fetchImpl = jest
      .fn()
      .mockRejectedValue(new Error(`socket hang up while sending Bearer ${token}`));
    const onError = jest.fn();

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      getAccessToken: async () => token,
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxReconnects: 1,
      retryDelayMs: 0,
      onEvent: () => undefined,
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1);
    const reported = onError.mock.calls[0]?.[0] as Error;
    expect(reported).toBeInstanceOf(Error);
    expect(reported.message).not.toContain(token);
    expect(reported.message).toContain('تعذّر الاتصال ببث التقدّم');
    expect(result.closedByTerminalEvent).toBe(false);
  });

  it('decodes an Arabic frame split in the middle of a multi-byte character', async () => {
    const body =
      frame('1', 'chapter.ready', chapterReadyEvent) +
      frame('2', 'job.completed', completedEvent);
    const bytes = new TextEncoder().encode(body);

    // Split inside a multi-byte character: `bytes[splitAt]` is a UTF-8 continuation byte,
    // so the first chunk ends in the middle of a code point.
    let splitAt = -1;
    for (let index = 1; index < bytes.length; index += 1) {
      const byte = bytes[index] ?? 0;
      if ((byte & 0xc0) === 0x80 && (bytes[index - 1] ?? 0) >= 0xc0) {
        splitAt = index;
        break;
      }
    }
    expect(splitAt).toBeGreaterThan(0);
    // The split must really cut a multi-byte character in half.
    expect((bytes[splitAt] ?? 0) & 0xc0).toBe(0x80);

    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        byteStreamResponse([bytes.slice(0, splitAt), bytes.slice(splitAt)]),
      );
    const received: JobSseEvent[] = [];

    const result = await subscribeToJobEvents({
      baseUrl: 'https://api.test',
      jobId: 'job_1',
      fetchImpl: fetchImpl as unknown as typeof fetch,
      onEvent: (event) => received.push(event),
    });

    expect(result.closedByTerminalEvent).toBe(true);
    expect(received).toHaveLength(2);
    const first = received[0];
    if (first?.event !== 'chapter.ready') throw new Error('expected chapter.ready first');
    // Byte-exact: no replacement character, no mojibake.
    expect(first.data.title).toBe('الفصل الأول');
    expect(first.data.message_ar).toBe('الفصل الأول جاهز، ابدأ اقرا');
    expect(JSON.stringify(received)).not.toContain('\uFFFD');
  });
});
