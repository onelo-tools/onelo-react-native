/**
 * Tests for OneloMonitor (monitor.ts) — focused on the two audit fixes:
 *
 *  1. [HIGH] `sessionId` generation must NEVER throw at construction. On a device
 *     lacking the CSPRNG polyfill (`react-native-get-random-values`),
 *     `crypto.getRandomValues` throws — an unguarded call in the field
 *     initializer would take down the whole `new Onelo(config)`, not just
 *     monitoring. `_uuidv4` degrades to `Math.random()`.
 *
 *  2. [MED] The global ErrorUtils crash handler must not leak across
 *     destroy/re-init. `destroy()` restores the previous handler and resets the
 *     module registration state so a fresh instance re-registers (and still
 *     chains to the prior handler so RN's red-box isn't suppressed).
 *
 * The module keeps registration state at module scope, so each test resets
 * modules and dynamically imports for a clean slate.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

type GlobalErrorHandler = (err: unknown, isFatal?: boolean) => void

describe('OneloMonitor — sessionId generation never throws', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('constructing does NOT throw when crypto.getRandomValues is unavailable → still gets a valid sessionId', async () => {
    // Simulate a device without the CSPRNG polyfill: the only source of entropy throws.
    vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('crypto.getRandomValues unavailable (no react-native-get-random-values)')
    })

    const { OneloMonitor } = await import('./monitor')

    let monitor: InstanceType<typeof OneloMonitor> | undefined
    expect(() => {
      monitor = new OneloMonitor('pk_test', 'https://api.example.test')
    }).not.toThrow()

    // Fell back to Math.random() and still produced a well-formed lowercased UUID v4.
    const sessionId = (monitor as unknown as { sessionId: string }).sessionId
    expect(sessionId).toMatch(UUID_V4_RE)
    expect(sessionId).toBe(sessionId.toLowerCase())

    monitor?.destroy() // clear the 15s flush interval
  })

  it('produces a valid sessionId via the CSPRNG on a normal (polyfilled) device', async () => {
    const { OneloMonitor } = await import('./monitor')
    const monitor = new OneloMonitor('pk_test', 'https://api.example.test')
    const sessionId = (monitor as unknown as { sessionId: string }).sessionId
    expect(sessionId).toMatch(UUID_V4_RE)
    monitor.destroy()
  })
})

describe('OneloMonitor — global crash handler lifecycle', () => {
  let installed: GlobalErrorHandler | undefined
  let originalHandler: GlobalErrorHandler
  let setSpy: ReturnType<typeof vi.fn<[GlobalErrorHandler], void>>

  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    // A stand-in ErrorUtils backed by a mutable `installed` slot.
    originalHandler = vi.fn()
    installed = originalHandler
    setSpy = vi.fn((h: GlobalErrorHandler) => { installed = h })
    ;(globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => installed,
      setGlobalHandler: setSpy,
    }
    // Invoking the installed handler pushes a global_error → best-effort flush →
    // fetch. Stub it so tests don't hit the network (flush swallows failures anyway).
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    delete (globalThis as unknown as { ErrorUtils?: unknown }).ErrorUtils
  })

  it('tags an uncaught error with meta.origin: OneloError → onelo_sdk, app error → app (#548)', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 })
    vi.stubGlobal('fetch', fetchSpy)
    const { OneloMonitor } = await import('./monitor')
    const { OneloError } = await import('@onelo/core')
    const m = new OneloMonitor('pk_test', 'https://api.example.test')
    installed?.(OneloError.sessionEnded(), false)
    const appErr = new Error('app boom')
    appErr.stack = 'Error: app boom\n    at onPress (http://localhost:8081/index.bundle:10:5)'
    installed?.(appErr, false)
    await m.flush()
    const events = fetchSpy.mock.calls
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)).events as Array<{ featureName: string; meta: Record<string, unknown> }>)
      .flat()
      .filter((e) => e.featureName === 'unhandled')
    expect(events.map((e) => e.meta.origin)).toEqual(['onelo_sdk', 'app'])
    m.destroy()
  })

  it('registers on construct, restores the prior handler on destroy(), and lets a fresh instance re-register', async () => {
    const { OneloMonitor } = await import('./monitor')

    // 1. First instance installs its handler (chained on top of originalHandler).
    const a = new OneloMonitor('pk_test', 'https://api.example.test')
    expect(setSpy).toHaveBeenCalledTimes(1)
    const aHandler = installed
    expect(aHandler).not.toBe(originalHandler) // our handler is now current

    // Chaining preserved: invoking our handler still calls the prior handler
    // (so RN's red-box / fatal path isn't suppressed).
    aHandler?.(new Error('boom'), false)
    expect(originalHandler).toHaveBeenCalledTimes(1)

    // 2. destroy() restores the previous handler...
    a.destroy()
    expect(installed).toBe(originalHandler)

    // 3. ...and a second construction registers AGAIN (flag was reset, not stuck true).
    const b = new OneloMonitor('pk_test', 'https://api.example.test')
    expect(setSpy).toHaveBeenCalledTimes(3) // A install, A restore, B install
    const bHandler = installed
    expect(bHandler).not.toBe(originalHandler)
    expect(bHandler).not.toBe(aHandler) // a genuinely fresh handler, not the torn-down one

    // b still chains to originalHandler (which it captured as its `prev`).
    ;(originalHandler as ReturnType<typeof vi.fn>).mockClear()
    bHandler?.(new Error('boom2'), true)
    expect(originalHandler).toHaveBeenCalledTimes(1)

    b.destroy()
    expect(installed).toBe(originalHandler)
  })

  it('only the registering instance installs the handler; a second concurrent instance does not re-install', async () => {
    const { OneloMonitor } = await import('./monitor')

    const a = new OneloMonitor('pk_test', 'https://api.example.test')
    expect(setSpy).toHaveBeenCalledTimes(1)

    // Second instance while A is still alive → registration flag already true → skips install.
    const b = new OneloMonitor('pk_test', 'https://api.example.test')
    expect(setSpy).toHaveBeenCalledTimes(1)

    // Destroying B (which never registered) must NOT restore/clobber A's handler.
    b.destroy()
    expect(setSpy).toHaveBeenCalledTimes(1)
    expect(installed).not.toBe(originalHandler) // A's handler still installed

    // Destroying A restores the original.
    a.destroy()
    expect(installed).toBe(originalHandler)
  })
})
