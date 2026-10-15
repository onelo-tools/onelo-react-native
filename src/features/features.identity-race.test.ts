/**
 * #736: feature snapshots are bound to the identity (and load generation) that
 * requested them — parity with Swift onelo-swift-staging#1, JS #734, Electron #735.
 */
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

interface Pending { url: string; auth?: string; reply: (status: number, json: unknown) => void }
const pending: Pending[] = []
let auto: ((p: Pending) => { status: number; json: unknown } | null) | null = null

function send(url: string, headers?: Record<string, string>): Promise<{ status: number; json: unknown }> {
  return new Promise((resolve) => {
    const p: Pending = { url, auth: headers?.['Authorization'], reply: (status, json) => resolve({ status, json }) }
    const a = auto?.(p)
    if (a) p.reply(a.status, a.json)
    else pending.push(p)
  })
}

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpPost: (url: string, _b: unknown, headers?: Record<string, string>) => send(url, headers),
    httpGet: (url: string, headers?: Record<string, string>) => send(url, headers),
  }
})
const disk = new Map<string, { config_version: number; features: Record<string, unknown> }>()
const userOf = (key: string) => key.split('.').pop()!
vi.mock('./feature-cache', () => ({
  loadFeatureCache: async (k: string) => disk.get(userOf(k)) ?? null,
  saveFeatureCache: async (k: string, v: { config_version: number; features: Record<string, unknown> }) => { disk.set(userOf(k), v) },
}))

import { OneloFeatures } from './features'

const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)) }
const snap = (status: string, v = 7) => ({ config_version: v, features: { pro: { status } } })
const resolves = () => pending.filter((p) => p.url.includes('/resolve'))
const nthResolve = async (n: number) => {
  for (let i = 0; i < 500 && resolves().length <= n; i++) await new Promise((r) => setTimeout(r, 0))
  return resolves()[n]
}

function fakeStream() {
  const handlers: Record<string, (d: Record<string, unknown>) => void> = {}
  let identity: ((i: { userId: string | null; anonymousFallback: boolean } | null) => void) | undefined
  const s = {
    sinceVersion: -1,
    on: (e: string, h: (d: Record<string, unknown>) => void) => { handlers[e] = h },
    emit: (e: string, d: Record<string, unknown>) => handlers[e]?.(d),
    updateSinceVersion: (v: number) => { s.sinceVersion = v },
    onConnectionIdentity: (fn: typeof identity) => { identity = fn },
    connect: (userId: string | null, anonymousFallback = false) => identity?.({ userId, anonymousFallback }),
  }
  return s
}

function make(stream = true, token: string | null = null) {
  const userToken = { current: vi.fn(async () => token), refresh: vi.fn(async () => null) }
  const f = new OneloFeatures('https://api', 'onelo_pk_live_x', null, undefined, { userToken })
  const s = fakeStream()
  if (stream) f.attachEventStream(s as never)
  return { f, s }
}

