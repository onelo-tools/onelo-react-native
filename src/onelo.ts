import type { OneloConfig } from '@onelo/core'
import { OneloAuth } from './auth/auth'
import { OneloFeatures } from './features/features'
import { OneloMonitor } from './monitor/monitor'
import { OneloFeedback } from './feedback/feedback'
import { OneloForms } from './forms/forms'
import { OneloWaitlist } from './waitlist/waitlist'
import { OneloCustomerPortal } from './customer-portal/customer-portal'
import { OneloConsent } from './consent/consent'
import { OneloStore } from './store/store'
import { OneloEventStream } from './core/event-stream'

const SDK_VERSION: string = require('../package.json').version

/** Minimal RN AppState shape we depend on — kept local so a pure-Node import of
 *  this module (tests / SSR tooling) never statically pulls `react-native`. */
interface AppStateSubscription { remove: () => void }
interface AppStateLike {
  addEventListener: (type: 'change', handler: (state: string) => void) => AppStateSubscription
}

export class Onelo {
  readonly auth: OneloAuth
  readonly features: OneloFeatures
  readonly monitor: OneloMonitor
  readonly feedback: OneloFeedback
  readonly forms: OneloForms
  readonly waitlist: OneloWaitlist
  readonly customerPortal: OneloCustomerPortal
  readonly consent: OneloConsent
  readonly store: OneloStore
  private authUnsubscribe: (() => void) | null = null
  // ONE multiplexed SSE connection per app. Owned here (composition root);
  // auth (session.revoked) + consent (legal.consent_required) only register
  // handlers on it. Features is wired in Round 3 — not yet.
  private readonly eventStream: OneloEventStream
  /** Whether the auth-state bridge + foreground re-check auto-open the consent
   *  gate (config.autoPresentConsentGate, default true). */
  private readonly autoPresentConsent: boolean
  /** Whether app-foreground force-refreshes the feature snapshot
   *  (config.autoLifecycleRefresh, default true). 1:1 with Swift. */
  private readonly autoLifecycleRefresh: boolean
  /** RN AppState 'change' subscription, removed in destroy() so a torn-down SDK
   *  can't leak a foreground callback that fires against dead state. */
  private appStateSubscription: AppStateSubscription | null = null

