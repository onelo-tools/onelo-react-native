/**
 * Delivery reliability for OneloMonitor (@onelo/react-native).
 *
 * Regression cover for the bug where flush() spliced the buffer BEFORE the send,
 * never checked the response status, and swallowed everything in a bare catch —
 * so a live 503 from /api/sdk/monitor/events/batch silently destroyed a batch.
 *
 * Policy under test: ONE attempt per flush. 2xx → settled. 429 / 5xx / network
 * → the batch goes back in the buffer and the next 15s tick carries it (the
 * flush timer IS the retry, so an outage never multiplies request volume).
 * 4xx other than 429 → dropped loudly, since retrying is futile.
 *
 * With no in-flight backoff there is no longer any suspended-timer hazard on RN:
 * a drain is one request, so a backgrounded app has nothing pending to wedge the
 * flush chain or double-fire on resume.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OneloMonitor } from './monitor'

const API = 'https://api.example.test'
const KEY = 'pk_test'
const MAX_BUFFER_SIZE = 200

const res = (status: number, headers: Record<string, string> = {}): Response =>
  ({ status, headers: { get: (k: string) => headers[k] ?? null } }) as unknown as Response

const bufLen = (m: OneloMonitor): number =>
  (m as unknown as { buffer: unknown[] }).buffer.length

let fetchMock: ReturnType<typeof vi.fn>
let monitor: OneloMonitor

beforeEach(async () => {
  // Warm the send path's async dependencies BEFORE fake timers. It does
  // `await (await import('../sdk-headers')).sdkHeaders(...)`, and BOTH the cold
  // module load and the first `sdkHeaders()` call (Keychain-backed instance id,
  // memoized after) need the real event loop — under fake timers they'd never
  // resolve and no fetch would ever be issued.
  await (await import('../sdk-headers')).sdkHeaders()
  vi.useFakeTimers()
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  monitor = new OneloMonitor(KEY, API)
  // Strip the auto-emitted `session_opened` event (fired unconditionally at
  // construction) so these buffer-length assertions see only test-pushed events.
  ;(monitor as unknown as { buffer: unknown[] }).buffer.length = 0
})

afterEach(async () => {
  fetchMock.mockResolvedValue(res(204))
  monitor.destroy()
  await vi.advanceTimersByTimeAsync(1)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * Run a flush to completion. There is no backoff to advance through any more —
 * a drain is one request — so this deliberately does NOT move the clock: doing
 * so would let the monitor's own periodic 15s flush fire and make request counts
 * non-deterministic (which is exactly what the volume test asserts on).
 */
async function flushAll(m: OneloMonitor): Promise<void> {
  await m.flush()
}

