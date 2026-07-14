import { httpPost, httpGet } from '@onelo/core'
import type { OneloEventStream } from '../core/event-stream'
import { loadFeatureCache, saveFeatureCache } from './feature-cache'

export type FeatureStatus =
  | 'enabled'
  | 'disabled'
  | 'greyed'
  | 'hidden'
  | 'upsell'
  | 'new'
  | 'beta'
  | 'coming_soon'

// Forward-compat: a status from a NEWER backend that this SDK doesn't recognize
// must fail CLOSED → 'hidden' (mirrors Swift's `guard FeatureStatus(rawValue:)
// else { drop }` → default `.hidden`). Fail-open (keeping the unknown string)
// would render a broken affordance as VISIBLE, since `FeatureState.isVisible`
// is `status !== 'hidden'`.
const KNOWN_STATUSES = new Set<string>([
  'enabled', 'disabled', 'greyed', 'hidden', 'upsell', 'new', 'beta', 'coming_soon',
])
function normalizeStatus(status: string): FeatureStatus {
  return (KNOWN_STATUSES.has(status) ? status : 'hidden') as FeatureStatus
}

/** Why a feature is in its current state. Forward-compatible: an unrecognized
 * reason from a newer backend normalizes to 'unknown' (mirrors Swift, where a
 * present-but-unknown reason once dropped the whole feature). */
export type FeatureReason =
  | 'user_override' | 'plan' | 'default' | 'static'
  | 'paywall_no_plan' | 'paywall_off' | 'suspended' | 'unknown'
const KNOWN_REASONS = new Set<string>([
  'user_override', 'plan', 'default', 'static', 'paywall_no_plan', 'paywall_off', 'suspended', 'unknown',
])
function normalizeReason(reason: string | undefined): FeatureReason | undefined {
  if (reason == null) return undefined
  return (KNOWN_REASONS.has(reason) ? reason : 'unknown') as FeatureReason
}

/** Upgrade affordance derived from reason + requiredPlan; null when the feature
 * is available or not plan-gated. */
export interface UpgradeHint {
  requiredPlan: string
  currentStatus: FeatureStatus
}

// Wire shape of a /resolve, /poll, or SSE per-feature entry (snake_case from
// backend). Forward-compatible: unknown fields ignored; reason/plan/cta optional.
interface FeatureWire {
  status: string
  reason?: string
  required_plan?: string
  required_plan_label?: string
  upgrade_cta?: boolean
}
// Normalized internal cache entry (camelCase, validated).
interface FeatureEntry {
  status: FeatureStatus
  reason?: FeatureReason
  requiredPlan?: string
  requiredPlanLabel?: string
  upgradeCta: boolean
}
function wireToEntry(w: FeatureWire): FeatureEntry {
  return {
    status: normalizeStatus(w.status),
    reason: normalizeReason(w.reason),
    requiredPlan: w.required_plan,
    requiredPlanLabel: w.required_plan_label,
    upgradeCta: w.upgrade_cta ?? false,
  }
}

export class FeatureState {
  readonly name: string
  readonly status: FeatureStatus
  /** Why the feature is in this state (plan-gated, user override, …). */
  readonly reason?: FeatureReason
  /** Machine key of the plan that unlocks this feature — render the label. */
  readonly requiredPlan?: string
  /** Human display name of `requiredPlan` — render this, not the raw key. */
  readonly requiredPlanLabel?: string
  /** The developer enabled "tap to upgrade" for this feature. */
  readonly upgradeCta: boolean

  constructor(
    name: string,
    status: FeatureStatus,
    reason?: FeatureReason,
    requiredPlan?: string,
    requiredPlanLabel?: string,
    upgradeCta = false,
  ) {
    this.name = name
    this.status = status
    this.reason = reason
    this.requiredPlan = requiredPlan
    this.requiredPlanLabel = requiredPlanLabel
    this.upgradeCta = upgradeCta
  }

  get isEnabled(): boolean { return this.status === 'enabled' || this.status === 'new' || this.status === 'beta' }
  get isDisabled(): boolean { return this.status === 'disabled' }
  get isVisible(): boolean { return this.status !== 'hidden' }
  get isGreyed(): boolean { return this.status === 'greyed' }
  get isUpsell(): boolean { return this.status === 'upsell' }
  get isNew(): boolean { return this.status === 'new' }
  get isBeta(): boolean { return this.status === 'beta' }
  get isComingSoon(): boolean { return this.status === 'coming_soon' }