  constructor(config: OneloConfig) {
    this.auth = new OneloAuth(config)
    this.monitor = new OneloMonitor(
      config.publishableKey, config.apiUrl, config.bundleId,
      config.appVersion, config.appBuild, config.environment,
    )
    // Feature environment: explicit config only. React Native has no Node
    // process.env, so there is no env-var fallback — normalize to 'test'|'live'
    // or undefined so a stray value never ships as a junk request field.
    const featureEnvironment =
      config.featureEnvironment === 'test' || config.featureEnvironment === 'live'
        ? config.featureEnvironment
        : undefined
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor, config.bundleId, {
      suppressIdentifyWarning: config.suppressIdentifyWarning ?? false,
      featureEnvironment,
      featureDefaultStatus: config.featureDefaultStatus,
    })
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures(), config.bundleId, () => this.auth.pageBackgroundColor())
    this.forms = new OneloForms(config.apiUrl, config.publishableKey, config.bundleId)
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey, config.bundleId)
    this.customerPortal = new OneloCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      config.bundleId,
      async () => (await this.auth.getSession())?.accessToken ?? null,
      () => this.auth.signOut(),
      () => { this.auth.isUserRevoked = true },
      () => this.auth.pageBackgroundColor(),
      this.auth.callbackScheme,
    )

    this.autoPresentConsent = config.autoPresentConsentGate ?? true
    this.autoLifecycleRefresh = config.autoLifecycleRefresh ?? true
    this.consent = new OneloConsent(config.apiUrl, config.publishableKey, this.auth, config.bundleId, this.autoPresentConsent)
    this.store = new OneloStore(
      config.apiUrl,
      config.publishableKey,
      config.bundleId,
      async () => (await this.auth.getSession())?.accessToken ?? null,
      (code) => this.auth.exchangeHostedCode(code),
      () => this.auth.pageBackgroundColor(),
      this.auth.callbackScheme,
    )

    // The shared SSE connection. Register auth + consent handlers BEFORE the
    // stream is ever started (below in the bridge) so no server push is missed
    // between connect and sign-in. `featureEnvironment` is a constant for the
    // stream's lifetime, so it's set as a property (not a start() param).
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, SDK_VERSION, config.bundleId)
    this.eventStream.featureEnvironment = featureEnvironment
    this.auth.attachEventStream(this.eventStream)
    this.consent.attachEventStream(this.eventStream)
    // Features consumes the SAME connection (ownsEventStream=false): it registers
    // connected/up_to_date/features_updated/discovery_requested handlers but never
    // start()/stop()s the stream — auth owns the lifecycle (avoids racing session.revoked).
    this.features.attachEventStream(this.eventStream)

    // Auth → identity bridge: on sign-in start the user-bound stream (so
    // session.revoked routes to this user) + reload features; on sign-out stop
    // it. NEVER start({userId:null}) — the stream's downgrade guard would ignore
    // it and leave a stale user bound; stop() is the explicit teardown. Also
    // drive the legal-consent gate on sign-in (a fresh session may carry an
    // outstanding blocking Terms/Privacy update) unless the dev opted out.
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      const userId = session?.user.id ?? null
      this.monitor.setUserId(userId)
      void this.features.load(userId)
      if (session != null && userId != null) {
        this.eventStream.start({ userId })
        if (this.autoPresentConsent) void this.consent.presentGateIfNeeded()
      } else {
        this.eventStream.stop()
      }
    })

    this.monitor.setUserId(null)
    void this.features.load(null)
    // Cold-start: if a valid session is already in the keychain, publish it so the
    // bridge above runs for a RETURNING signed-in user — starts the SSE stream
    // (incl. session.revoked), loads per-user features, sets monitor identity, and
    // presents any pending consent gate. Without this, none of that fires on launch
    // until a token refresh eventually happens. Supersedes the anonymous baseline
    // set just above. Best-effort; never throws.
    void this.auth.restoreSession()
    this._wireForeground()
  }

  /**
   * Re-check consent (and resync features) when the app returns to the
   * foreground — RN has no built-in foreground hook, so we subscribe to
   * AppState 'change' → 'active'. Mirrors Swift's foreground resync. `AppState`
   * is required LAZILY so a pure-Node import of this module (tests) never pulls
   * `react-native`; any failure (unusual RN polyfill) degrades to "no foreground
   * re-check" rather than throwing at construction.
   */
  private _wireForeground(): void {
    let AppState: AppStateLike | undefined
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      AppState = (require('react-native') as { AppState?: AppStateLike }).AppState
    } catch {
      AppState = undefined
    }
    if (!AppState) return
    this.appStateSubscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return
      void (async () => {
        // Force-reconcile features for the CURRENT identity (kept in the features
        // module — set by the auth bridge or identify()). We do NOT re-derive the
        // identity from the Onelo session here: a CUSTOM-auth app has no Onelo
        // session, so `load(session?.user.id ?? null)` would reset it to anonymous
        // and wipe the secure-mode userIdHash on EVERY foreground. refresh(true)
        // keeps the identity + bypasses the 1s debounce, matching Swift/Android/
        // Flutter's forced foreground resync. Gated on autoLifecycleRefresh.
        if (this.autoLifecycleRefresh) void this.features.refresh(true)
        const session = await this.auth.getSession()
        if (session != null && this.autoPresentConsent) {
          void this.consent.presentGateIfNeeded()
        }
      })()
    })
  }

  /** Only needed when NOT using Onelo Auth (own auth system). `userIdHash` is the
   *  host-supplied HMAC for Features secure mode (threaded into resolve / batch-ping
   *  / module-token); omit it when not using secure mode. */
  async identify(userId: string, userIdHash?: string): Promise<void> {
    await this.features.load(userId, userIdHash)
  }

  /**
   * Opens the hosted upgrade flow for `plan` in the SYSTEM BROWSER and returns.
   * The backend decides the destination: an active subscriber lands on "Change
   * plan" (target pinned; one click to confirm), a non-subscriber on the store.
   * Requires a signed-in session (throws `OneloError('not_authenticated')` otherwise).
   *
   * Wire it to a plan-gated tile whose `upgradeCta` is on:
   *   `if (f.upgradeCta && f.requiredPlan) onelo.openUpgrade(f.requiredPlan)`
   *
   * Thin delegate to {@link OneloStore.openUpgrade} for cross-platform parity with
   * Swift `Onelo.openUpgrade(forPlan:)` / Android / Flutter `onelo.openUpgrade`.
   */
  async openUpgrade(plan: string, lang = 'en'): Promise<void> {
    return this.store.openUpgrade(plan, lang)
  }

  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy(): void {
    this.authUnsubscribe?.()
    this.appStateSubscription?.remove()
    this.appStateSubscription = null
    this.eventStream.destroy()
    this.features.stopPolling()
    this.monitor.destroy()
    this.consent.dispose()
  }
}