describe('OneloMonitor delivery — retry classification', () => {
  it('does not swallow a 503 — one attempt, then the NEXT flush delivers it', async () => {
    fetchMock.mockResolvedValueOnce(res(503))
    monitor.event('checkout', { ok: true })

    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1) // exactly one — no in-flight loop
    expect(bufLen(monitor)).toBe(1)            // and the event survived

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(bufLen(monitor)).toBe(0)
  })

  // The load property that motivated dropping the retry loop: an outage must
  // cost the backend the SAME number of requests as healthy operation. On mobile
  // this is also the user's battery and data plan.
  it('never multiplies request volume during an outage — 1 request per flush', async () => {
    fetchMock.mockResolvedValue(res(503))
    monitor.event('checkout', { ok: true })

    for (let i = 0; i < 5; i++) await flushAll(monitor)

    expect(fetchMock).toHaveBeenCalledTimes(5) // 5 flushes → 5 requests, not 15
  })

  it('re-queues the batch on a 503 (nothing is lost)', async () => {
    fetchMock.mockResolvedValue(res(503))
    monitor.event('checkout', { ok: true })
    monitor.event('ai-response', { ok: true })

    await flushAll(monitor)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bufLen(monitor)).toBe(2) // both events back in the buffer

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)
    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    expect(body.events.map((e: { featureName: string }) => e.featureName)).toEqual(['checkout', 'ai-response'])
    expect(bufLen(monitor)).toBe(0)
  })

  it('re-queues on a network throw (the common mobile case), next flush delivers', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Network request failed'))
    monitor.event('checkout', { ok: true })

    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bufLen(monitor)).toBe(1)

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)
    expect(bufLen(monitor)).toBe(0)
  })

  it('does NOT retry a 401', async () => {
    fetchMock.mockResolvedValue(res(401))
    monitor.event('checkout', { ok: true })
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('does NOT retry a 400 — retrying a rejected payload cannot help', async () => {
    fetchMock.mockResolvedValue(res(400))
    monitor.event('checkout', { ok: true })

    await flushAll(monitor)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(bufLen(monitor)).toBe(0) // dropped deliberately, not re-queued forever
  })

  it('does NOT retry a 429, and holds off subsequent flushes for Retry-After', async () => {
    fetchMock.mockResolvedValueOnce(res(429, { 'Retry-After': '60' }))
    monitor.event('checkout', { ok: true })
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValue(res(204))
    monitor.event('later', { ok: true })
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1) // held off — no network hit

    vi.setSystemTime(Date.now() + 61_000)
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  // REGRESSION: a 429 used to classify as `done`, so `_drain` skipped `_requeue`
  // and the batch — already spliced out of the buffer — was destroyed. The test
  // above passes either way, because it only counts calls. THIS one asserts on
  // the payload: the events the hold-off exists to protect must survive it.
  it('re-queues the 429ed batch — the events are NOT lost', async () => {
    fetchMock.mockResolvedValueOnce(res(429, { 'Retry-After': '60' }))
    monitor.event('checkout', { ok: false, error: 'boom' })
    await flushAll(monitor)

    // Still buffered: the server explicitly did not accept it.
    expect(bufLen(monitor)).toBe(1)

    // After the hold-off it is actually delivered, with its payload intact.
    fetchMock.mockResolvedValue(res(204))
    vi.setSystemTime(Date.now() + 61_000)
    await flushAll(monitor)

    const sent = JSON.parse(fetchMock.mock.calls.at(-1)![1].body as string)
    expect(sent.events).toHaveLength(1)
    expect(sent.events[0].featureName).toBe('checkout')
    expect(bufLen(monitor)).toBe(0)
  })

})

describe('OneloMonitor delivery — bounded memory under a sustained outage', () => {
  it('never grows past the buffer cap while the device is offline', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'))

    for (let round = 0; round < 5; round++) {
      for (let i = 0; i < 100; i++) monitor.event(`evt-${round}-${i}`, { ok: true })
      await flushAll(monitor)
      expect(bufLen(monitor)).toBeLessThanOrEqual(MAX_BUFFER_SIZE)
    }
    expect(bufLen(monitor)).toBe(MAX_BUFFER_SIZE)
  })

  it('drops the OLDEST events first — newest telemetry wins, and drops are reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fetchMock.mockResolvedValue(res(503))

    for (let i = 0; i < MAX_BUFFER_SIZE; i++) monitor.event(`old-${i}`, { ok: true })
    await flushAll(monitor)
    for (let i = 0; i < 10; i++) monitor.event(`new-${i}`, { ok: true })

    expect(bufLen(monitor)).toBe(MAX_BUFFER_SIZE)
    const names = (monitor as unknown as { buffer: Array<{ featureName: string }> }).buffer
      .map((e) => e.featureName)
    expect(names).not.toContain('old-0')
    expect(names.at(-1)).toBe('new-9')
    expect(warn).toHaveBeenCalled()
  })
})

describe('OneloMonitor delivery — teardown', () => {
  it('destroy() delivers one last batch and then sends nothing more', async () => {
    fetchMock.mockResolvedValue(res(204))
    monitor.event('checkout', { ok: true })

    monitor.destroy()
    await vi.advanceTimersByTimeAsync(1)
    expect(fetchMock).toHaveBeenCalledTimes(1) // the final flush went out
    expect(bufLen(monitor)).toBe(0)

    // Anything pushed after teardown must not reach the wire.
    monitor.event('after-teardown', { ok: false, error: 'boom' })
    await flushAll(monitor)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('destroy() preserves an undelivered batch instead of dropping it', async () => {
    fetchMock.mockResolvedValue(res(503))
    monitor.event('checkout', { ok: true })

    monitor.destroy()
    await vi.advanceTimersByTimeAsync(1)

    expect(bufLen(monitor)).toBeGreaterThan(0) // preserved, not silently dropped
  })
})

describe('OneloMonitor delivery — event time survives a delay', () => {
  it('stamps ts when the event happens, not when the batch is finally sent', async () => {
    // A batch that waits out an outage must still report WHEN it happened —
    // otherwise the dashboard attributes an outage's errors to the recovery.
    fetchMock.mockResolvedValueOnce(res(503))
    monitor.event('checkout', { ok: false, error: 'boom' })
    await flushAll(monitor)

    const happenedAt = Date.now()
    vi.setSystemTime(happenedAt + 10 * 60_000) // 10 minutes later

    fetchMock.mockResolvedValue(res(204))
    await flushAll(monitor)

    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    const sentTs = Date.parse(body.events[0].ts)
    expect(sentTs).toBeLessThanOrEqual(happenedAt)
    expect(new Date(sentTs).toISOString()).toBe(body.events[0].ts) // ISO-8601 UTC
  })

  it('stamps ts on the feature_call_summary drain path too', async () => {
    fetchMock.mockResolvedValue(res(204))
    ;(monitor as unknown as { _trackFeatureCall: (n: string) => void })._trackFeatureCall('dark-mode')

    await flushAll(monitor)

    const body = JSON.parse((fetchMock.mock.calls.at(-1)![1] as RequestInit).body as string)
    const summary = body.events.find((e: { source: string }) => e.source === 'feature_call_summary')
    expect(summary).toBeDefined()
    expect(new Date(Date.parse(summary.ts)).toISOString()).toBe(summary.ts)
  })
})
