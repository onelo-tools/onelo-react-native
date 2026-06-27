export interface MonitorEventOptions {
  ok: boolean
  durationMs?: number
  error?: string
  meta?: Record<string, unknown>
}

type EventSource = 'feature_call' | 'track' | 'event' | 'global_error'

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

const MAX_BUFFER_SIZE = 200

const PLATFORM = 'reactnative'
let _globalHandlersRegistered = false

export class OneloMonitor {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private readonly bundleId?: string
  private buffer: BufferedEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private currentUserId: string | null = null
  private readonly sessionId: string = (() => {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40  // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80  // variant
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  })()

  constructor(publishableKey: string, apiUrl: string, bundleId?: string) {
    this.publishableKey = publishableKey
    this.apiUrl = apiUrl
    this.bundleId = bundleId
    this.flushTimer = setInterval(() => { void this.flush() }, 15000)
    this._registerGlobalHandlers()
  }

  /** Sets the current user ID attached to all subsequent monitor events. Call after login/logout if not using Onelo Auth. */
  setUserId(userId: string | null): void {
    this.currentUserId = userId
  }

  _trackFeatureCall(featureName: string): void {
    this._push(featureName, true, undefined, undefined, undefined, 'feature_call')
  }

  async track<T>(featureName: string, fn: () => Promise<T> | T, options?: { meta?: Record<string, unknown> }): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this._push(featureName, true, Date.now() - start, undefined, options?.meta, 'track')
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this._push(featureName, false, Date.now() - start, message, options?.meta, 'track')
      throw err
    }
  }

  event(featureName: string, opts: MonitorEventOptions): void {
    this._push(featureName, opts.ok, opts.durationMs, opts.error, opts.meta, 'event')
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0) return
    const events = this.buffer.splice(0)
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
        method: 'POST',
        headers: { ...sdkHeaders(this.bundleId), 'Content-Type': 'application/json' },
        body: JSON.stringify({ publishableKey: this.publishableKey, events }),
      })
    } catch {
      // silently drop
    }
  }

  destroy(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer)
      this.flushTimer = null
    }
    void this.flush()
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
    this.buffer.push({
      featureName, ok, durationMs, error, meta, source,
      userId: this.currentUserId ?? undefined,
      platform: PLATFORM,
      sessionId: this.sessionId,
    })
    if (!ok || source === 'global_error') {
      void this.flush()
    }
  }

  private _registerGlobalHandlers(): void {
    if (_globalHandlersRegistered) return
    _globalHandlersRegistered = true

    const handler = (error: string) => {
      this._push('unhandled', false, undefined, error, undefined, 'global_error')
      void this.flush()
    }

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ErrorUtils = (globalThis as any)?.ErrorUtils
      if (ErrorUtils?.setGlobalHandler) {
        ErrorUtils.setGlobalHandler((err: Error) => handler(err.message))
      }
    } catch {
      // ErrorUtils not available in this environment
    }
  }
}
