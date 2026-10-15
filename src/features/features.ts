import { httpPost, httpGet } from '@onelo/core'
import type { OneloEventStream, StreamConnectionIdentity } from '../core/event-stream'
import { bearerHeader, sendWithUserToken, type UserTokenSource } from '../core/user-token'
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
  | 'not_authenticated'    // no signed-in user, or their access token was refused even after a refresh
  | 'not_entitled'         // 403 — current user lacks access to the slug
  /** @deprecated Secure Mode is retired; the server no longer answers with it. */
  | 'secure_mode_required'
  /** @deprecated Secure Mode is retired; the server no longer answers with it. */
  | 'invalid_user_hash'
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
  /** The signed-in Onelo user's access token, sent as `Authorization: Bearer`
   *  on every Features call (resolve, batch-ping, poll, module-token) so the
   *  server knows who the user really is. Wired by `Onelo` to `auth`. */
  userToken?: UserTokenSource
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
  // Signed-in user's access token source (Bearer on every Features call).
  private readonly userToken: UserTokenSource | null
  private userTokenRefusedWarned = false
  // Shared multiplexed SSE stream — INJECTED by Onelo (composition root) via
  // attachEventStream(). Features NEVER calls start()/stop() on it: auth owns the
  // lifecycle (starts it on sign-in, stops on sign-out). Null in standalone use /
  // tests, where load() falls back to a one-shot resolve + 60s poll.
  private stream: OneloEventStream | null = null
  // ready() cold-start sync — resolved on the first applied snapshot or timeout
  // (parity with Swift firstEventReceived + readyWaiters).
  private firstEventReceived = false
  // Identity-bound readiness (#736, parity with Swift/JS/Electron). A persisted
  // snapshot renders instantly, but only a response confirmed for THIS load
  // generation + identity releases `ready()` or a non-zero `since_version`.
  private loadGeneration = 0
  private identityLoaded = false
  private confirmedGeneration = -1
  private confirmedVersion = 0
  private snapshotConfirmed = false
  // Identity the open SSE connection actually authenticated (null = none).
  private streamConnection: StreamConnectionIdentity | null = null
  private streamConnectionGeneration = -1
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
    this.userToken = options?.userToken ?? null
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
    stream.onConnectionIdentity((identity) => {
      this.streamConnection = identity
      this.streamConnectionGeneration = identity === null ? -1 : this.loadGeneration
    })
    // A frame counts only when the open connection authenticated the current
    // identity for the current load — never an anonymous-fallback socket for a
    // signed-in user, never a socket from before the last identity change.
    const streamIsBound = (): boolean => {
      const c = this.streamConnection
      return c !== null &&
        this.streamConnectionGeneration === this.loadGeneration &&
        c.userId === this.currentUserId &&
        !c.anonymousFallback
    }
    const applyIfSnapshot = (data: Record<string, unknown>): void => {
      if (!streamIsBound()) return
      const features = data['features'] as Record<string, FeatureWire> | undefined
      if (!features) return
      const v = typeof data['config_version'] === 'number' ? (data['config_version'] as number) : this.configVersion
      this._applySnapshot(v, features, this.loadGeneration, this.currentUserId)
      this._signalFirstEvent(this.loadGeneration, this.currentUserId)
    }
    stream.on('connected', (data) => {
      applyIfSnapshot(data)
      if (streamIsBound()) this._maybeWarnAnonymous(data)
    })
    stream.on('features_updated', applyIfSnapshot)
    stream.on('up_to_date', (data) => {
      // Only reachable with a since_version this identity already confirmed.
      if (!streamIsBound() || typeof data['config_version'] !== 'number') return
      this.configVersion = data['config_version'] as number
      this.confirmedVersion = this.configVersion
      this.stream?.updateSinceVersion(this.confirmedVersion)
      this._signalFirstEvent(this.loadGeneration, this.currentUserId)
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
   *
   * @param _userIdHash Deprecated and ignored: Secure Mode is retired, and the
   *   signed-in Onelo user is proven with their access token automatically.
   */
  async load(userId: string | null, _userIdHash?: string | null): Promise<void> {
    // Every load is a new generation: results requested for an earlier one (a
    // late anonymous/previous-user resolve, an old socket) are dropped, and
    // readiness + the confirmed version start over for this identity.
    const generation = ++this.loadGeneration
    this.identityLoaded = true
    // The RN stream is driven by auth, not by load(): a same-user reload (a
    // token refresh re-publishing the session) keeps the open connection, so
    // that connection stays bound when it authenticated this same user.
    const c = this.streamConnection
    if (c !== null && c.userId === userId && userId === this.currentUserId) {
      this.streamConnectionGeneration = generation
    } else {
      this.streamConnection = null
      this.streamConnectionGeneration = -1
    }
    this.currentUserId = userId
    this.firstEventReceived = false
    this.snapshotConfirmed = false
    this.confirmedGeneration = -1
    this.confirmedVersion = 0
    // Never keep the PREVIOUS identity's flags in memory, and never advertise
    // an unconfirmed version (config_version is per app+environment).
    this.cache.clear()
    this.configVersion = 0
    this.stream?.updateSinceVersion(0)
    this._emitChange()
    await this._loadCache(userId, generation)
    if (generation !== this.loadGeneration) return
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
      // The resolve is not debounced here: it is this generation's own
      // confirmation, and an earlier one was dropped as stale.
      this.lastRefreshAt = Date.now()
      await this._resolve(userId, generation)
    } else {
      // Anonymous, or no stream wired (standalone/tests): one-shot resolve for
      // correct initial state + a 60s poll as the live-update fallback.
      await this._resolve(userId, generation)
      if (generation === this.loadGeneration) this._startPolling(userId)
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
    if (this.firstEventReceived && this.confirmedGeneration === this.loadGeneration) return Promise.resolve()
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

  /** A comparable picture of the current snapshot — the plan-change refresher
   *  (#659) re-checks until it differs. @internal */
  snapshotKey(): string {
    return JSON.stringify([...this.cache.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
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
    await this._resolve(this.currentUserId, this.loadGeneration)
  }

  /**
   * Requests a short-lived (60s) per-feature JWT from
   * `POST /api/sdk/features/module-token` — proof the current user is entitled to
   * `slug`, which the host forwards to its OWN backend/CDN to gate code download.
   * The backend re-verifies entitlement on every request. Parity with Swift
   * `moduleToken(for:)`.
   *
   * Throws {@link OneloFeaturesError}:
   * - `not_authenticated` — no user identified yet (NO network call is made), or
   *   the signed-in user's access token was refused even after a refresh
   * - `not_entitled` (403) — the user lacks access to `slug`
   * - `network_error` — transport failure or malformed response
   *
   * @param slug         Feature/module slug to mint a token for.
   * @param _userIdHash  Deprecated and ignored: Secure Mode is retired, and the
   *   signed-in Onelo user is proven with their access token automatically.
   */
  async moduleToken(slug: string, _userIdHash?: string): Promise<string> {
    const userId = this.currentUserId
    if (!userId) throw new OneloFeaturesError('not_authenticated')
    let status: number
    let json: Record<string, unknown>
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      const headers = await sdkHeaders(this.bundleId)
      // A module token is always for a user, so a refused token ends here
      // (`not_authenticated`) instead of retrying anonymously.
      const res = await sendWithUserToken(
        this.userToken,
        ({ token }) => httpPost(
          `${this.apiUrl}/api/sdk/features/module-token`,
          { publishableKey: this.publishableKey, userId, slug },
          { ...headers, ...bearerHeader(token) },
        ),
        () => this._warnUserTokenRefused(),
        false,
      )
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
    this.confirmedVersion = 0
    this.snapshotConfirmed = false
    this.firstEventReceived = false
    this.confirmedGeneration = -1
    this.stream?.updateSinceVersion(0)
    void saveFeatureCache(this._cacheKey(this.currentUserId), this._snapshotForDisk())
    this._emitChange()
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /** Signals all pending ready() callers that the first snapshot arrived.
   *  Idempotent (parity with Swift `_signalFirstEvent`). */
  private _signalFirstEvent(generation: number, userId: string | null): void {
    if (!this.identityLoaded || generation !== this.loadGeneration || userId !== this.currentUserId) return
    if (this.firstEventReceived && this.confirmedGeneration === generation) return
    this.firstEventReceived = true
    this.snapshotConfirmed = true
    this.confirmedGeneration = generation
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
    const userId = this.currentUserId
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      const headers = await sdkHeaders(this.bundleId)
      await sendWithUserToken(this.userToken, ({ token, anonymous }) => httpPost(`${this.apiUrl}/api/sdk/features/batch-ping`, {
        publishableKey: this.publishableKey,
        features: names,
        ...(userId && !anonymous ? { userId } : {}),
        ...(this.featureEnvironment ? { environment: this.featureEnvironment } : {}),
      }, { ...headers, ...bearerHeader(token) }), () => this._warnUserTokenRefused(), true, false)
    } catch {
      // best-effort
    }
  }

  private async _resolve(userId: string | null, generation: number): Promise<void> {
    // Before the first identity load (session restore pending) there is no
    // identity to resolve for — an anonymous answer here would race the restore.
    if (!this.identityLoaded) return
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      const { status, json } = await sendWithUserToken(this.userToken, async ({ token, anonymous }) => {
        const body: Record<string, unknown> = { publishableKey: this.publishableKey }
        // `userId` rides along with the token: the server ignores it when the
        // token is valid, and a server without #517 still resolves by it.
        if (userId && !anonymous) body['userId'] = userId
        if (this.featureEnvironment) body['environment'] = this.featureEnvironment
        // FAZA 3 — verify-only assertion. httpPost serializes via JSON.stringify(body)
        // (@onelo/core http.ts), so JSON.stringify(body) is the exact wire preimage.
        // Built per attempt: the anonymous retry sends a different body.
        const headers = await sdkHeaders(this.bundleId, undefined, {
          method: 'POST', path: '/api/sdk/features/resolve', body: JSON.stringify(body),
        })
        return httpPost(`${this.apiUrl}/api/sdk/features/resolve`, body, { ...headers, ...bearerHeader(token) })
      }, () => this._warnUserTokenRefused(), userId === null) // never fall back anonymous for a user
      if (status !== 200) {
        const { maybeSelfHealFromError } = await import('../attest')
        maybeSelfHealFromError(json)
        return
      }
      // Stale: the identity changed while this was in flight.
      if (generation !== this.loadGeneration || userId !== this.currentUserId) return
      const j = json as Record<string, unknown>
      // An anonymous answer never replaces a signed-in user's snapshot.
      if (userId !== null && j['anonymous'] === true) return
      const features = j['features'] as Record<string, FeatureWire> | undefined
      if (!features) return
      this._applySnapshot(typeof j['config_version'] === 'number' ? (j['config_version'] as number) : this.configVersion, features, generation, userId)
      this._maybeWarnAnonymous(j)
      // A successful resolve is a confirmation too — unblocks ready() on the
      // no-SSE / anonymous fallback path where no `connected` event ever arrives.
      this._signalFirstEvent(generation, userId)
    } catch {
      // keep existing cache
    }
  }

  /** The server refused the signed-in user's access token even after a refresh,
   *  so the call went out anonymous. Features has no error callback; this
   *  one-time warning is its error channel (like the anonymous-mode warning). */
  private _warnUserTokenRefused(): void {
    if (this.userTokenRefusedWarned) return
    this.userTokenRefusedWarned = true
    // eslint-disable-next-line no-console
    console.warn(
      '[Onelo] The signed-in user\'s access token was refused by Features (invalid_user_token) ' +
      'even after a refresh, so the request was made without a user. ' +
      'Check that the publishableKey belongs to the app the user signed in to.',
    )
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

  private async _poll(userId: string | null, generation = this.loadGeneration): Promise<void> {
    if (!this.identityLoaded) return
    try {
      // Contract note: the backend `/poll` reads `since_version` (NOT `version`)
      // and answers `{config_version, up_to_date:true, discovery_requested}` when
      // our cursor matches — otherwise `{config_version, features,
      // discovery_requested}`. It never returns a `changed` field. (The pre-SSE
      // RN poll sent `version` + tested a nonexistent `changed`, so the cheap
      // up-to-date short-circuit never fired — fixed here.) Poll is used only on
      // the anonymous / no-stream fallback path; a signed-in user is still
      // proven with their access token (#518).
      // The key is NOT here — it travels as the `X-Publishable-Key` request
      // header (ADR-0003, #105), exactly as core/event-stream.ts sends it on
      // the stream. /poll fires on a timer, so a raw key in the URL landed in
      // the reverse proxy's access.log on every tick; from 2027-03-31 the
      // backend refuses `?key=` outright.
      const params = new URLSearchParams({
        // Only a version confirmed for the CURRENT identity.
        since_version: String(this.snapshotConfirmed ? this.confirmedVersion : 0),
      })
      if (this.featureEnvironment) params.set('environment', this.featureEnvironment)
      const { sdkHeaders } = await import('../sdk-headers')
      const headers = await sdkHeaders(this.bundleId)
      const { status, json } = await sendWithUserToken(this.userToken, ({ token, anonymous }) => {
        const query = params.toString() + (userId && !anonymous ? `&userId=${encodeURIComponent(userId)}` : '')
        return httpGet(
          `${this.apiUrl}/api/sdk/features/poll?${query}`,
          { ...headers, 'X-Publishable-Key': this.publishableKey, ...bearerHeader(token) },
        )
      }, () => this._warnUserTokenRefused(), userId === null)
      if (status !== 200) return
      if (generation !== this.loadGeneration || userId !== this.currentUserId) return
      const j = json as Record<string, unknown>
      if (userId !== null && j['anonymous'] === true) return
      if (j['up_to_date'] === true) {
        // Only reachable with a since_version this identity already confirmed.
        if (this.snapshotConfirmed && typeof j['config_version'] === 'number') {
          this.configVersion = j['config_version'] as number
          this.confirmedVersion = this.configVersion
        }
      } else {
        const features = j['features'] as Record<string, FeatureWire> | undefined
        if (features) {
          this._applySnapshot(typeof j['config_version'] === 'number' ? (j['config_version'] as number) : this.configVersion, features, generation, userId)
          this._signalFirstEvent(generation, userId)
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
    const generation = this.loadGeneration
    this.pollTimer = setInterval(() => {
      void this._poll(userId, generation)
    }, POLL_INTERVAL_MS)
  }

  private _stopPollTimer(): void {
    if (this.pollTimer !== null) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  // ── Snapshot + disk cache ────────────────────────────────────────────────────

  private _applySnapshot(
    version: number,
    features: Record<string, FeatureWire>,
    generation: number,
    userId: string | null,
  ): void {
    // Applied (and persisted) only under the identity + generation that asked.
    if (!this.identityLoaded || generation !== this.loadGeneration || userId !== this.currentUserId) return
    this.confirmedVersion = version
    this.snapshotConfirmed = true
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

  private async _loadCache(userId: string | null, generation: number): Promise<void> {
    const parsed = (await loadFeatureCache(this._cacheKey(userId))) as CachedSnapshot | null
    // A newer load, or a confirmed answer, already superseded this read.
    if (generation !== this.loadGeneration || this.snapshotConfirmed) return
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
