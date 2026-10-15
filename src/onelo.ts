import type { OneloConfig } from '@onelo/core'
import { PlanChangeRefresher, type PlanChange } from './core/plan-change'
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
import { resetUserTokenRefusal, type UserTokenSource } from './core/user-token'
import type { OneloAttest } from './attest'

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
  private readonly planChange: PlanChangeRefresher
  /** Whether the auth-state bridge + foreground re-check auto-open the consent
   *  gate (config.autoPresentConsentGate, default true). */
  private readonly autoPresentConsent: boolean
  /** Whether app-foreground force-refreshes the feature snapshot
   *  (config.autoLifecycleRefresh, default true). 1:1 with Swift. */
  private readonly autoLifecycleRefresh: boolean
  /** RN AppState 'change' subscription, removed in destroy() so a torn-down SDK
   *  can't leak a foreground callback that fires against dead state. */
  private appStateSubscription: AppStateSubscription | null = null
  /** True once features loaded an identity (auth bridge or identify()), so the
   *  cold-start restore never loads over it. */
  private featuresBound = false
  /** iOS App Attest lifecycle. Created lazily in `_initAttest` ONLY when the app
   *  is iOS AND config reports `attest_required`; null otherwise (Android, or
   *  attest not required). Its token rides every request via `sdkHeaders`. */
  private attest: OneloAttest | null = null
  /** Resolves when the background attestation kicked off in the constructor has
   *  produced its token (or settled as not-required / failed). Gated auth entry
   *  points await this so a cold-start request never races AHEAD of the token
   *  and gets a spurious 403 (#25). Defaults to a resolved promise so it's
   *  always awaitable even before `_initAttest` is assigned below. */
  private _attestReady: Promise<void> = Promise.resolve()

  constructor(config: OneloConfig) {
    // Pass a LAZY getter for the attest-ready promise: `_attestReady` is
    // (re)assigned to the real `_initAttest` run later in this constructor, and
    // auth only reads it at request time (well after construction), so the
    // thunk always sees the live value.
    this.auth = new OneloAuth(config, () => this._attestReady)
    // The signed-in user's access token, proving the user on every Features call
    // and on the Event Stream (#518). getSession() refreshes a token near expiry,
    // so a stale one is never sent.
    const userToken: UserTokenSource = {
      current: async () => (await this.auth.getSession())?.accessToken ?? null,
      refresh: async () => (await this.auth.refreshSession())?.accessToken ?? null,
    }
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
      userToken,
    })
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures(), config.bundleId, this.auth.brand, userToken)
    this.forms = new OneloForms(config.apiUrl, config.publishableKey, config.bundleId)
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey, config.bundleId)
    this.customerPortal = new OneloCustomerPortal(
      config.apiUrl,
      config.publishableKey,
      config.bundleId,
      async () => (await this.auth.getSession())?.accessToken ?? null,
      () => this.auth.signOut(),
      () => { this.auth.isUserRevoked = true },
      this.auth.brand, // #681: the one brand-token model
      this.auth.callbackScheme,
      () => this.auth.revalidateEntitlement(),
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
      this.auth.brand, // #681: the one brand-token model
      this.auth.callbackScheme,
      () => this.auth.getSession(),
      this.customerPortal,
    )

    // The shared SSE connection. Register auth + consent handlers BEFORE the
    // stream is ever started (below in the bridge) so no server push is missed
    // between connect and sign-in. `featureEnvironment` is a constant for the
    // stream's lifetime, so it's set as a property (not a start() param).
    this.eventStream = new OneloEventStream(config.apiUrl, config.publishableKey, SDK_VERSION, config.bundleId, userToken)
    this.eventStream.featureEnvironment = featureEnvironment
    this.auth.attachEventStream(this.eventStream)
    this.consent.attachEventStream(this.eventStream)
    // Features consumes the SAME connection (ownsEventStream=false): it registers
    // connected/up_to_date/features_updated/discovery_requested handlers but never
    // start()/stop()s the stream — auth owns the lifecycle (avoids racing session.revoked).
    this.features.attachEventStream(this.eventStream)

    // #659: a purchase / plan switch handed back by any hosted modal
    // reconciles features + entitlement at once, instead of waiting for the
    // stream. One refresher, so the modals cannot drift.
    this.planChange = new PlanChangeRefresher({
      refreshFeatures: () => this.features.refresh(true),
      revalidateEntitlement: () => this.auth.revalidateEntitlement(),
      snapshot: () => this.features.snapshotKey(),
    })
    const onPlanChange = (change: PlanChange): void => { void this.planChange.handBack(change) }
    this.auth.setPlanChangeHandler(onPlanChange)
    this.store.setPlanChangeHandler(onPlanChange)
    this.customerPortal.setPlanChangeHandler(onPlanChange)

    // Auth → identity bridge: on sign-in start the user-bound stream (so
    // session.revoked routes to this user) + reload features; on sign-out stop
    // it. NEVER start({userId:null}) — the stream's downgrade guard would ignore
    // it and leave a stale user bound; stop() is the explicit teardown. Also
    // drive the legal-consent gate on sign-in (a fresh session may carry an
    // outstanding blocking Terms/Privacy update) unless the dev opted out.
    let boundUserId: string | null = null
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      const userId = session?.user.id ?? null
      // A different user starts a new token-refusal episode. The same user
      // (a refresh re-publishing the session) does not: that is what keeps a
      // persistently refused token from looping refresh → load → refresh.
      if (userId !== boundUserId) resetUserTokenRefusal(userToken)
      boundUserId = userId
      this.monitor.setUserId(userId)
      this.featuresBound = true
      void this.features.load(userId)
      if (session != null && userId != null) {
        this.eventStream.start({ userId })
        if (this.autoPresentConsent) void this.consent.presentGateIfNeeded()
      } else {
        this.eventStream.stop()
      }
    })

    this.monitor.setUserId(null)
    // Cold-start: if a valid session is already in the keychain, publish it so the
    // bridge above runs for a RETURNING signed-in user — starts the SSE stream
    // (incl. session.revoked), loads per-user features, sets monitor identity, and
    // presents any pending consent gate. Without this, none of that fires on launch
    // until a token refresh eventually happens. Supersedes the anonymous baseline
    // set just above. Best-effort; never throws.
    // Features load only AFTER the restore settles (#736): an anonymous load
    // started first would race it and could overwrite a returning user's
    // snapshot. A restored user usually loads through the bridge above; a
    // stored session kept through a transient refresh failure may announce no
    // change, so it is loaded here; no session → anonymous.
    void this.auth.restoreSession()
      .then((session) => { if (!this.featuresBound) void this.features.load(session?.user.id ?? null) })
      .catch(() => { if (!this.featuresBound) void this.features.load(null) })
    // iOS App Attest: gated on config.attest_required (read after auth resolves
    // config) + Platform.OS === 'ios'. Best-effort, fully in the background — it
    // must never block SDK construction. Once it completes the token is cached
    // and rides every subsequent request via sdkHeaders. We KEEP the promise so
    // gated auth entry points can await it (via the thunk passed to OneloAuth)
    // and not fire the first request tokenless → spurious 403 (#25).
    this._attestReady = this._initAttest(config)
    this._wireForeground()
  }

  /**
   * Start device attestation when the backend requires it — App Attest on iOS,
   * Play Integrity on Android. Awaits config resolution (`auth.whenReady`) to
   * read `attest_required` (+ `cloudProjectNumber` for Android), then hands off
   * to the platform-guarded `OneloAttest` (no-op on Simulator/emulator-without-
   * Play or unlinked native). Never throws — attestation is best-effort and
   * independent of sign-in.
   *
   * NEVER swallow the catch silently (CLAUDE.md "No silent swallows" /
   * `feedback_no_silent_swallows`) — everything on the happy path below this
   * point (the dynamic `import('./attest')`, the constructor, `attest.start()`)
   * already logs its own failures via `attest.ts`'s `log()`, but anything that
   * throws BEFORE reaching that internal logging (e.g. the dynamic import
   * itself failing to resolve under a given Metro/bundler config) used to
   * vanish here with zero trace — exactly the diagnosability gap flagged for
   * the Swift SDK (`OneloAuth.swift` `_refreshAttestToken`, `try?`). Attestation
   * staying best-effort (never breaking SDK init) is preserved; only the
   * silence is fixed.
   */
  private async _initAttest(config: OneloConfig): Promise<void> {
    try {
      await this.auth.whenReady()
      if (!this.auth.attestRequired) return
      const { OneloAttest } = await import('./attest')
      const attest = new OneloAttest(config.apiUrl, config.publishableKey, config.bundleId, this.auth.cloudProjectNumber)
      this.attest = attest
      await attest.start()
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[Onelo][attest] _initAttest failed before/outside attest.ts's own error handling: ${String(e)}`)
    }
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
        // on EVERY foreground. refresh(true)
        // keeps the identity + bypasses the 1s debounce, matching Swift/Android/
        // Flutter's forced foreground resync. Gated on autoLifecycleRefresh.
        if (this.autoLifecycleRefresh) void this.features.refresh(true)
        // Refresh the App Attest token if it's near expiry. Foreground is the
        // reliable moment to rotate a ~30-day token without a long-lived timer a
        // backgrounded/killed app would drop. No-op until _initAttest ran.
        void this.attest?.refreshIfNeeded()
        const session = await this.auth.getSession()
        if (session != null && this.autoPresentConsent) {
          void this.consent.presentGateIfNeeded()
        }
      })()
    })
  }

  /** @deprecated The signed-in Onelo user is used automatically: Features calls
   *  prove them with their access token. `userIdHash` is ignored (Secure Mode is
   *  retired). Kept so existing code compiles. */
  async identify(userId: string, userIdHash?: string): Promise<void> {
    this.featuresBound = true
    await this.features.load(userId, userIdHash)
  }

  /**
   * Opens the hosted upgrade flow for `plan` in the SDK's customer-portal modal
   * (`<CustomerPortalModal>` must be mounted) and resolves when it closes. The
   * backend decides the destination: an active subscriber lands on "Change
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
    this.planChange.cancel()
    this.eventStream.destroy()
    this.features.stopPolling()
    this.monitor.destroy()
    this.consent.dispose()
  }
}
