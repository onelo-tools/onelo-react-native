/**
 * Tests for getInstanceId (instance-id.ts).
 *
 * Contract: NEVER throws (Keychain/CSPRNG failures degrade to a fresh,
 * non-persisted lowercased UUID v4); single-flight so concurrent first callers
 * share ONE id; subsequent calls return the in-memory cached id.
 *
 * The module caches at module scope, so each test resets modules + re-mocks
 * ./storage with the behaviour it needs, then dynamically imports.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

describe('getInstanceId', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
  })

  it('never throws even when the keychain module rejects → returns a valid lowercased uuid', async () => {
    vi.doMock('./storage', () => ({
      KeychainStorage: vi.fn(() => ({
        get: vi.fn().mockRejectedValue(new Error('keychain unavailable')),
        set: vi.fn().mockRejectedValue(new Error('keychain unavailable')),
      })),
    }))
    const { getInstanceId } = await import('./instance-id')

    const id = await getInstanceId()
    expect(id).toMatch(UUID_V4_RE)
    expect(id).toBe(id.toLowerCase())
  })

  it('single-flight — concurrent first callers get the SAME id (one keychain read)', async () => {
    const getMock = vi.fn().mockResolvedValue(null) // no existing id stored
    const setMock = vi.fn().mockResolvedValue(undefined)
    const ctor = vi.fn(() => ({ get: getMock, set: setMock }))
    vi.doMock('./storage', () => ({ KeychainStorage: ctor }))
    const { getInstanceId } = await import('./instance-id')

    const [a, b] = await Promise.all([getInstanceId(), getInstanceId()])

    expect(a).toBe(b)
    expect(a).toMatch(UUID_V4_RE)
    // Only ONE storage instance + one read despite two concurrent callers.
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledTimes(1)
    // The freshly-created id is persisted exactly once.
    expect(setMock).toHaveBeenCalledTimes(1)
  })

  it('returns the cached id (and re-lowercases a stored id) on subsequent calls', async () => {
    const getMock = vi.fn().mockResolvedValue('ABCDEF01-2345-4678-9ABC-DEF012345678')
    const setMock = vi.fn().mockResolvedValue(undefined)
    const ctor = vi.fn(() => ({ get: getMock, set: setMock }))
    vi.doMock('./storage', () => ({ KeychainStorage: ctor }))
    const { getInstanceId } = await import('./instance-id')

    const first = await getInstanceId()
    expect(first).toBe('abcdef01-2345-4678-9abc-def012345678') // existing id, lowercased
    expect(setMock).not.toHaveBeenCalled() // existing id is not re-persisted

    const second = await getInstanceId()
    expect(second).toBe(first)
    // Cache hit — no second storage instance / read.
    expect(ctor).toHaveBeenCalledTimes(1)
    expect(getMock).toHaveBeenCalledTimes(1)
  })
})