  /** Promo/lock badge (parity with Swift): New/Beta/Coming Soon, 🔒 for greyed
   *  (locked — never hide it), and "Available in <plan>" for upsell. */
  get badgeLabel(): string | null {
    switch (this.status) {
      case 'new': return 'New'
      case 'beta': return 'Beta'
      case 'coming_soon': return 'Coming Soon'
      case 'greyed': return '🔒'
      case 'upsell':
        if (this.requiredPlanLabel) return `Available in ${this.requiredPlanLabel}`
        if (this.requiredPlan) return `Available in ${this.requiredPlan}`
        return 'Upgrade'
      default: return null
    }
  }

  /** Non-null when the feature is plan-blocked AND the backend named the
   *  unlocking plan — surface in upgrade-prompt UI. */
  get upgradeHint(): UpgradeHint | null {
    if (
      this.reason === 'plan' &&
      this.requiredPlan &&
      (this.status === 'greyed' || this.status === 'hidden' || this.status === 'upsell' || this.status === 'coming_soon')
    ) {
      return { requiredPlan: this.requiredPlan, currentStatus: this.status }
    }
    return null
  }
}

/** Error thrown by {@link OneloFeatures.moduleToken}. `code` mirrors the Swift
 *  `OneloFeaturesError` cases and the JS SDK's `OneloFeaturesError` so
 *  cross-platform handling/docs line up 1:1. RN core's `OneloError` has no
 *  feature-specific codes (not_entitled / secure_mode_required / …), so — like
 *  the JS SDK — we define a module-scoped error class rather than overloading
 *  the shared `OneloError` with codes only Features uses. */
export type OneloFeaturesErrorCode =
  | 'not_authenticated'    // moduleToken() called before identify()/sign-in
  | 'not_entitled'         // 403 — current user lacks access to the slug
  | 'secure_mode_required' // 401 — app requires userIdHash, none supplied
  | 'invalid_user_hash'    // 401 — supplied userIdHash failed HMAC on the backend
  | 'network_error'        // transport failure or malformed response

export class OneloFeaturesError extends Error {
  constructor(readonly code: OneloFeaturesErrorCode, message?: string) {
    super(message ?? code)
    this.name = 'OneloFeaturesError'
    // Restore the prototype chain so `instanceof` holds under down-level targets.
    Object.setPrototypeOf(this, OneloFeaturesError.prototype)
  }
}

// SSE-less fallback poll cadence. When the shared SSE stream is live (signed-in),
// polling is suppressed — the stream delivers deploys instantly and features must
// never reconnect a stream it doesn't own. Retained only for the anonymous /
// no-stream (standalone/test) path.
const POLL_INTERVAL_MS = 60_000
// refresh() coalesces bursts to one REST call/sec unless force=true (parity with
// Swift `_refreshDebounce`).
const REFRESH_DEBOUNCE_MS = 1000

// Disk-cache key prefix — mirrors Swift `io.onelo.features.<pk>.<userId||anon>`.
const CACHE_KEY_PREFIX = 'io.onelo.features'

/** v2 disk shape (snake_case, mirrors Swift `_writeCache`): persists the FULL
 *  entry so a cold-start `up_to_date` (no fresh snapshot) still renders upgrade
 *  badges. A bare status string is tolerated on read for v1 back-compat. */
interface CachedSnapshot {
  config_version: number
  features: Record<string, FeatureWire | string>
}

export interface OneloFeaturesOptions {
  /** Suppress the anonymous-mode identify() warning. See OneloConfig.suppressIdentifyWarning. */
  suppressIdentifyWarning?: boolean
  /** Explicit feature environment ('test'|'live'), forwarded on resolve/batch-ping/poll. See OneloConfig.featureEnvironment. */
  featureEnvironment?: string
  /** Status returned by feature() for a slug not (yet) in the snapshot. Fail-closed
   *  'hidden' by default; 'enabled' in dev previews new gates. 1:1 with Swift
   *  `featureDefaultStatus`. See OneloConfig.featureDefaultStatus. */
  featureDefaultStatus?: FeatureStatus
}

