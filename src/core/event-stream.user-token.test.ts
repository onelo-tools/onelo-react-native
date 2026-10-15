/**
 * #518: the RN Event Stream proves the signed-in user with
 * `Authorization: Bearer <access token>` on the stream request, read fresh on
 * EVERY (re)connect. A refused token (`401 invalid_user_token`) is refreshed
 * and retried once; refused again, that connection is opened anonymous (no
 * Bearer, no userId) — and the next connection tries the user again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('./instance-id', () => ({ getInstanceId: vi.fn().mockResolvedValue('iid-abc') }))
vi.mock('../sdk-headers', () => ({ sdkHeaders: vi.fn().mockResolvedValue({ 'X-SDK-Version': '9.9.9' }) }))

class FakeXHR {
  static instances: FakeXHR[] = []
  readyState = 0
  status = 0
  responseText = ''
  url = ''
  headers: Record<string, string> = {}
  aborted = false
  onprogress: (() => void) | null = null
  onreadystatechange: (() => void) | null = null
  onerror: (() => void) | null = null
  ontimeout: (() => void) | null = null
  onabort: (() => void) | null = null
  open(_m: string, url: string): void { this.url = url; this.readyState = 1 }
  setRequestHeader(k: string, v: string): void { this.headers[k] = v }
  send(): void { FakeXHR.instances.push(this) }
  abort(): void { this.aborted = true }
  emitHeaders(status: number): void { this.status = status; this.readyState = 2; this.onreadystatechange?.() }
  /** A complete, non-streamed response (headers + body + DONE), as a 401 arrives. */
  finish(status: number, body: string): void {
    this.status = status
    this.readyState = 2; this.onreadystatechange?.()
    this.readyState = 3; this.responseText = body; this.onprogress?.(); this.onreadystatechange?.()
    this.readyState = 4; this.onreadystatechange?.()
  }
}
const REFUSED_BODY = JSON.stringify({ detail: { error: 'invalid_user_token' } })
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }

import { OneloEventStream } from './event-stream'

let originalXHR: unknown
beforeEach(() => {
  FakeXHR.instances = []
  originalXHR = (globalThis as Record<string, unknown>).XMLHttpRequest
  ;(globalThis as Record<string, unknown>).XMLHttpRequest = FakeXHR as unknown
})
afterEach(() => {
  ;(globalThis as Record<string, unknown>).XMLHttpRequest = originalXHR
  vi.restoreAllMocks()
})

function tokens(current: string | null, refreshed: string | null = 'fresh') {
  return { current: vi.fn(async () => current), refresh: vi.fn(async () => refreshed) }
}
function newStream(source?: { current: () => Promise<string | null>; refresh: () => Promise<string | null> }) {
  return new OneloEventStream('https://api.test', 'pk_test', '9.9.9', 'com.example.app', source)
}
const auths = () => FakeXHR.instances.map((x) => x.headers['Authorization'])

describe('OneloEventStream (RN) — user token on the stream (#518)', () => {
  it('signed in: the stream request carries Authorization: Bearer <access token>', async () => {
    const stream = newStream(tokens('access-1'))
    stream.start({ userId: 'u1' })
    await flush()
    expect(auths()).toEqual(['Bearer access-1'])
    expect(FakeXHR.instances[0].url).toContain('userId=u1')
    stream.stop()
  })

  it('never sends userIdHash, even when start() passes one', async () => {
    const stream = newStream(tokens('access-1'))
    stream.start({ userId: 'u1', userIdHash: 'legacy-hash' })
    await flush()
    expect(FakeXHR.instances[0].url).not.toContain('userIdHash')
    stream.stop()
  })

  it('every reconnect reads a current token', async () => {
    let current = 'access-1'
    const stream = newStream({ current: async () => current, refresh: async () => null })
    stream.start({ userId: 'u1' })
    await flush()
    current = 'access-2'
    stream.start({ userId: 'u1', sinceVersion: 7 }) // changed params → reconnect
    await flush()
    expect(auths()).toEqual(['Bearer access-1', 'Bearer access-2'])
    stream.stop()
  })

  it('no signed-in user: no Authorization header', async () => {
    const stream = newStream(tokens(null))
    stream.start({ userId: 'u1' })
    await flush()
    expect(auths()).toEqual([undefined])
    stream.stop()
  })

  it('invalid_user_token → refresh once, reconnect at once with the new token', async () => {
    const source = tokens('stale')
    const stream = newStream(source)
    stream.start({ userId: 'u1' })
    await flush()
    FakeXHR.instances[0].finish(401, REFUSED_BODY)
    await flush()
    expect(auths()).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(FakeXHR.instances[1].url).toContain('userId=u1')
    expect(source.refresh).toHaveBeenCalledTimes(1)
    stream.stop()
  })

  it('refused again → anonymous connection (no Bearer, no userId), warned; a later reconnect tries the user again', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stream = newStream(tokens('stale'))
    stream.start({ userId: 'u1' })
    await flush()
    FakeXHR.instances[0].finish(401, REFUSED_BODY)
    await flush()
    FakeXHR.instances[1].finish(401, REFUSED_BODY)
    await flush()
    expect(auths()).toEqual(['Bearer stale', 'Bearer fresh', undefined])
    expect(FakeXHR.instances[2].url).not.toContain('userId=')
    expect(warn.mock.calls.some((c) => String(c[0]).includes('invalid_user_token'))).toBe(true)
    // The anonymous connection is accepted; the next connection proves the user again.
    FakeXHR.instances[2].emitHeaders(200)
    stream.start({ userId: 'u1', sinceVersion: 3 })
    await flush()
    expect(auths().at(-1)).toBe('Bearer stale')
    expect(FakeXHR.instances.at(-1)!.url).toContain('userId=u1')
    stream.stop()
  })

  it('reports the identity each open connection authenticated, marking an anonymous fallback (#736)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const stream = newStream(tokens('stale'))
    const seen: Array<{ userId: string | null; anonymousFallback: boolean } | null> = []
    stream.onConnectionIdentity((i) => seen.push(i))
    stream.start({ userId: 'u1' })
    await flush()
    FakeXHR.instances[0].finish(401, REFUSED_BODY)
    await flush()
    FakeXHR.instances[1].finish(401, REFUSED_BODY)
    await flush()
    FakeXHR.instances[2].emitHeaders(200)
    expect(seen.filter((i) => i !== null)).toEqual([{ userId: 'u1', anonymousFallback: true }])
    stream.start({ userId: 'u1', sinceVersion: 3 })
    await flush()
    expect(seen.at(-1)).toBeNull() // a new connection clears the old identity
    FakeXHR.instances.at(-1)!.emitHeaders(200)
    expect(seen.at(-1)).toEqual({ userId: 'u1', anonymousFallback: false })
    stream.stop()
    expect(seen.at(-1)).toBeNull()
  })

  it('a 401 that is not invalid_user_token backs off as before (no refresh)', async () => {
    vi.useFakeTimers()
    try {
      const source = tokens('access-1')
      const stream = newStream(source)
      stream.start({ userId: 'u1' })
      await flush()
      FakeXHR.instances[0].finish(401, JSON.stringify({ detail: 'invalid key' }))
      await flush()
      expect(source.refresh).not.toHaveBeenCalled()
      expect(FakeXHR.instances).toHaveLength(1) // reconnect waits for the backoff timer
      stream.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
