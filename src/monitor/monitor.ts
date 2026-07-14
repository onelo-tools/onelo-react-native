import { version as SDK_VERSION } from '../../package.json'
import { scrubText, scrubMeta } from './scrubber'

export interface MonitorEventOptions {
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

const SDK_NAME = '@onelo/react-native'

// `feature_call` no longer ships as a per-call event — it is aggregated into a
// single `feature_call_summary` event at flush time (see summaryBuffer).
type EventSource = 'feature_call_summary' | 'track' | 'event' | 'global_error'

interface BufferedEvent {
  featureName: string
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
  source: EventSource
  userId?: string
  platform: string
  sessionId: string
}

/** A trail entry leading up to an error (parity with Swift's MonitorBreadcrumb). */
interface Breadcrumb { category: string; message: string; ts: number; data?: Record<string, string> }

const MAX_BUFFER_SIZE = 200
const MAX_FLAGS = 100        // LRU cap on the flag snapshot (parity with Swift's MonitorFeatureFlagBuffer)
const MAX_BREADCRUMBS = 100  // ring buffer (parity with Swift's MonitorBreadcrumbBuffer)
const MAX_META_BYTES = 16000 // ~16KB soft cap on error meta (parity with Swift's 16KB note)

const PLATFORM = 'reactnative'

// Global crash-handler registration state. Only ONE monitor instance installs
// the ErrorUtils handler; `destroy()` on that instance restores the previous
// handler and resets these so a freshly-constructed monitor re-registers.
// (Previously `_globalHandlersRegistered` was set once and never reset, leaking
// a handler bound to a torn-down monitor across destroy/re-init.)
type GlobalErrorHandler = (err: unknown, isFatal?: boolean) => void
let _globalHandlersRegistered = false
let _previousGlobalHandler: GlobalErrorHandler | undefined
let _installedGlobalHandler: GlobalErrorHandler | undefined

/**
 * Generate a lowercased UUID v4. Prefers a CSPRNG (`crypto.getRandomValues`,
 * available in Node's webcrypto and in RN when `react-native-get-random-values`
 * is installed), falling back to `Math.random()` only when no CSPRNG exists so
 * generation itself can NEVER throw. Copied verbatim from `core/instance-id.ts`
 * — an unguarded `getRandomValues` in the `sessionId` field initializer would
 * throw at construction on a device without the polyfill, taking down the entire
 * `new Onelo(config)` init, not just monitoring.
 */
function _uuidv4(): string {
  const bytes = new Uint8Array(16)
  try {
    ;(globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(bytes)
  } catch {
    for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  }
  bytes[6] = (bytes[6] & 0x0f) | 0x40 // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80 // variant
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** Minimal RN `Platform` shape we depend on — kept local so a pure-Node import
 *  of this module (tests / SSR tooling) never statically pulls `react-native`. */
interface PlatformLike {
  OS?: string
  Version?: string | number
  isTV?: boolean
  constants?: Record<string, unknown>
}

// `react-native` is required LAZILY and cached, mirroring onelo.ts's AppState
// pattern: a pure-Node import (tests) never pulls the native module, and any
// failure degrades to "unknown device" rather than throwing. `undefined` = not
// yet resolved; `null` = resolved-but-absent.
let _platformCache: PlatformLike | null | undefined
function _platform(): PlatformLike | undefined {
  if (_platformCache !== undefined) return _platformCache ?? undefined
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _platformCache = (require('react-native') as { Platform?: PlatformLike }).Platform ?? null
  } catch {
    _platformCache = null
  }
  return _platformCache ?? undefined
}

/** Best-effort device context (parity with Swift's meta.device). Light fields on
 *  every event; heavier fields only on error/crash. Never throws. */
function _deviceContext(heavy: boolean): Record<string, unknown> {
  const d: Record<string, unknown> = {}
  const P = _platform()
  d['os'] = P?.OS ?? 'unknown'
  if (P?.Version != null) d['osVersion'] = String(P.Version)
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (tz) d['timezone'] = tz
  } catch { /* Intl unavailable — omit */ }
  if (heavy) {
    if (P?.isTV != null) d['isTV'] = P.isTV
    const c = P?.constants
    if (c) {
      // Android exposes Brand/Model/Release; iOS exposes systemName/interfaceIdiom.
      if (typeof c['Brand'] === 'string') d['brand'] = c['Brand']
      if (typeof c['Model'] === 'string') d['model'] = c['Model']
      if (typeof c['systemName'] === 'string') d['systemName'] = c['systemName']
      if (typeof c['interfaceIdiom'] === 'string') d['interfaceIdiom'] = c['interfaceIdiom']
    }
  }
  return d
}

/** Normalize any thrown value into { message, stack, errorType }. */
function _extractError(err: unknown): { message: string; stack?: string; errorType?: string } {
  if (err instanceof Error) return { message: err.message, stack: err.stack, errorType: err.name }
  return { message: String(err) }
}

/**
 * The React Native Monitor SDK — captures errors, performance, breadcrumbs, and
 * feature-flag context and forwards them to the Onelo backend.
 *
 * All event data passes through `MonitorScrubber` BEFORE it leaves the device —
 * secrets in error strings and meta are redacted. Flush is always best-effort:
 * a failed send is dropped, never thrown (monitoring must never break the app).
 */
export class OneloMonitor {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private readonly bundleId?: string
  private buffer: BufferedEvent[] = []
  // Per-feature call counters — every `feature("name")` lookup increments one,
  // and flush emits ONE `feature_call_summary` event per feature with
  // `meta.calls = N` (write-amplification control, parity with Swift). Errors /
  // explicit `event()` / `track()` are NOT aggregated — they carry unique data.
  private readonly summaryBuffer = new Map<string, number>()
  // Rolling snapshot of the most recently evaluated feature flags (name→status),
  // LRU-capped. Attached to ERROR events so a captured error carries the active
  // flag state (parity with Swift's MonitorFeatureFlagBuffer).
  private readonly flags = new Map<string, string>()
  // Ring buffer of breadcrumbs (the trail leading up to an error), snapshotted
  // into meta.breadcrumbs on error events (parity with Swift).
  private readonly breadcrumbs: Breadcrumb[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private currentUserId: string | null = null
  /** Pre-built static meta merged into every event (sdk + app). Computed once. */
  private readonly staticMeta: Record<string, unknown>
  private readonly environment?: string
  // NEVER inline `crypto.getRandomValues` here unguarded — a field initializer
  // that throws takes down `new Onelo(config)` entirely. `_uuidv4` degrades to
  // `Math.random()` when the CSPRNG polyfill is absent.
  private readonly sessionId: string = _uuidv4()
  /** True only on the instance that actually installed the global ErrorUtils
   *  handler — gates handler restoration in `destroy()`. */
  private _registeredGlobalHandler = false

  /**
   * Append a breadcrumb — a step in the trail leading to an error. Snapshotted
   * into `meta.breadcrumbs` on the next error capture. Ring-buffered (cap 100).
   * The message is scrubbed of secrets on the way in. Parity with Swift.
   * Convenience: `breadcrumb.info(msg)` and `breadcrumb.navigationTo(view)`.
   */
  readonly breadcrumb: {
    (message: string, opts?: { category?: string; data?: Record<string, string> }): void
    info: (message: string, data?: Record<string, string>) => void
    navigationTo: (view: string) => void
  }

  constructor(
    publishableKey: string,
    apiUrl: string,
    bundleId?: string,
    appVersion?: string,
    appBuild?: string,
    environment?: string,
  ) {
    this.publishableKey = publishableKey
    this.apiUrl = apiUrl
    this.bundleId = bundleId
    const app: Record<string, string> = {}
    if (appVersion) app['version'] = appVersion
    if (appBuild) app['build'] = appBuild
    if (bundleId) app['bundleId'] = bundleId
    this.staticMeta = {
      sdk: { name: SDK_NAME, version: SDK_VERSION },
      ...(Object.keys(app).length > 0 ? { app } : {}),
    }
    this.environment = environment

    this.breadcrumb = Object.assign(
      (message: string, opts?: { category?: string; data?: Record<string, string> }): void =>
        this._addBreadcrumb(opts?.category ?? 'info', message, opts?.data),
      {
        info: (message: string, data?: Record<string, string>): void => this._addBreadcrumb('info', message, data),
        navigationTo: (view: string): void => this._addBreadcrumb('navigation', view, { to: view }),
      },
    )

    this.flushTimer = setInterval(() => { void this.flush() }, 15000)
    this._registerGlobalHandlers()
  }

  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId: string | null): void {
    this.currentUserId = userId
  }