describe('RN OneloFeatures — identity-bound snapshots (#736)', () => {
  // Warm the lazily imported modules so every test sees the same timing.
  beforeAll(async () => { await import('../sdk-headers'); await import('../attest') })
  beforeEach(() => {
    pending.length = 0; auto = null; disk.clear()
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(Math, 'random').mockReturnValue(0.5) // no load-time batch-ping
  })

  it('drops a late anonymous /resolve that completes after sign-in', async () => {
    const { f } = make(false)
    void f.load(null)
    await flush()
    const anon = await nthResolve(0)
    void f.load('u1')
    await flush()
    void (await nthResolve(1)).reply(200, snap('enabled'))
    await flush()
    anon.reply(200, snap('hidden', 8))
    await flush()
    expect(f.feature('pro').status).toBe('enabled')
    expect(disk.get('u1')?.features).toEqual({ pro: expect.objectContaining({ status: 'enabled' }) })
    f.stopPolling()
  })

  it('drops a late previous-user /resolve and never caches it under the new user', async () => {
    const { f } = make(false)
    void f.load('a')
    await flush()
    const forA = await nthResolve(0)
    void f.load('b')
    await flush()
    forA.reply(200, snap('enabled'))
    await flush()
    expect(f.feature('pro').status).toBe('hidden')
    expect(disk.has('b')).toBe(false)
    f.stopPolling()
  })

  it('does not apply an anonymous fallback answer for a signed-in user (refused token)', async () => {
    const { f } = make(false, 'tok')
    disk.set('u1', { config_version: 3, features: { pro: { status: 'enabled' } } })
    auto = (p) => p.auth ? { status: 401, json: { detail: { error: 'invalid_user_token' } } } : { status: 200, json: { ...snap('hidden', 9), anonymous: true } }
    await f.load('u1')
    await flush()
    expect(f.feature('pro').status).toBe('enabled')
    expect(disk.get('u1')?.config_version).toBe(3)
    f.stopPolling()
  })

  it('ignores a snapshot from an anonymous-fallback stream connection for a signed-in user', async () => {
    const { f, s } = make()
    auto = () => ({ status: 503, json: {} })
    await f.load('u1')
    s.connect('u1', true)
    s.emit('connected', snap('hidden'))
    s.emit('features_updated', snap('hidden'))
    expect(f.feature('pro').status).toBe('hidden')
    expect(disk.has('u1')).toBe(false)
    s.connect('u1', false)
    s.emit('connected', snap('enabled'))
    expect(f.feature('pro').status).toBe('enabled')
  })

  it('resets ready() on identity change and releases it only for the new identity', async () => {
    const { f, s } = make()
    auto = () => ({ status: 200, json: snap('hidden') })
    await f.load(null)
    await f.ready(50)
    auto = null
    void f.load('u1')
    await flush()
    let released = false
    void f.ready(10_000).then(() => { released = true })
    await flush()
    expect(released).toBe(false)
    s.connect('u1')
    s.emit('connected', snap('enabled'))
    await flush()
    expect(released).toBe(true)
    f.stopPolling()
  })

  it('a late previous-identity resolve does not release ready() for the new identity', async () => {
    const { f } = make(false)
    void f.load('a')
    await flush()
    const forA = await nthResolve(0)
    void f.load('b')
    await flush()
    let released = false
    void f.ready(10_000).then(() => { released = true })
    forA.reply(200, snap('enabled'))
    await flush()
    expect(released).toBe(false)
    void (await nthResolve(1)).reply(200, snap('hidden'))
    await flush()
    expect(released).toBe(true)
    f.stopPolling()
  })

  it('does not keep the previous identity snapshot when the new one has no cache', async () => {
    const { f, s } = make()
    auto = () => ({ status: 503, json: {} })
    await f.load('a')
    s.connect('a')
    s.emit('connected', snap('enabled'))
    expect(f.feature('pro').status).toBe('enabled')
    await f.load('b')
    expect(f.feature('pro').status).toBe('hidden')
    expect(s.sinceVersion).toBe(0)
  })

  it('sends since_version=0 until the current identity confirms its version', async () => {
    disk.set('u1', { config_version: 42, features: { pro: { status: 'enabled' } } })
    const { f, s } = make()
    auto = () => ({ status: 503, json: {} })
    await f.load('u1')
    expect(f.feature('pro').status).toBe('enabled') // persisted snapshot still renders
    expect(s.sinceVersion).toBe(0)
    s.connect('u1')
    s.emit('connected', snap('enabled', 43))
    expect(s.sinceVersion).toBe(43)
  })

  it('poll sends since_version=0 for an unconfirmed persisted snapshot', async () => {
    disk.set('anon', { config_version: 42, features: { pro: { status: 'enabled' } } })
    const { f } = make(false)
    auto = (p) => p.url.includes('/resolve') ? { status: 503, json: {} } : null
    await f.load(null)
    void (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll(null)
    await flush()
    const poll = pending.find((p) => p.url.includes('/poll'))!
    expect(poll.url).toContain('since_version=0')
    f.stopPolling()
  })

  it('refresh() before the first identity load does not resolve anonymously', async () => {
    const { f } = make(false)
    await f.refresh(true)
    expect(resolves()).toHaveLength(0)
  })
})
