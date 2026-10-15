// #820 — a signed-in Onelo Auth user's report names a VERIFIED reporter: the
// initiate call carries `Authorization: Bearer <access token>`. Signed out,
// nothing is sent (anonymous); an explicit `userId` stays an unverified label.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../src/sdk-headers', () => ({ sdkHeaders: async () => ({ 'X-Bundle-Id': 'com.app' }) }))

import { OneloFeedback } from '../../src/feedback/feedback'
import type { UserTokenSource } from '../../src/core/user-token'

const HOSTED = 'https://onelo.test/feedback/hosted?key=pk_test&ft=x'
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

const ok = () => ({ ok: true, status: 200, json: async () => ({ hosted_url: HOSTED }) })
const refused = () => ({ ok: false, status: 401, json: async () => ({ detail: { error: 'invalid_user_token' } }) })
const source = (token: string | null, refreshed: string | null = null): UserTokenSource => ({
  current: async () => token,
  refresh: async () => refreshed,
})
const make = (s?: UserTokenSource) => new OneloFeedback('https://api.test', 'pk_test', () => [], 'com.app', undefined, s)
const headersOf = (i: number) => (fetchMock.mock.calls[i] as [string, { headers: Record<string, string> }])[1].headers

async function openAndLoad(fb: OneloFeedback, opts = {}) {
  fb.open(opts)
  await vi.waitFor(() => expect(fb.getCurrentUrl()).toBe(HOSTED))
}

describe('OneloFeedback — Onelo Auth reporter (#820)', () => {
  it('signed in: sends the access token as Bearer, no userId needed', async () => {
    fetchMock.mockResolvedValue(ok())
    await openAndLoad(make(source('AT_1')))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(headersOf(0)['Authorization']).toBe('Bearer AT_1')
    expect(headersOf(0)['X-Onelo-User-Id']).toBeUndefined()
    expect(headersOf(0)['X-Bundle-Id']).toBe('com.app')
  })

  it('signed out: no Authorization and no userId — anonymous', async () => {
    fetchMock.mockResolvedValue(ok())
    await openAndLoad(make(source(null)))
    expect(headersOf(0)['Authorization']).toBeUndefined()
    expect(headersOf(0)['X-Onelo-User-Id']).toBeUndefined()
  })

  it('signed out with an explicit userId: the unverified label still travels', async () => {
    fetchMock.mockResolvedValue(ok())
    await openAndLoad(make(source(null)), { userId: 'dev-42' })
    expect(headersOf(0)['Authorization']).toBeUndefined()
    expect(headersOf(0)['X-Onelo-User-Id']).toBe('dev-42')
  })

  it('a refused token is refreshed once and retried with the fresh one', async () => {
    fetchMock.mockResolvedValueOnce(refused()).mockResolvedValue(ok())
    await openAndLoad(make(source('AT_OLD', 'AT_NEW')))
    expect([headersOf(0)['Authorization'], headersOf(1)['Authorization']]).toEqual(['Bearer AT_OLD', 'Bearer AT_NEW'])
  })

  it('refused even after refresh: the form still opens, without the token', async () => {
    fetchMock.mockResolvedValueOnce(refused()).mockResolvedValueOnce(refused()).mockResolvedValue(ok())
    await openAndLoad(make(source('AT_OLD', 'AT_NEW')), { userId: 'dev-42' })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(headersOf(2)['Authorization']).toBeUndefined()
    expect(headersOf(2)['X-Onelo-User-Id']).toBe('dev-42')
  })
})