/** Minimal monitor surface OneloFeatures depends on. `recordFlag` is optional —
 *  present once Monitor gains flag↔error correlation (parity task 3.2); called
 *  defensively so this module works against a monitor that doesn't yet have it. */
interface FeaturesMonitor {
  _trackFeatureCall: (name: string) => void
  recordFlag?: (key: string, value: string) => void
}

export class OneloFeatures {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly bundleId?: string
  private readonly featureEnvironment?: string
  private cache: Map<string, FeatureEntry> = new Map()
  // In-memory observers notified AFTER any cache change (SSE Deploy push,
  // foreground/identity resync, invalidateCache). Purely local fan-out — no
  // network, no DB, no extra SSE (reuses the one shared stream).
  private readonly changeListeners = new Set<() => void>()
  private discoveredNames: Set<string> = new Set()
  private configVersion = 0
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pingDebounce: ReturnType<typeof setTimeout> | null = null
  private monitor: FeaturesMonitor | null = null
  private suppressIdentifyWarning: boolean
  private anonymousWarningLogged = false
  // Status returned by feature() for a slug not in the snapshot (default 'hidden').
  private readonly defaultStatus: FeatureStatus
  private currentUserId: string | null = null
  // Secure-mode targeting hash (HMAC of userId, computed on the DEV's server and
  // forwarded here — the SDK never holds the secret). Threaded into
  // resolve / batch-ping / module-token.
  private currentUserIdHash: string | null = null
  // Shared multiplexed SSE stream — INJECTED by Onelo (composition root) via
  // attachEventStream(). Features NEVER calls start()/stop() on it: auth owns the
  // lifecycle (starts it on sign-in, stops on sign-out). Null in standalone use /
  // tests, where load() falls back to a one-shot resolve + 60s poll.
  private stream: OneloEventStream | null = null
  // ready() cold-start sync — resolved on the first applied snapshot or timeout
  // (parity with Swift firstEventReceived + readyWaiters).
  private firstEventReceived = false
  private readonly readyWaiters = new Set<() => void>()
  // refresh() debounce cursor (parity with Swift lastRefreshAt).
  private lastRefreshAt = 0

  constructor(
    apiUrl: string,
    publishableKey: string,
    monitor?: FeaturesMonitor | null,
    bundleId?: string,
    options?: OneloFeaturesOptions,
  ) {
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.monitor = monitor ?? null
    this.bundleId = bundleId
    this.suppressIdentifyWarning = options?.suppressIdentifyWarning ?? false
    this.featureEnvironment = options?.featureEnvironment
    this.defaultStatus = options?.featureDefaultStatus ?? 'hidden'
  }

  /**
   * Wire the shared multiplexed SSE stream (called once by Onelo). Registers the
   * four feature-side handlers; handlers survive reconnects and receive the
   * already-parsed event `data`. Does NOT start the stream — auth owns its
   * lifecycle (parity with Swift `ownsEventStream = false`).
   */
  attachEventStream(stream: OneloEventStream): void {
    this.stream = stream
    // `featureEnvironment` is constant for the stream's lifetime — set as a
    // property so the SSE snapshot matches what /resolve returns. Safe on a
    // shared stream: only the features endpoint reads `environment`.
    if (this.featureEnvironment) stream.featureEnvironment = this.featureEnvironment

    // `connected` (client behind) and `features_updated` (admin Deploy) both
    // carry a fresh snapshot; `up_to_date` just confirms the version.
    const applyIfSnapshot = (data: Record<string, unknown>): void => {
      const features = data['features'] as Record<string, FeatureWire> | undefined
      if (features) {
        const v = typeof data['config_version'] === 'number' ? (data['config_version'] as number) : this.configVersion
        this._applySnapshot(v, features)
      }
    }
    stream.on('connected', (data) => {
      applyIfSnapshot(data)
      this._maybeWarnAnonymous(data)
      this._signalFirstEvent()
    })
    stream.on('features_updated', applyIfSnapshot)
    stream.on('up_to_date', (data) => {
      if (typeof data['config_version'] === 'number') this.configVersion = data['config_version'] as number
      this._signalFirstEvent()
    })
    // Dashboard "Discover Features" pushes `discovery_requested` over SSE to force
    // connected clients to re-send a batch-ping (registering newly-referenced
    // slugs). Without a registered handler the stream never subscribes to the
    // event, so the dashboard button silently no-ops. Debounced ping (unsampled —
    // this is an explicit discovery signal, not a load-time bump).
    stream.on('discovery_requested', () => this._scheduleBatchPing())
  }

