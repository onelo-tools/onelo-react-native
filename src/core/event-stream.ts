import { sdkHeaders } from '../sdk-headers'
import { getInstanceId } from './instance-id'

/**
 * OneloEventStream — ONE persistent SSE connection to
 * `GET /api/sdk/features/stream`, multiplexed for every module that needs
 * server-pushed events (auth `session.revoked`, `legal.consent_required`,
 * feature deploys, …). Mirrors the Swift `OneloEventStream`: a single
 * connection per app, a name→handlers registry, bounded-backoff reconnection,
 * and a refusal to downgrade a user-bound stream back to anonymous.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY XMLHttpRequest, NOT fetch/EventSource
 * ─────────────────────────────────────────────────────────────────────────
 * React Native has no `EventSource`, and its `fetch` does NOT expose
 * `response.body.getReader()` (no WHATWG `ReadableStream`) — so the
 * chunk-reader pattern used by the browser JS SDK (`onelo-js`) is impossible
 * here. Instead we drive an `XMLHttpRequest` and parse its INCREMENTALLY
 * growing `responseText`: on every `onprogress` / `readyState===LOADING`
 * callback RN hands us the bytes received so far, we parse only the delta
 * since the last offset, split on newlines, run the WHATWG `event:`/`data:`
 * accumulation, and dispatch on the blank line.
 *
 * This flushes PER TCP PACKET — the same guarantee Swift gets from its
 * `URLSessionDataDelegate.didReceive(data:)` loop. We deliberately do NOT
 * pull in `react-native-sse` or any line-buffering helper: those buffer until
 * an internal threshold and swallow small events (heartbeats, `session.revoked`
 * ~120 B) for tens of seconds — the exact trap the Swift/JS clients avoid.
 * Zero new dependencies.
 *
 * Unlike a browser `EventSource`, an RN `XMLHttpRequest` CAN set request
 * headers, so we apply `sdkHeaders()` (X-SDK-Version / X-Bundle-Id / …) to the
 * stream request just like Swift's `applySecurityHeaders`.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * OWNERSHIP
 * ─────────────────────────────────────────────────────────────────────────
 * Lifecycle is owned by ONE module (auth — it knows sign-in/sign-out).
 * Other modules (features) are INJECTED the same instance and only `on()` +
 * `updateSinceVersion()`; they never `start()`/`stop()`. Only the owner
 * reconnects, so nothing races `session.revoked`.
 */
export type SseHandler = (data: Record<string, unknown>) => void

/** Optional overrides for {@link OneloEventStream.start}. Any omitted field keeps its current value. */
export interface OneloEventStreamStartParams {
  /** Authenticated user id (camelCase on the wire). `null`/omitted = anonymous. */
  userId?: string | null
  /** `since_version` cursor for the features snapshot. Omitted = keep current. */
  sinceVersion?: number
  /** Host app version (`app_version`). Omitted = keep current. */
  appVersion?: string
  /** Host-supplied HMAC of the user id for secure-mode features (camelCase `userIdHash`). */
  userIdHash?: string
}

// Bounded backoff — near-instant recovery for a WiFi blip, no tight loop on a
// hard failure. Verbatim from the Swift/JS clients: [1, 2, 5, 10, 30]s.
const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000]
/** Minimum gap between reconnects — floors the full-jitter delay so a flapping
 *  connection (or a reset backoff counter) can never produce a hot reconnect loop. */
const RECONNECT_FLOOR_MS = 500

// XMLHttpRequest.readyState constants (avoid depending on the static enum,
// which is not guaranteed on every RN XHR polyfill).
const HEADERS_RECEIVED = 2
const LOADING = 3
const DONE = 4

export class OneloEventStream {
  private readonly handlers = new Map<string, SseHandler[]>()

  // Connection state.
  private xhr: XMLHttpRequest | null = null
  private started = false
  /** epoch-ms the current XHR was opened; used to decide if a dropped connection
   *  was stable (alive long enough) before resetting the reconnect counter. */
  private connOpenedAt = 0
  private destroyed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Query identity — the current values sent on the NEXT (re)connect.
  private userId: string | null = null
  private userIdHash: string | undefined = undefined
  private sinceVersion = 0
  private appVersion: string | undefined = undefined

  /**
   * Explicit feature environment ('test' | 'live') forwarded as the
   * `environment` query param. Set once by OneloFeatures; constant for the
   * stream's lifetime, so it is intentionally NOT part of start()'s idempotency
   * comparison (parity with Swift's `featureEnvironment`).
   */
  featureEnvironment: string | undefined = undefined

  /**
   * Epoch-ms timestamp of the last byte received from the server (named event
   * OR `:keepalive` comment). A liveness signal — a consumer can compare it to
   * `Date.now()` to detect a silently dead connection. `null` until first byte.
   */
  lastEventReceived: number | null = null