  /**
   * Internal hook — used by `OneloFeatures` on the first lookup of each name.
   * High-volume path: aggregated into a per-feature counter and emitted as one
   * `feature_call_summary` event at flush (parity with Swift).
   */
  _trackFeatureCall(featureName: string): void {
    this.summaryBuffer.set(featureName, (this.summaryBuffer.get(featureName) ?? 0) + 1)
  }

  /**
   * Record the current value of a feature flag for flag↔error correlation.
   * Intended to be wired from `OneloFeatures` on every evaluation. LRU:
   * re-recording a key moves it to most-recent; capped at MAX_FLAGS. Not an
   * event — just updates the snapshot attached to future error captures.
   */
  recordFlag(key: string, value: string): void {
    if (this.flags.has(key)) this.flags.delete(key) // move-to-end (LRU)
    this.flags.set(key, value)
    if (this.flags.size > MAX_FLAGS) {
      const oldest = this.flags.keys().next().value
      if (oldest !== undefined) this.flags.delete(oldest)
    }
  }

  async track<T>(featureName: string, fn: () => Promise<T> | T, options?: { meta?: Record<string, unknown> }): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this._push(featureName, true, Date.now() - start, undefined, options?.meta, 'track')
      return result
    } catch (err) {
      const { message, stack, errorType } = _extractError(err)
      this._push(featureName, false, Date.now() - start, message, this._withError(options?.meta, stack, errorType), 'track')
      throw err
    }
  }

  event(featureName: string, opts: MonitorEventOptions): void {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, 'event')
  }

  /**
   * Manually capture an error/exception with its stack + the active breadcrumbs
   * and feature flags (parity with Swift's `capture`). Use for caught errors you
   * still want reported. Never throws.
   */
  capture(error: unknown, opts?: { featureName?: string; meta?: Record<string, unknown> }): void {
    const { message, stack, errorType } = _extractError(error)
    this._push(opts?.featureName ?? 'captured', false, undefined, message, this._withError(opts?.meta, stack, errorType), 'event')
  }

  async flush(): Promise<void> {
    const events = this.buffer.splice(0)
    // Drain the summary counters into one aggregate event per feature. Reset
    // afterwards — next window starts fresh. If the send fails the counts are
    // lost (no retry queue today, same fate as the rest of the buffer).
    for (const [featureName, count] of this.summaryBuffer) {
      if (count > 0) {
        events.push({
          featureName, ok: true, source: 'feature_call_summary',
          meta: { calls: count },
          userId: this.currentUserId ?? undefined,
          platform: PLATFORM, sessionId: this.sessionId,
        })
      }
    }
    this.summaryBuffer.clear()
    if (events.length === 0) return
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
        method: 'POST',
        headers: { ...(await sdkHeaders(this.bundleId)), 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishableKey: this.publishableKey, events }),
      })
    } catch {
      // silently drop — monitoring must never break the app
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    this._unregisterGlobalHandlers()
    void this.flush()
  }

  private _addBreadcrumb(category: string, message: string, data?: Record<string, string>): void {
    this.breadcrumbs.push({
      category,
      message: scrubText(message),
      ts: Date.now(),
      ...(data ? { data } : {}),
    })
    if (this.breadcrumbs.length > MAX_BREADCRUMBS) this.breadcrumbs.shift()
  }

  /** Fold stack/errorType into a caller's meta without mutating it. */
  private _withError(meta: Record<string, unknown> | undefined, stack?: string, errorType?: string): Record<string, unknown> {
    return {
      ...(meta ?? {}),
      ...(stack ? { stack } : {}),
      ...(errorType ? { errorType } : {}),
    }
  }

  /**
   * Returns a NEW meta object with always-on context merged in (parity with
   * Swift's enrichMeta): `sdk` + `app` (authoritative, override caller keys),
   * `environment` (only when the caller didn't set it per-event), and a light
   * `device` block. On error/crash the device block carries heavier fields.
   * Never mutates the caller's meta.
   */
  private _enrich(meta: Record<string, unknown> | undefined, isError: boolean): Record<string, unknown> {
    const out: Record<string, unknown> = { ...(meta ?? {}), ...this.staticMeta }
    if (this.environment != null && out['environment'] == null) out['environment'] = this.environment
    const device = _deviceContext(isError)
    if (Object.keys(device).length > 0) out['device'] = device
    return out
  }

  /** Trim error meta to the ~16KB soft cap: drop oldest breadcrumbs, then flags. Best-effort, never throws. */
  private _capMeta(meta: Record<string, unknown>): Record<string, unknown> {
    const size = (m: Record<string, unknown>): number => {
      try { return JSON.stringify(m).length } catch { return 0 }
    }
    if (size(meta) <= MAX_META_BYTES) return meta
    let out = meta
    if (Array.isArray(out['breadcrumbs'])) {
      const crumbs = (out['breadcrumbs'] as unknown[]).slice()
      while (crumbs.length > 0 && size({ ...out, breadcrumbs: crumbs }) > MAX_META_BYTES) crumbs.shift()
      out = { ...out, breadcrumbs: crumbs }
      if (crumbs.length === 0) { const { breadcrumbs: _b, ...rest } = out; out = rest }
    }
    if (size(out) > MAX_META_BYTES && 'flags' in out) {
      const { flags: _f, ...rest } = out
      out = rest
    }
    if (size(out) > MAX_META_BYTES) out['_onelo_meta_truncated'] = true
    return out
  }

  private _push(
    featureName: string,
    ok: boolean,
    durationMs?: number,
    error?: string,
    meta?: Record<string, unknown>,
    source: EventSource = 'event',
  ): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) this.buffer.shift()
    const isError = !ok || source === 'global_error'
    // On an ERROR, attach the breadcrumb trail BEFORE scrubbing (their string
    // values are free text that may contain secrets). Parity with Swift's
    // _pushError enrichment.
    const enriched = this._enrich(meta, isError)
    if (isError && this.breadcrumbs.length > 0) enriched['breadcrumbs'] = this.breadcrumbs.slice()
    // Scrub secrets before they leave the device (backend re-scrubs too).
    let scrubbed = scrubMeta(enriched)
    // Flags folded in AFTER scrubbing: keys are feature NAMES + values are
    // statuses (never secrets), so scrubbing them would only risk a
    // false-positive redaction of a flag whose name resembles a PII key.
    if (isError && this.flags.size > 0 && scrubbed) {
      scrubbed['flags'] = Object.fromEntries(this.flags)
    }
    // Respect the ~16KB error-meta cap (drop heavy fields if over).
    if (isError && scrubbed) scrubbed = this._capMeta(scrubbed)
    this.buffer.push({
      featureName,
      ok,
      durationMs,
      error: error != null ? scrubText(error) : error,
      meta: scrubbed,
      source,
      userId: this.currentUserId ?? undefined,
      platform: PLATFORM,
      sessionId: this.sessionId,
    })
    if (isError) void this.flush()
  }

  private _registerGlobalHandlers(): void {
    if (_globalHandlersRegistered) return

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ErrorUtils = (globalThis as any)?.ErrorUtils
      if (ErrorUtils?.setGlobalHandler) {
        // Chain the previous handler (RN's red-box / fatal path) so a monitoring
        // SDK never silently suppresses the host's crash behaviour — mirrors
        // Swift chaining to the prior NSException handler. Capture `prev` so
        // `destroy()` can restore it (see _unregisterGlobalHandlers).
        const prev: GlobalErrorHandler | undefined = ErrorUtils.getGlobalHandler?.()
        const handler: GlobalErrorHandler = (err: unknown, isFatal?: boolean) => {
          try {
            const { message, stack, errorType } = _extractError(err)
            this._push('unhandled', false, undefined, message, this._withError(undefined, stack, errorType), 'global_error')
          } catch {
            // never let monitoring break the crash path
          }
          prev?.(err, isFatal)
        }
        ErrorUtils.setGlobalHandler(handler)
        // Flip the flag only AFTER a successful install so that an environment
        // without ErrorUtils (e.g. tests/SSR) doesn't latch `true` and block a
        // later real registration.
        _previousGlobalHandler = prev
        _installedGlobalHandler = handler
        _globalHandlersRegistered = true
        this._registeredGlobalHandler = true
      }
    } catch {
      // ErrorUtils not available in this environment
    }
  }

  /**
   * Restore the ErrorUtils handler that was installed before this monitor
   * registered, and reset the module registration state so a freshly-constructed
   * monitor re-registers (rather than being stuck behind a `true` flag pointing
   * at a torn-down instance). Only the instance that actually installed the
   * handler acts; only restores if OUR handler is still the current one (never
   * clobber a handler someone installed on top of ours). Never throws.
   */
  private _unregisterGlobalHandlers(): void {
    if (!this._registeredGlobalHandler) return
    this._registeredGlobalHandler = false
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ErrorUtils = (globalThis as any)?.ErrorUtils
      if (ErrorUtils?.setGlobalHandler) {
        const current: GlobalErrorHandler | undefined = ErrorUtils.getGlobalHandler?.()
        if (current === _installedGlobalHandler) {
          // Restore the prior handler; if there was none, install a no-op so our
          // (torn-down) handler is guaranteed detached — this mirrors the
          // pre-SDK state (no monitor handler).
          ErrorUtils.setGlobalHandler(_previousGlobalHandler ?? (() => { /* no prior handler */ }))
        }
      }
    } catch {
      // ErrorUtils not available — nothing to restore
    }
    _previousGlobalHandler = undefined
    _installedGlobalHandler = undefined
    _globalHandlersRegistered = false
  }
}