  /** Declare feature names upfront — triggers a batch-ping immediately. */
  declare(names: string[]): void {
    for (const name of names) this.discoveredNames.add(name)
    this._scheduleBatchPing()
  }

  /** Returns the current state for a feature. Auto-registers on first call. */
  feature(name: string): FeatureState {
    const isNew = !this.discoveredNames.has(name)
    this.discoveredNames.add(name)
    if (isNew) this.monitor?._trackFeatureCall(name)
    if (isNew) this._scheduleBatchPing()
    const entry = this.cache.get(name)
    const status = entry?.status ?? this.defaultStatus
    // Record the flag value on EVERY evaluation (not just first) so Monitor's
    // flag↔error correlation reflects the state at error time (parity w/ Swift).
    this.monitor?.recordFlag?.(name, status)
    return new FeatureState(name, status, entry?.reason, entry?.requiredPlan, entry?.requiredPlanLabel, entry?.upgradeCta ?? false)
  }

  /** Convenience: `true` when the feature resolves to an active status
   *  (enabled / new / beta). Equivalent to `feature(name).isEnabled`. */
  isEnabled(name: string): boolean {
    return this.feature(name).isEnabled
  }

  /**
   * Subscribe to feature-cache changes so the UI can re-render the instant a fresh
   * snapshot lands — an admin's Deploy (SSE), a foreground/identity resync, or
   * `invalidateCache()`. The callback fires AFTER the in-memory cache is updated;
   * re-read `feature(name)` inside it. Purely local: NO network request, NO DB, NO
   * extra SSE connection — it reuses the single shared stream you already have.
   * Returns an unsubscribe function; call it on unmount. Powers the reactive
   * `useFeature` hook shown in the SDK snippet.
   */
  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener)
    return () => { this.changeListeners.delete(listener) }
  }

  /** Notify subscribers after a cache mutation. A throwing listener never breaks
   *  cache application (parity with the modal-state / monitor listener guards). */
  private _emitChange(): void {
    for (const l of [...this.changeListeners]) {
      try { l() } catch { /* a listener must never break cache application */ }
    }
  }

  /**
   * Load features for a user (or anonymous). Called by the Onelo orchestrator on
   * construction, identity change, and app-foreground. Restores the disk cache
   * for instant UI, sends a (sampled) batch-ping, then either relies on the
   * shared SSE stream (signed-in) or falls back to a one-shot REST resolve + 60s
   * poll (anonymous / standalone).
   */
  async load(userId: string | null, userIdHash?: string | null): Promise<void> {
    this.currentUserId = userId
    this.currentUserIdHash = userIdHash ?? null
    await this._loadCache(userId)
    if (this._shouldBatchPingOnLoad()) await this._batchPing()

    // Any prior fallback poll must stop before we decide the new path — a
    // sign-in (anonymous→user) hands live updates to SSE and must cancel the
    // anonymous poll.
    this._stopPollTimer()

    if (this.stream && userId != null) {
      // Signed-in: the shared SSE stream (started by auth on sign-in) delivers
      // the snapshot + live deploys. We do NOT start it. Mirror our cache
      // version into the stream so the auth-driven reconnect carries the right
      // `since_version`. A debounced REST refresh runs in parallel to reconcile
      // instantly on foreground/identity change (parity with Swift
      // `_resyncOnLifecycle`, which RN routes through load()).
      this.stream.updateSinceVersion(this.configVersion)
      await this.refresh()
    } else {
      // Anonymous, or no stream wired (standalone/tests): one-shot resolve for
      // correct initial state + a 60s poll as the live-update fallback.
      await this._resolve(userId)
      this._startPolling(userId)
    }
  }

  /** Returns names of all features with an active status (enabled, new, or beta). */
  getActiveFeatures(): string[] {
    const active: string[] = []
    for (const [name, entry] of this.cache) {
      if (entry.status === 'enabled' || entry.status === 'new' || entry.status === 'beta') {
        active.push(name)
      }
    }
    return active
  }

  /**
   * Resolves once the first live snapshot has been applied (SSE `connected` /
   * `up_to_date`, or a REST resolve), or after `timeoutMs` — whichever first.
   * Never rejects. Lets a host await a settled state before first paint to avoid
   * a cache→SSE flicker. Parity with Swift `ready(timeout:)`. Multiple callers
   * resolve together on the first event (or each on its own timeout).
   */
  ready(timeoutMs = 1500): Promise<void> {
    if (this.firstEventReceived) return Promise.resolve()
    return new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        this.readyWaiters.delete(finish)
        resolve()
      }
      this.readyWaiters.add(finish)
      setTimeout(finish, Math.max(0, timeoutMs))
    })
  }

  /**
   * Force-reconcile the snapshot from the server via REST (does NOT touch the SSE
   * stream). Debounced to one call/sec unless `force` (use force from a
   * user-initiated "Refresh" action). Never throws — a network error leaves the
   * cached state intact and SSE catches up later. Parity with Swift
   * `refresh(force:)`.
   */
  async refresh(force = false): Promise<void> {
    const now = Date.now()
    if (!force && now - this.lastRefreshAt < REFRESH_DEBOUNCE_MS) return
    this.lastRefreshAt = now
    await this._resolve(this.currentUserId)
  }

  /**
   * Requests a short-lived (60s) per-feature JWT from
   * `POST /api/sdk/features/module-token` — proof the current user is entitled to
   * `slug`, which the host forwards to its OWN backend/CDN to gate code download.
   * The backend re-verifies entitlement on every request. Parity with Swift
   * `moduleToken(for:)`.
   *
   * Throws {@link OneloFeaturesError}:
   * - `not_authenticated` — no user identified yet (NO network call is made)
   * - `not_entitled` (403) — the user lacks access to `slug`
   * - `secure_mode_required` (401) — app requires `userIdHash`, none supplied
   * - `invalid_user_hash` (401) — supplied `userIdHash` failed backend HMAC
   * - `network_error` — transport failure or malformed response
   *
   * @param slug        Feature/module slug to mint a token for.
   * @param userIdHash  Optional secure-mode HMAC; overrides the one from load().
   */
  async moduleToken(slug: string, userIdHash?: string): Promise<string> {
    if (!this.currentUserId) throw new OneloFeaturesError('not_authenticated')
    const body: Record<string, unknown> = {
      publishableKey: this.publishableKey,
      userId: this.currentUserId,
      slug,
    }
    const hash = userIdHash ?? this.currentUserIdHash
    if (hash) body['userIdHash'] = hash
    let status: number
    let json: Record<string, unknown>
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      const res = await httpPost(`${this.apiUrl}/api/sdk/features/module-token`, body, await sdkHeaders(this.bundleId))
      status = res.status
      json = (res.json ?? {}) as Record<string, unknown>
    } catch {
      throw new OneloFeaturesError('network_error')
    }
    if (status === 200) {
      const token = json['token']
      if (typeof token === 'string' && token.length > 0) return token
      throw new OneloFeaturesError('network_error')
    }
    if (status === 401) {
      // FastAPI HTTPException(detail={"error": ...}) → body is { detail: { error } };
      // some paths send a flat { error }.
      const detail = json['detail'] as Record<string, unknown> | undefined
      const errCode = (detail?.['error'] ?? json['error']) as string | undefined
      if (errCode === 'secure_mode_required') throw new OneloFeaturesError('secure_mode_required')
      if (errCode === 'invalid_user_hash') throw new OneloFeaturesError('invalid_user_hash')
      throw new OneloFeaturesError('not_authenticated')
    }
    if (status === 403) throw new OneloFeaturesError('not_entitled')
    throw new OneloFeaturesError('network_error')
  }

  /** Stop the fallback poll + pending batch-ping. The shared SSE stream is owned
   *  and torn down by Onelo (Onelo.destroy → stream.destroy), NOT here — closing
   *  it from features would also drop auth's session.revoked subscription. */
  stopPolling(): void {
    this._stopPollTimer()
    if (this.pingDebounce !== null) {
      clearTimeout(this.pingDebounce)
      this.pingDebounce = null
    }
  }

  /** Clears the local feature cache and resets the config version. The next
   *  resolve / SSE snapshot re-fills it. */
  invalidateCache(): void {
    this.cache.clear()
    this.configVersion = 0
    void saveFeatureCache(this._cacheKey(this.currentUserId), this._snapshotForDisk())
    this._emitChange()
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** Signals all pending ready() callers that the first snapshot arrived.
   *  Idempotent (parity with Swift `_signalFirstEvent`). */
  private _signalFirstEvent(): void {
    if (this.firstEventReceived) return
    this.firstEventReceived = true
    const waiters = Array.from(this.readyWaiters)
    this.readyWaiters.clear()
    for (const w of waiters) w()
  }

  private _scheduleBatchPing(): void {
    if (this.pingDebounce !== null) clearTimeout(this.pingDebounce)
    this.pingDebounce = setTimeout(() => {
      this.pingDebounce = null
      void this._batchPing()
    }, 1000)
  }

  /**
   * Decide whether to send a batch-ping on LOAD (parity with Swift
   * `_shouldBatchPingOnLoad`). Test env ALWAYS pings (reliable discovery of new
   * slugs); live env samples at 1% to avoid fleet-scale write amplification —
   * on live, batch-ping only bumps `last_seen_at` (registration is test-env only
   * server-side), so 1/100 is ample staleness resolution.
   *
   * "test" = explicit featureEnvironment OR a `_test_` key prefix — the latter
   * mirrors the backend's effective-env key-prefix fallback, so a test-keyed app
   * WITHOUT the env var still discovers.
   */
  private _shouldBatchPingOnLoad(): boolean {
    if (this.featureEnvironment === 'test' || this.publishableKey.includes('_test_')) return true
    return Math.random() < 0.01
  }

  private async _batchPing(): Promise<void> {
    const names = Array.from(this.discoveredNames)
    if (names.length === 0) return
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      await httpPost(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        publishableKey: this.publishableKey,
        features: names,
        ...(this.currentUserId ? { userId: this.currentUserId } : {}),
        ...(this.currentUserIdHash ? { userIdHash: this.currentUserIdHash } : {}),
        ...(this.featureEnvironment ? { environment: this.featureEnvironment } : {}),
      }, await sdkHeaders(this.bundleId))
    } catch {
      // best-effort
    }
  }

  private async _resolve(userId: string | null): Promise<void> {
    try {
      const body: Record<string, unknown> = { publishableKey: this.publishableKey }
      if (userId) body['userId'] = userId
      if (this.currentUserIdHash) body['userIdHash'] = this.currentUserIdHash
      if (this.featureEnvironment) body['environment'] = this.featureEnvironment
      const { sdkHeaders } = await import('../sdk-headers')
      const { status, json } = await httpPost(`${this.apiUrl}/api/sdk/features/resolve`, body, await sdkHeaders(this.bundleId))
      if (status !== 200) return
      const j = json as Record<string, unknown>
      const features = j['features'] as Record<string, FeatureWire> | undefined
      if (features) {
        this._applySnapshot(typeof j['config_version'] === 'number' ? (j['config_version'] as number) : this.configVersion, features)
      }
      this._maybeWarnAnonymous(j)
      // A successful resolve is a settled snapshot too — unblocks ready() on the
      // no-SSE / anonymous fallback path where no `connected` event ever arrives.
      this._signalFirstEvent()
    } catch {
      // keep existing cache
    }
  }

  /**
   * Logs a one-time warning when the backend reports anonymous mode (no userId)
   * AND at least one targeted feature was hidden purely because of it. Helps
   * developers using their own auth system catch missing identify() calls.
   */
  private _maybeWarnAnonymous(response: Record<string, unknown>): void {
    if (this.suppressIdentifyWarning || this.anonymousWarningLogged) return
    if (response['anonymous'] !== true) return
    const misses = typeof response['targeting_misses'] === 'number' ? (response['targeting_misses'] as number) : 0
    if (misses <= 0) return
    this.anonymousWarningLogged = true
    // eslint-disable-next-line no-console
    console.warn(
      `[Onelo] ${misses} feature(s) hidden because no user is identified.\n` +
      `If you handle auth yourself, call onelo.identify(userId) after login so per-user/per-plan targeting can apply.\n` +
      `If your app is intentionally anonymous, pass suppressIdentifyWarning: true in OneloConfig to silence this.`
    )
  }

  private async _poll(userId: string | null): Promise<void> {
    try {
      // Contract note: the backend `/poll` reads `since_version` (NOT `version`)
      // and answers `{config_version, up_to_date:true, discovery_requested}` when
      // our cursor matches — otherwise `{config_version, features,
      // discovery_requested}`. It never returns a `changed` field. (The pre-SSE
      // RN poll sent `version` + tested a nonexistent `changed`, so the cheap
      // up-to-date short-circuit never fired — fixed here.) Poll is used only on
      // the anonymous / no-stream fallback path, so `userIdHash` (a secure-mode,
      // identified-only field the endpoint doesn't accept as a query param) is
      // intentionally not sent.
      const params = new URLSearchParams({
        key: this.publishableKey,
        since_version: String(this.configVersion),
      })
      if (this.featureEnvironment) params.set('environment', this.featureEnvironment)
      if (userId) params.set('userId', userId)
      const { sdkHeaders } = await import('../sdk-headers')
      const { status, json } = await httpGet(
        `${this.apiUrl}/api/sdk/features/poll?${params.toString()}`,
        await sdkHeaders(this.bundleId)
      )
      if (status !== 200) return
      const j = json as Record<string, unknown>
      if (j['up_to_date'] === true) {
        if (typeof j['config_version'] === 'number') this.configVersion = j['config_version'] as number
      } else {
        const features = j['features'] as Record<string, FeatureWire> | undefined
        if (features) {
          this._applySnapshot(typeof j['config_version'] === 'number' ? (j['config_version'] as number) : this.configVersion, features)
        }
      }
      if (j['discovery_requested'] === true) {
        await this._batchPing()
      }
    } catch {
      // ignore — will retry on next tick
    }
  }

  private _startPolling(userId: string | null): void {
    this._stopPollTimer()
    this.pollTimer = setInterval(() => {
      void this._poll(userId)
    }, POLL_INTERVAL_MS)
  }

  private _stopPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // ── Snapshot + disk cache ────────────────────────────────────────────────────

  private _applySnapshot(version: number, features: Record<string, FeatureWire>): void {
    this.configVersion = version
    this.cache.clear()
    for (const [name, wire] of Object.entries(features)) {
      this.cache.set(name, wireToEntry(wire))
    }
    void saveFeatureCache(this._cacheKey(this.currentUserId), this._snapshotForDisk())
    // Mirror the new version into the shared stream so the NEXT (auth-driven)
    // reconnect carries the right `since_version` and the backend can answer
    // `up_to_date` instead of resending the full snapshot.
    this.stream?.updateSinceVersion(version)
    this._emitChange()
  }

  private _cacheKey(userId: string | null): string {
    return `${CACHE_KEY_PREFIX}.${this.publishableKey}.${userId ?? 'anon'}`
  }

  /** v2 disk shape (snake_case, mirrors Swift) — persists the FULL entry so a
   *  cold-start `up_to_date` still renders upgrade badges. */
  private _snapshotForDisk(): CachedSnapshot {
    const features: Record<string, FeatureWire> = {}
    for (const [name, entry] of this.cache) {
      const wire: FeatureWire = { status: entry.status }
      if (entry.reason) wire.reason = entry.reason
      if (entry.requiredPlan) wire.required_plan = entry.requiredPlan
      if (entry.requiredPlanLabel) wire.required_plan_label = entry.requiredPlanLabel
      if (entry.upgradeCta) wire.upgrade_cta = true
      features[name] = wire
    }
    return { config_version: this.configVersion, features }
  }

  private async _loadCache(userId: string | null): Promise<void> {
    const parsed = (await loadFeatureCache(this._cacheKey(userId))) as CachedSnapshot | null
    if (!parsed || typeof parsed.config_version !== 'number' || !parsed.features) return
    this.configVersion = parsed.config_version
    this.cache.clear()
    for (const [name, cached] of Object.entries(parsed.features)) {
      // v1 back-compat: an old cache stored a bare status string.
      if (typeof cached === 'string') {
        this.cache.set(name, { status: normalizeStatus(cached), upgradeCta: false })
      } else if (cached && typeof cached === 'object') {
        this.cache.set(name, wireToEntry(cached))
      }
    }
    this._emitChange()
  }
}