  // Incremental-parse state (reset on every fresh connection).
  private offset = 0
  private currentEvent = ''
  private dataLines: string[] = []

  /**
   * Monotonic connection generation. Bumped on every close/(re)connect so an
   * async connection-open that was awaiting `getInstanceId()`/`sdkHeaders()` can
   * detect it was superseded (or the stream stopped) and bail before opening a
   * now-orphaned socket.
   */
  private connGen = 0

  /**
   * @param apiUrl          Base API URL (no trailing slash), e.g. `https://st.backend.onelo.tools`.
   * @param publishableKey  `onelo_pk_...` — authenticates the stream via the `key` query param.
   * @param sdkVersion      SDK version string, forwarded as `sdk_version`.
   * @param bundleId        Host app bundle id, forwarded via `sdkHeaders()` as `X-Bundle-Id`.
   *
   * The `instance_id` query param + `X-Onelo-Instance-Id` header are sourced
   * internally from `getInstanceId()` (Keychain-backed, cached) — no wiring
   * needed from the caller.
   */
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly sdkVersion?: string,
    private readonly bundleId?: string,
  ) {}

  /**
   * Register a handler for a named server event (`connected`, `features_updated`,
   * `session.revoked`, `legal.consent_required`, …). Multiple handlers per name
   * are supported; all fire. Survives reconnects. Register BEFORE `start()` (in a
   * module constructor) so no event is missed between connect and sign-in.
   */
  on(event: string, handler: SseHandler): void {
    const arr = this.handlers.get(event) ?? []
    arr.push(handler)
    this.handlers.set(event, arr)
  }

  /**
   * Open (or re-open) the connection.
   *
   * Idempotent: a repeat call with identical params while already connected is a
   * no-op (no needless reconnect). A changed userId / userIdHash / sinceVersion /
   * appVersion reconnects so per-user routing stays correct.
   *
   * Downgrade refusal: once bound to a non-null userId, a `start({userId: null})`
   * is IGNORED. An anonymous-mode reload (e.g. features bootstrap) must not evict
   * the auth-bound subscription — otherwise an in-flight `session.revoked` during
   * the reconnect window vanishes and the user stays logged in until the heartbeat
   * fallback (~13 min). Explicit teardown still works via `stop()`.
   */
  start(params: OneloEventStreamStartParams = {}): void {
    if (this.destroyed) return
    const nextUserId = params.userId ?? null

    if (this.started && this.userId !== null && nextUserId === null) {
      // Downgrade to anonymous while bound — refuse.
      return
    }

    // Omitted fields keep their current value (auth may start() with only a
    // userId while features owns sinceVersion via updateSinceVersion()).
    const nextSinceVersion = params.sinceVersion ?? this.sinceVersion
    const nextAppVersion = params.appVersion ?? this.appVersion
    const nextUserIdHash = params.userIdHash ?? this.userIdHash

    const changed =
      !this.started ||
      nextUserId !== this.userId ||
      nextUserIdHash !== this.userIdHash ||
      nextSinceVersion !== this.sinceVersion ||
      nextAppVersion !== this.appVersion

    this.userId = nextUserId
    this.userIdHash = nextUserIdHash
    this.sinceVersion = nextSinceVersion
    this.appVersion = nextAppVersion
    this.started = true

    if (changed) this._connect()
  }

  /**
   * Update the `since_version` cursor used on the NEXT reconnect. Does NOT force
   * a reconnect — the live connection keeps serving; if it drops, the reconnect
   * picks up the new value (parity with Swift `updateSinceVersion`).
   */
  updateSinceVersion(version: number): void {
    this.sinceVersion = version
  }

  /**
   * Close the connection and cancel any pending reconnect. Intentional stop:
   * NO reconnect follows (the in-flight XHR's callbacks are detached first, so
   * its abort cannot re-arm the backoff). Handlers stay registered — `start()`
   * resumes delivery.
   */
  stop(): void {
    this.started = false
    this._clearReconnect()
    this._closeXhr()
  }

  /**
   * Permanent teardown — detaches the connection and forbids restart. Use from
   * `Onelo.destroy()`. After `destroy()`, `start()` is a no-op.
   */
  destroy(): void {
    this.destroyed = true
    this.stop()
  }

  // ── Connection ────────────────────────────────────────────────────────────

  private _connect(): void {
    if (this.destroyed || !this.started) return
    // A fresh connection supersedes any pending backoff timer, so a stale timer
    // can't tear down this connection a moment later.
    this._clearReconnect()
    this._closeXhr() // bumps connGen → invalidates any in-flight _openXhr

    // Reset the incremental parser for the new (independent) responseText.
    this.offset = 0
    this.currentEvent = ''
    this.dataLines = []

    // Opening needs the (async, Keychain-backed) instance id + security headers.
    // Capture the current generation so a connect/stop that lands while we await
    // supersedes this one.
    const gen = this.connGen
    void this._openXhr(gen)
  }

  private async _openXhr(gen: number): Promise<void> {
    // getInstanceId never throws (degrades to a fresh non-persisted id).
    // sdkHeaders may throw only if a future header source does — degrade to the
    // minimal SSE headers so the stream still connects (instance id also rides
    // the query param, so identity survives even without the header).
    let instanceId = ''
    let securityHeaders: Record<string, string> = {}
    try {
      instanceId = await getInstanceId()
    } catch { /* omit the param — backend TOFU will just not bind this packet */ }
    try {
      securityHeaders = await sdkHeaders(this.bundleId)
    } catch { securityHeaders = {} }

    // Superseded (newer connect) or torn down (stop/destroy) while awaiting.
    if (gen !== this.connGen || this.destroyed || !this.started) return

    const url = this._buildUrl(instanceId)
    const xhr = new XMLHttpRequest()
    this.xhr = xhr

    // Per-connection guards captured in the closures below.
    let ended = false
    let statusChecked = false
    let statusOk = false

    const end = (reconnect: boolean): void => {
      if (ended) return
      ended = true
      if (this.xhr === xhr) this.xhr = null
      // Detach so a post-abort callback can't fire again.
      xhr.onprogress = null
      xhr.onreadystatechange = null
      xhr.onerror = null
      xhr.ontimeout = null
      xhr.onabort = null
      if (reconnect && !this.destroyed && this.started) this._scheduleReconnect()
    }

    // Validate the HTTP status once headers are available. A non-200 (e.g. a
    // transient 5xx, or a 401/403 on a revoked key) is treated as transient →
    // backoff reconnect, mirroring Swift (which finishes-with-error and lets the
    // reconnect loop retry). The 30s backoff cap keeps even a permanent 401 from
    // hot-looping.
    const checkStatus = (): boolean => {
      if (statusChecked) return statusOk
      if (xhr.readyState < HEADERS_RECEIVED) return false
      statusChecked = true
      statusOk = xhr.status === 200
      if (!statusOk) {
        try { xhr.abort() } catch { /* ignore */ }
        end(true)
      }
      return statusOk
    }

    // Parse whatever new bytes RN has appended to responseText.
    const pump = (): void => {
      if (ended || this.xhr !== xhr) return
      if (!checkStatus()) return
      const text = xhr.responseText
      if (typeof text === 'string' && text.length > this.offset) {
        // Any byte (incl. :keepalive) proves liveness for the healthcheck. We do
        // NOT reset the reconnect counter here — a "connect → 1 byte → drop" flap
        // would otherwise defeat backoff. The counter resets in _scheduleReconnect
        // only when the previous connection stayed open long enough to be stable.
        this.lastEventReceived = Date.now()
        this._consume(text)
      }
    }

    xhr.onreadystatechange = (): void => {
      if (this.xhr !== xhr) return
      if (xhr.readyState >= HEADERS_RECEIVED) checkStatus()
      if (xhr.readyState >= LOADING) pump()
      if (xhr.readyState === DONE) end(true) // server closed the stream → reconnect
    }
    xhr.onprogress = (): void => { pump() }
    xhr.onerror = (): void => { if (this.xhr === xhr) end(true) }
    xhr.ontimeout = (): void => { if (this.xhr === xhr) end(true) }

    try {
      xhr.open('GET', url, true)
      const headers: Record<string, string> = {
        ...securityHeaders,
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      }
      for (const [k, v] of Object.entries(headers)) {
        try { xhr.setRequestHeader(k, v) } catch { /* ignore an invalid header name */ }
      }
      xhr.send()
      this.connOpenedAt = Date.now()
    } catch {
      // open()/send() can throw on a malformed URL — treat as transient.
      end(true)
    }
  }

  /**
   * Drain complete lines from the cumulative responseText, advancing `offset` to
   * the start of the trailing incomplete line so the next chunk continues cleanly.
   *
   * NOTE (memory): `responseText` grows for the life of ONE connection — RN gives
   * no way to truncate it. `:keepalive` comments are tiny, so growth is slow, and
   * every reconnect starts a fresh XHR with an empty responseText (offset reset).
   * A very long-lived, chatty connection is the only case that accumulates; the
   * backend's periodic connection recycling bounds it in practice.
   */
  private _consume(fullText: string): void {
    let searchFrom = this.offset
    for (;;) {
      const nl = fullText.indexOf('\n', searchFrom)
      if (nl === -1) break
      let line = fullText.slice(searchFrom, nl)
      if (line.endsWith('\r')) line = line.slice(0, -1) // strip trailing CR per EventSource spec
      this._processLine(line)
      searchFrom = nl + 1
    }
    this.offset = searchFrom
  }

  /** WHATWG SSE line parser (event/data accumulation; dispatch on blank line). */
  private _processLine(line: string): void {
    if (line === '') {
      // Blank line = dispatch the accumulated event.
      if (this.dataLines.length > 0) {
        this._dispatch(this.currentEvent, this.dataLines.join('\n'))
      }
      this.currentEvent = ''
      this.dataLines = []
      return
    }
    if (line.startsWith(':')) return // comment / keepalive — ignore (liveness already recorded)

    const colon = line.indexOf(':')
    let field: string
    let value: string
    if (colon === -1) {
      // WHATWG: a line with no colon = the whole line is the field, value is empty.
      field = line
      value = ''
    } else {
      field = line.slice(0, colon)
      value = line.slice(colon + 1)
      if (value.startsWith(' ')) value = value.slice(1) // strip one leading space after colon
    }

    switch (field) {
      case 'event':
        this.currentEvent = value
        break
      case 'data':
        this.dataLines.push(value)
        break
      // `id` / `retry` are unused by Onelo today.
      default:
        break
    }
  }

  /** Decode the JSON payload and fan out to every handler registered for the event name. */
  private _dispatch(type: string, payload: string): void {
    // Parity with Swift: an unnamed event is dropped (the backend always names
    // its events; an empty type is only ever a stray/comment artifact).
    if (type === '') return
    const list = this.handlers.get(type)
    if (list === undefined || list.length === 0) return

    let data: Record<string, unknown> = {}
    if (payload.length > 0) {
      try {
        data = JSON.parse(payload) as Record<string, unknown>
      } catch {
        // Some events carry an empty/non-JSON payload — hand the handler `{}`.
      }
    }
    for (const handler of list) {
      try { handler(data) } catch { /* a handler error must never break the stream */ }
    }
  }

  private _buildUrl(instanceId: string): string {
    // Build the query string by hand: RN's URLSearchParams support is partial and
    // historically buggy (`.toString()`), so we avoid it entirely.
    const parts: string[] = []
    const add = (k: string, v: string): void => { parts.push(`${k}=${encodeURIComponent(v)}`) }

    add('key', this.publishableKey)
    add('since_version', String(this.sinceVersion))
    if (instanceId) add('instance_id', instanceId)
    add('sdk_platform', 'react-native')
    if (this.sdkVersion) add('sdk_version', this.sdkVersion)
    if (this.appVersion) add('app_version', this.appVersion)
    if (this.featureEnvironment) add('environment', this.featureEnvironment)
    if (this.userId) add('userId', this.userId)
    if (this.userIdHash) add('userIdHash', this.userIdHash)

    return `${this.apiUrl}/api/sdk/features/stream?${parts.join('&')}`
  }

  private _scheduleReconnect(): void {
    if (this.destroyed || !this.started) return
    this._clearReconnect()
    // Reset backoff only if the connection that just dropped stayed open long
    // enough to be considered stable (> the max backoff tier). A rapid
    // connect→drop flap keeps the counter climbing → proper exponential backoff.
    const maxTier = RECONNECT_DELAYS_MS[RECONNECT_DELAYS_MS.length - 1]
    if (this.connOpenedAt > 0 && Date.now() - this.connOpenedAt > maxTier) {
      this.reconnectAttempts = 0
    }
    this.connOpenedAt = 0
    const base = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)]
    this.reconnectAttempts++
    // Full jitter over [floor, base) — a floor prevents a near-instant reconnect
    // storm; jitter desynchronises a fleet reconnecting after a backend bounce.
    const delay = Math.max(RECONNECT_FLOOR_MS, Math.floor(Math.random() * base))
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this._connect()
    }, delay)
  }

  private _clearReconnect(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
  }

  /**
   * Intentional close. Detaching `this.xhr` BEFORE `abort()` means the abort's
   * `onreadystatechange(DONE)` / `onerror` see `this.xhr !== xhr` and bail — so a
   * user-driven stop never re-arms the reconnect backoff.
   */
  private _closeXhr(): void {
    // Invalidate any in-flight async open (awaiting getInstanceId/sdkHeaders).
    this.connGen++
    const xhr = this.xhr
    if (xhr === null) return
    this.xhr = null
    xhr.onprogress = null
    xhr.onreadystatechange = null
    xhr.onerror = null
    xhr.ontimeout = null
    xhr.onabort = null
    try { xhr.abort() } catch { /* ignore */ }
  }
}
