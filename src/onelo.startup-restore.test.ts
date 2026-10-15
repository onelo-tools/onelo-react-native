/**
 * #736: features start only after the cold-start session restore settles, so an
 * anonymous load never races (and overwrites) a returning user's snapshot.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./core/storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('./sdk-headers', async () => ({ ...(await vi.importActual<object>('./sdk-headers')), sdkHeaders: vi.fn().mockResolvedValue({}) }))
vi.mock('./core/instance-id', () => ({ getInstanceId: vi.fn().mockResolvedValue('iid') }))
vi.mock('./features/feature-cache', () => ({ loadFeatureCache: vi.fn().mockResolvedValue(null), saveFeatureCache: vi.fn().mockResolvedValue(undefined) }))

const resolveBodies: Array<Record<string, unknown>> = []
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: async () => ({ status: 200, json: {} }),
    httpPost: async (url: string, body: Record<string, unknown>) => {
      if (url.includes('/features/resolve')) resolveBodies.push(body)
      return { status: 200, json: { features: {}, config_version: 1 } }
    },
  }
})

import { Onelo } from './onelo'
import { OneloAuth } from './auth/auth'

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) }

function deferredRestore() {
  let settle!: (s: unknown) => void
  vi.spyOn(OneloAuth.prototype, 'restoreSession').mockImplementation(() => new Promise((r) => { settle = r as never }) as never)
  vi.spyOn(OneloAuth.prototype, 'getSession').mockResolvedValue(null as never)
  return (s: unknown) => settle(s)
}

describe('Onelo (RN) — restore-aware feature startup (#736)', () => {
  afterEach(() => { vi.restoreAllMocks(); resolveBodies.length = 0 })

  it('does not resolve features before the session restore settles; then loads anonymous', async () => {
    const settle = deferredRestore()
    const onelo = new Onelo({ publishableKey: 'onelo_pk_live_x', apiUrl: 'https://api.example.com' })
    await onelo.features.refresh(true) // e.g. an early foreground: no identity yet
    await flush()
    expect(resolveBodies).toHaveLength(0)
    settle(null)
    await flush()
    expect(resolveBodies).toHaveLength(1)
    expect('userId' in resolveBodies[0]).toBe(false)
    onelo.destroy()
  })

  it('loads the restored user when the restore announced no session change', async () => {
    const settle = deferredRestore()
    const onelo = new Onelo({ publishableKey: 'onelo_pk_live_x', apiUrl: 'https://api.example.com' })
    settle({ accessToken: 'at', refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } })
    await flush()
    expect(resolveBodies.map((b) => b['userId'])).toEqual(['u1'])
    onelo.destroy()
  })

  it('identify() before the restore settles is not overwritten by an anonymous load', async () => {
    const settle = deferredRestore()
    const onelo = new Onelo({ publishableKey: 'onelo_pk_live_x', apiUrl: 'https://api.example.com' })
    await onelo.identify('custom-1')
    settle(null)
    await flush()
    expect(resolveBodies.map((b) => b['userId'])).toEqual(['custom-1'])
    onelo.destroy()
  })
})
