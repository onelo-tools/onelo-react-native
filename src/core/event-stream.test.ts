/**
 * Tests for OneloEventStream (event-stream.ts) — the XMLHttpRequest-driven SSE
 * client. We mock global XMLHttpRequest with a controllable fake so we can drive
 * responseText incrementally (per TCP packet) and assert:
 *   (a) handlers fire on each complete event (dispatch on the blank line, not before)
 *   (b) start({userId:null}) after start({userId:'u1'}) is a no-op (downgrade refusal)
 *   (c) stop() prevents any reconnect
 *
 * instance-id + sdk-headers are mocked so _openXhr's async prelude resolves fast
 * and deterministically (no native modules, no crypto timing).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./instance-id', () => ({ getInstanceId: vi.fn().mockResolvedValue('iid-abc') }))
vi.mock('../sdk-headers', () => ({ sdkHeaders: vi.fn().mockResolvedValue({ 'X-SDK-Version': '9.9.9' }) }))

// ── Controllable fake XMLHttpRequest ──────────────────────────────────────────
class FakeXHR {
  static instances: FakeXHR[] = []
  readyState = 0
  status = 0
  responseText = ''
  method = ''
  url = ''
  headers: Record<string, string> = {}
  aborted = false

  onprogress: (() => void) | null = null
  onreadystatechange: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null

  open(method: string, url: string): void {
    this.method = method
    this.url = url
    this.readyState = 1
  }
  setRequestHeader(k: string, v: string): void { this.headers[k] = v }
  send(): void { FakeXHR.instances.push(this) }
  abort(): void { this.aborted = true }

  // ── test drivers ──
  emitHeaders(status: number): void {
    this.status = status
    this.readyState = 2 // HEADERS_RECEIVED
    this.onreadystatechange?.()
  }
  /** Set the cumulative responseText and fire an onprogress (readyState LOADING). */
  emitProgress(cumulativeText: string): void {
    this.readyState = 3 // LOADING
    this.responseText = cumulativeText
    this.onprogress?.()
  }
  emitDone(): void {
    this.readyState = 4 // DONE
    this.onreadystatechange?.()
  }
}

const flushMicrotasks = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

import { OneloEventStream } from './event-stream'

let originalXHR: unknown

beforeEach(() => {
  FakeXHR.instances = []
  originalXHR = (globalThis as Record<string, unknown>).XMLHttpRequest
  ;(globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR as unknown
})

afterEach(() => {
  ;(globalThis as Record<string, unknown>).XMLHttpRequest = originalXHR
  vi.useRealTimers()
})

function newStream(): OneloEventStream {
  return new OneloEventStream('https://api.test', 'pk_test', '9.9.9', 'com.example.app')
}

describe('OneloEventStream — incremental (per-packet) parse', () => {
  it('dispatches a handler only once the blank line arrives, then once per complete event', async () => {
    const stream = newStream()
    const handler = vi.fn()
    stream.on('features_updated', handler)

    stream.start({ userId: 'u1' })
    await flushMicrotasks()

    const xhr = FakeXHR.instances[0]
    expect(xhr).toBeDefined()
    xhr.emitHeaders(200)

    // Event body arrives WITHOUT the terminating blank line → no dispatch yet.
    xhr.emitProgress('event: features_updated\ndata: {"v":1}\n')
    expect(handler).not.toHaveBeenCalled()

    // The blank line (second \n) completes the event → dispatch.
    xhr.emitProgress('event: features_updated\ndata: {"v":1}\n\n')
    expect(handler).toHaveBeenCalledTimes(1)
    expect(handler).toHaveBeenCalledWith({ v: 1 })

    // A second complete event, appended to the same cumulative responseText.
    xhr.emitProgress('event: features_updated\ndata: {"v":1}\n\nevent: features_updated\ndata: {"v":2}\n\n')
    expect(handler).toHaveBeenCalledTimes(2)
    expect(handler).toHaveBeenLastCalledWith({ v: 2 })

    // The query string carries the bound identity.
    expect(xhr.url).toContain('userId=u1')
    expect(xhr.url).toContain('instance_id=iid-abc')
    expect(xhr.url).toContain('key=pk_test')

    stream.stop()
  })

  it('ignores :keepalive comments but records liveness', async () => {
    const stream = newStream()
    const handler = vi.fn()
    stream.on('ping', handler)

    stream.start({ userId: 'u1' })
    await flushMicrotasks()
    const xhr = FakeXHR.instances[0]
    xhr.emitHeaders(200)

    xhr.emitProgress(':keepalive\n\n')
    expect(handler).not.toHaveBeenCalled()
    expect(stream.lastEventReceived).not.toBeNull()

    stream.stop()
  })
})

describe('OneloEventStream — downgrade refusal', () => {
  it('start({userId:null}) after start({userId:"u1"}) is a no-op (no new connection)', async () => {
    const stream = newStream()
    stream.start({ userId: 'u1' })
    await flushMicrotasks()
    expect(FakeXHR.instances.length).toBe(1)
    expect(FakeXHR.instances[0].url).toContain('userId=u1')

    // Anonymous reload while bound must NOT evict the user-bound stream.
    stream.start({ userId: null })
    await flushMicrotasks()
    expect(FakeXHR.instances.length).toBe(1) // still the original, no reconnect

    stream.stop()
  })
})

describe('OneloEventStream — stop() prevents reconnect', () => {
  it('a server close followed by stop() schedules no reconnect', async () => {
    vi.useFakeTimers()
    const stream = newStream()
    stream.start({ userId: 'u1' })
    await flushMicrotasks()
    const xhr = FakeXHR.instances[0]
    expect(xhr).toBeDefined()
    xhr.emitHeaders(200)

    // Server closes the stream → this would normally schedule a reconnect.
    xhr.emitDone()
    // Tear down before the backoff timer fires.
    stream.stop()

    // Advance past every backoff tier — no new connection must be opened.
    await vi.advanceTimersByTimeAsync(60_000)
    await flushMicrotasks()
    expect(FakeXHR.instances.length).toBe(1)
  })
})
