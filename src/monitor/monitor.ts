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
}

const PLATFORM = 'reactnative'
let _globalHandlersRegistered = false

export class OneloMonitor {
  private readonly publishableKey: string
  private readonly apiUrl: string
  private buffer: BufferedEvent[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null
  private currentUserId: string | null = null

  constructor(publishableKey: string, apiUrl: string) {
    this.publishableKey = publishableKey
    this.apiUrl = apiUrl
    this.flushTimer = setInterval(() => { void this.flush() }, 5000)
    this._registerGlobalHandlers()
  }

  setUserId(userId: string | null): void {
    this.currentUserId = userId
  }

  _trackFeatureCall(featureName: string): void {
    this._push(featureName, true, undefined, undefined, undefined, 'feature_call')
  }

  async track<T>(featureName: string, fn: () => Promise<T> | T): Promise<T> {
    const start = Date.now()
    try {
      const result = await fn()
      this._push(featureName, true, Date.now() - start, undefined, undefined, 'track')
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this._push(featureName, false, Date.now() - start, message, undefined, 'track')
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
      await fetch(`${this.apiUrl}/api/sdk/monitor/events/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
    this.buffer.push({
      featureName, ok, durationMs, error, meta, source,
      userId: this.currentUserId ?? undefined,
      platform: PLATFORM,
    })
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
