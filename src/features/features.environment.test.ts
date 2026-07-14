/**
 * Tests for the explicit feature environment selector (feature-environment-explicit.md).
 * OneloFeatures forwards `environment` on /resolve, /batch-ping, and the /poll
 * query string when `featureEnvironment` is set, and omits it otherwise so the
 * backend falls back to the key prefix.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const httpPostMock = vi.fn()
const httpGetMock = vi.fn()

vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpPost: (...args: unknown[]) => httpPostMock(...args),
    httpGet: (...args: unknown[]) => httpGetMock(...args),
  }
})

import { OneloFeatures } from './features'

function bodyForPath(path: string): Record<string, unknown> | undefined {
  const call = httpPostMock.mock.calls.find((c) => String(c[0]).includes(path))
  return call?.[1] as Record<string, unknown> | undefined
}

describe('OneloFeatures featureEnvironment', () => {
  beforeEach(() => {
    httpPostMock.mockReset()
    httpPostMock.mockResolvedValue({ status: 200, json: { features: {} } })
    httpGetMock.mockReset()
    httpGetMock.mockResolvedValue({ status: 200, json: { changed: false } })
  })

  it('forwards environment on /resolve when set', async () => {
    const f = new OneloFeatures('https://api', 'pk_live', null, undefined, { featureEnvironment: 'test' })
    await f.load('u1')
    f.stopPolling()
    expect(bodyForPath('/api/sdk/features/resolve')?.['environment']).toBe('test')
  })

  it('omits environment on /resolve when unset', async () => {
    const f = new OneloFeatures('https://api', 'pk_live', null, undefined)
    await f.load('u1')
    f.stopPolling()
    expect(bodyForPath('/api/sdk/features/resolve')).toBeDefined()
    expect(bodyForPath('/api/sdk/features/resolve')?.['environment']).toBeUndefined()
  })

  it('forwards environment on batch-ping when set', async () => {
    vi.useFakeTimers()
    try {
      const f = new OneloFeatures('https://api', 'pk_live', null, undefined, { featureEnvironment: 'test' })
      f.declare(['foo'])
      await vi.advanceTimersByTimeAsync(1100) // batch-ping debounce is 1000ms
      f.stopPolling()
    } finally {
      vi.useRealTimers()
    }
    expect(bodyForPath('/api/sdk/features/batch-ping')?.['environment']).toBe('test')
  })
})
