/**
 * #518: every Features call proves the signed-in Onelo user with their access
 * token (`Authorization: Bearer`), refreshes and retries once on the server's
 * `401 invalid_user_token`. Refused again, a signed-in user's resolve/poll stops
 * there (#736: no anonymous answer over their snapshot); batch-ping still goes
 * out anonymous. `userIdHash` is never sent.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

type Reply = { status: number; json: unknown }
type Call = { url: string; body: Record<string, unknown>; headers: Record<string, string> }
const calls: Call[] = []
let replies: Record<string, Reply[]> = {}
const OK: Reply = { status: 200, json: { features: {}, config_version: 1, token: 'module-jwt' } }
const REFUSED: Reply = { status: 401, json: { detail: { error: 'invalid_user_token' } } }

function reply(url: string): Reply {
  const key = Object.keys(replies).find((k) => url.includes(k))
  const q = key ? replies[key] : undefined
  return q ? (q.length > 1 ? q.shift()! : q[0]) : OK
}

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpPost: async (url: string, body: Record<string, unknown>, headers?: Record<string, string>) => {
      calls.push({ url, body, headers: headers ?? {} })
      return reply(url)
    },
    httpGet: async (url: string, headers?: Record<string, string>) => {
      calls.push({ url, body: {}, headers: headers ?? {} })
      return reply(url)
    },
  }
})

import { OneloFeatures } from './features'

function tokens(current: string | null, refreshed: string | null = 'fresh') {
  return { current: vi.fn(async () => current), refresh: vi.fn(async () => refreshed) }
}
const to = (path: string) => calls.filter((c) => c.url.includes(path))
const bearers = (path: string) => to(path).map((c) => c.headers['Authorization'])
const poll = (f: OneloFeatures, userId: string | null) =>
  (f as unknown as { _poll: (u: string | null) => Promise<void> })._poll(userId)

describe('OneloFeatures (RN) — signed-in user proven with the access token (#518)', () => {
  beforeEach(() => { calls.length = 0; replies = {} })
  afterEach(() => { vi.restoreAllMocks() })

  it('sends Authorization: Bearer on resolve, batch-ping, poll and module-token', async () => {
    const f = new OneloFeatures('https://api', 'pk_test_x', null, undefined, { featureEnvironment: 'test', userToken: tokens('access-1') })
    f.declare(['hero'])
    await f.load('u1')
    f.stopPolling()
    await poll(f, 'u1')
    await f.moduleToken('export')
    for (const path of ['/features/resolve', '/batch-ping', '/features/poll', '/module-token']) {
      expect(bearers(path), path).toEqual(['Bearer access-1'])
    }
    expect(to('/features/resolve')[0].body['userId']).toBe('u1')
  })

  it('never sends userIdHash, even when identify()/moduleToken() pass one', async () => {
    const f = new OneloFeatures('https://api', 'pk_test_x', null, undefined, { featureEnvironment: 'test', userToken: tokens('access-1') })
    f.declare(['hero'])
    await f.load('u1', 'legacy-hash')
    f.stopPolling()
    await f.moduleToken('export', 'legacy-hash')
    expect(calls.length).toBeGreaterThan(0)
    for (const c of calls) expect('userIdHash' in c.body).toBe(false)
  })

  it('signed out: no Authorization and no userId', async () => {
    const f = new OneloFeatures('https://api', 'pk_test_x', null, undefined, { featureEnvironment: 'test', userToken: tokens(null) })
    f.declare(['hero'])
    await f.load(null)
    f.stopPolling()
    await poll(f, null)
    for (const c of calls) {
      expect(c.headers['Authorization']).toBeUndefined()
      expect('userId' in c.body).toBe(false)
      expect(c.url).not.toContain('userId=')
    }
  })

  it('401 invalid_user_token → one refresh, one retry with the new token', async () => {
    replies = { '/features/resolve': [REFUSED, OK] }
    const source = tokens('stale')
    const f = new OneloFeatures('https://api', 'pk_test_x', null, undefined, { userToken: source })
    await f.load('u1')
    f.stopPolling()
    expect(bearers('/features/resolve')).toEqual(['Bearer stale', 'Bearer fresh'])
    expect(source.refresh).toHaveBeenCalledTimes(1)
  })

  it('refused again → no anonymous call for a signed-in user, a warning; poll too (#736)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies = { '/features/resolve': [REFUSED, REFUSED, OK], '/features/poll': [REFUSED, REFUSED, OK] }
    const f = new OneloFeatures('https://api', 'pk_test_x', null, undefined, { userToken: tokens('stale') })
    await f.load('u1')
    f.stopPolling()
    await poll(f, 'u1')
    // An anonymous answer must never replace the signed-in user's snapshot, so
    // the SDK does not ask for one: it keeps the last confirmed snapshot.
    expect(bearers('/features/resolve')).toEqual(['Bearer stale', 'Bearer fresh'])
    // Same refusal episode: the one refresh is spent, so the poll does not
    // refresh again (no refresh loop, R1-1) and does not go anonymous.
    expect(bearers('/features/poll')).toEqual(['Bearer stale'])
    expect(to('/features/poll')[0].url).toContain('userId=u1')
    expect(warn.mock.calls.some((c) => String(c[0]).includes('invalid_user_token'))).toBe(true)
  })

  it('batch-ping: refused twice → retried once, then sent without token or userId', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies = { '/batch-ping': [REFUSED, REFUSED, OK] }
    const f = new OneloFeatures('https://api', 'pk_test_x', null, undefined, { featureEnvironment: 'test', userToken: tokens('stale') })
    f.declare(['hero'])
    await f.load('u1')
    f.stopPolling()
    expect(bearers('/batch-ping')).toEqual(['Bearer stale', 'Bearer fresh', undefined])
    expect('userId' in to('/batch-ping')[2].body).toBe(false)
  })

  it('module-token: refused twice → not_authenticated, never minted anonymously', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    replies = { '/module-token': [REFUSED] }
    const f = new OneloFeatures('https://api', 'pk_test_x', null, undefined, { userToken: tokens('stale') })
    await f.load('u1')
    f.stopPolling()
    await expect(f.moduleToken('export')).rejects.toMatchObject({ code: 'not_authenticated' })
    expect(bearers('/module-token')).toEqual(['Bearer stale', 'Bearer fresh'])
  })
})
