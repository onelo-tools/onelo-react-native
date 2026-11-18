import { httpGet, OneloError, extractErrorCode, BrandSource, type BrandTokens, type OneloSession } from '@onelo/core'
import { requestLanguage } from '../core/page-language'
import type { PlanChange } from '../core/plan-change'
import { sdkHeaders } from '../sdk-headers'
import type { StoreResult } from './store-modal'

const SDK_VERSION: string = require('../../package.json').version

/**
 * Callback scheme used by this SDK — must match auth.ts (`onelorn`). The hosted
 * store redirects to `<scheme>://callback?code=…` on checkout completion, which
 * the WebView modal intercepts (same mechanism as the hosted sign-in flow).
 */
const CALLBACK_SCHEME = 'onelorn'

export type StoreModalState = {
  visible: boolean
  hostedUrl: string
  callbackScheme: string
  /** Backend base URL — threaded into the modal so it can build the `native_oauth`
   *  system-browser hand-off URL (`{apiUrl}/api/sdk/auth/oauth/hosted-init?…`). */
  apiUrl: string
  /** The app's brand tokens (#681): the modal's chrome is painted from them. */
  tokens: BrandTokens
  /** @deprecated Use `tokens.page_bg`. */
  backgroundColor: string
  onResult: ((result: StoreResult) => void) | null
}

/** Where `openUpgrade` presents its URL: the customer-portal modal. */
export interface UpgradeHost {
  readonly hasModalHost: boolean
  presentUrl(url: string): Promise<void>
}

/**
 * Monetization entry points — the Onelo hosted store (checkout / plan selection)
 * and the upgrade flow. Ports Swift's `OneloAuth.initiateStoreFlow()` +
 * `Onelo.openUpgrade(forPlan:)`; mirrors the Electron `OneloStore`.
 *
 * The AUTOMATIC "you must buy to proceed" store (sign-up → store when the paywall
 * is on) is handled server-side by the hosted auth page — you get that for free
 * via `auth.loadAuthView()`. THIS class is the EXPLICIT surface: a re-purchase, an
 * "Upgrade" button, or acting on a feature's `upgradeCta`/`upgradeHint` upsell.
 *
 * Backend: `GET /api/sdk/paywall/store-initiate` + `GET /api/sdk/paywall/upgrade-initiate`.
 *
 * Usage:
 *   const session = await onelo.store.open()        // buyer ends up signed in
 *   await onelo.store.openUpgrade('pro')            // upgrade in the portal modal
 */
export class OneloStore {
  private apiUrl: string
  private publishableKey: string
  private bundleId?: string
  private getAccessToken: () => Promise<string | null>
  private exchangeCode?: (code: string) => Promise<OneloSession>
  /** Told when the store ended in a purchase or a plan switch (#659). Set by
   *  `Onelo` to its plan-change refresher. */
  private onPlanChange: ((change: PlanChange) => void) | null = null
  setPlanChangeHandler(fn: ((change: PlanChange) => void) | null): void {
    this.onPlanChange = fn
  }
  private getSession: () => Promise<OneloSession | null>
  private brand: BrandSource
  private readonly callbackScheme: string
  private readonly upgradeHost?: UpgradeHost
  /** #1076 — the App's language (`config.language`); undefined = the device's. */
  private readonly language?: string

  private _modalVisible = false
  private _modalUrl = ''
  private _modalResolve: ((result: StoreResult) => void) | null = null
  private storeStateListeners: Array<() => void> = []

  /**
   * @param exchangeCode Injected by `Onelo` — exchanges the hosted-flow one-time
   *   code for a session AND persists it (so the buyer is left signed in and
   *   auth-state listeners fire). Delegates to the auth module's hosted-callback
   *   exchange. Required for `open()` to complete a purchase.
   */
  constructor(
    apiUrl: string,
    publishableKey: string,
    bundleId: string | undefined,
    getAccessToken: () => Promise<string | null>,
    exchangeCode?: (code: string) => Promise<OneloSession>,
    /** The SDK's one brand-token model (#681) — `Onelo` passes the auth's. */
    brand: BrandSource = new BrandSource(),
    callbackScheme: string = CALLBACK_SCHEME,
    /** Reads the current session back — `open()` resolves with it when the
     *  store finishes a plan switch that has no code to exchange (#599). */
    getSession: () => Promise<OneloSession | null> = async () => null,
    /** The SDK container `openUpgrade` presents in (#606) — wired by `Onelo`
     *  to the customer-portal modal. Absent → the system browser. */
    upgradeHost?: UpgradeHost,
    /** #1076 — the App's language, the default `lang` of every page this
     *  opens. Undefined sends the device language. */
    language?: string,
  ) {
    if (!apiUrl) throw new Error('[Onelo] apiUrl is required')
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.bundleId = bundleId
    this.getAccessToken = getAccessToken
    this.exchangeCode = exchangeCode
    this.brand = brand
    this.callbackScheme = callbackScheme
    this.getSession = getSession
    this.upgradeHost = upgradeHost
    this.language = language
  }

  /** Security headers for every store request (`sdkHeaders`) plus per-request extras. */
  private async _secHeaders(extra: Record<string, string> = {}): Promise<Record<string, string>> {
    return { ...(await sdkHeaders(this.bundleId)), 'X-SDK-Version': SDK_VERSION, ...extra }
  }

  /**
   * Mint a tokenized hosted-store URL (plan selection + payment + registration in
   * one page). When a session exists its access token is attached (`Authorization:
   * Bearer`) so the store binds to the existing user and skips signup (re-purchase);
   * cold-start omits it. Mirrors Swift `initiateStoreFlow(lang:)`. Use for a custom
   * presentation; `open()` wraps it.
   *
   * @param lang  The App's language for the store. Omitted, the `language` from
   *   the config is sent, else the device language (#1039, #1076); the backend
   *   picks the Page Language within the App Languages.
   *
   * @throws OneloError('server_error') on `store_not_configured` (409) /
   *   `paywall_not_enabled` (403) — DO NOT open a WebView in that case — or any
   *   other non-200. `OneloError('invalid_publishable_key')` on 401.
   */
  async initiateStoreFlow(lang?: string): Promise<string> {
    // Bearer only when signed in (re-purchase / reauth binding); anonymous store
    // omits it. getAccessToken() auto-refreshes a near-expiry token.
    const token = await this.getAccessToken()

    const url =
      `${this.apiUrl}/api/sdk/paywall/store-initiate` +
      `?key=${encodeURIComponent(this.publishableKey)}` +
      `&callback_scheme=${encodeURIComponent(this.callbackScheme)}` +
      `&lang=${encodeURIComponent(requestLanguage(this.language, lang))}`

    const { status, json } = await httpGet(
      url,
      await this._secHeaders(token ? { Authorization: `Bearer ${token}` } : {}),
    )

    if (status === 401) throw OneloError.invalidKey('Store rejected the publishable key')
    if (status !== 200) {
      // store_not_configured / paywall_not_enabled / in_app_store_not_allowed have no
      // dedicated OneloError code in this SDK's taxonomy → map to server_error (auth.ts parity).
      const code = extractErrorCode(json)
      throw OneloError.server(`Failed to initiate store flow: HTTP ${status}${code ? ` (${code})` : ''}`)
    }

    this.brand.adopt(json) // #681: store-initiate carries brand_tokens
    const storeUrl = (json as Record<string, unknown>)['store_url'] as string | undefined
    if (!storeUrl) throw OneloError.server('Invalid store-initiate response: missing store_url')
    return storeUrl
  }

  /**
   * Open the hosted store in a fullscreen WebView modal and complete checkout. The
   * store completes with a `onelorn://callback?code=` deep-link that is exchanged
   * for a session — the buyer ends up signed in. Resolves with that session, or
   * `null` if the modal was closed without completing a purchase.
   *
   * Requires `<StoreModal onelo={onelo} />` mounted near your app root.
   */
  async open(lang?: string): Promise<OneloSession | null> {
    const hostedUrl = await this.initiateStoreFlow(lang)

    return new Promise<OneloSession | null>((resolve, reject) => {
      this._modalUrl = hostedUrl
      this._modalResolve = async (result: StoreResult) => {
        // The link died (#619): mint a fresh one and keep the modal up on it,
        // so the buyer continues instead of being dropped back into the app.
        // Each pass is a new link and the page only reports a dead one, so this
        // cannot spin. A failed mint closes the modal as a cancel.
        if (result.type === 'expired') {
          const resolver = this._modalResolve
          try {
            this._modalUrl = await this.initiateStoreFlow(lang)
            this._modalResolve = resolver
            this.notifyStoreListeners()
            return
          } catch {
            result = { type: 'cancelled' }
          }
        }
        this._modalVisible = false
        this._modalResolve = null
        this.notifyStoreListeners()

        if (result.type === 'cancelled') {
          resolve(null)
          return
        }
        // Plan switch with no checkout (#599): nothing to exchange, the buyer is
        // the signed-in user. A success — resolve that session, not null.
        if (result.type === 'done') {
          this.onPlanChange?.({ kind: 'switched', reason: result.reason })
          this.getSession().then(resolve, reject)
          return
        }
        // Purchase completed → exchange the one-time code for a session and
        // persist it (buyer signed in). Same exchange as auth.loadAuthView().
        if (!this.exchangeCode) {
          reject(OneloError.server('Store exchange not wired: missing exchangeCode dependency'))
          return
        }
        try {
          const session = await this.exchangeCode(result.code)
          this.onPlanChange?.({ kind: 'purchase' })
          resolve(session)
        } catch (e) {
          reject(e)
        }
      }
      this._modalVisible = true
      this.notifyStoreListeners()
    })
  }

  /**
   * Act on an upsell (a feature's `upgradeCta`/`upgradeHint`, an "Available in
   * <plan>" tap). Requires a signed-in session. The backend is the single source
   * of truth for billing: an active subscriber is routed to a hosted plan-switch
   * checkout, a user with no subscription to the hosted store, and a subscriber
   * whose plan changes are switched off to the portal, which explains it. The
   * URL opens in the SDK's customer-portal modal (#606), so the store's
   * hand-back (purchase, plan switch, expired link) closes it and the app sees
   * the new plan; resolves when the modal closes. Requires
   * `<CustomerPortalModal onelo={onelo} />` mounted — without one the URL opens
   * in the system browser (`Linking.openURL`) and a warning is logged.
   *
   * @param lang  The App's language for the page. Omitted, the `language` from
   *   the config is sent, else the device language (#1039, #1076).
   * @throws OneloError('not_authenticated') when signed out (401) or
   *   `OneloError('server_error')` on `plan_not_purchasable` (404) /
   *   `callback_scheme_required` (400) / any other non-200.
   */
  async openUpgrade(plan: string, lang?: string): Promise<void> {
    // getAccessToken() refreshes a near-expiry token before returning it, then we
    // require a session (parity with Swift's refresh-then-require).
    const token = await this.getAccessToken()
    if (!token) throw OneloError.notAuthenticated()

    const url =
      `${this.apiUrl}/api/sdk/paywall/upgrade-initiate` +
      `?key=${encodeURIComponent(this.publishableKey)}` +
      `&plan=${encodeURIComponent(plan)}` +
      `&callback_scheme=${encodeURIComponent(this.callbackScheme)}` +
      `&lang=${encodeURIComponent(requestLanguage(this.language, lang))}`

    const { status, json } = await httpGet(url, await this._secHeaders({ Authorization: `Bearer ${token}` }))

    if (status === 401) throw OneloError.notAuthenticated()
    if (status !== 200) {
      const code = extractErrorCode(json)
      // e.g. plan_not_purchasable (404), callback_scheme_required (400),
      // in_app_store_not_allowed (409).
      throw OneloError.server(`Failed to initiate upgrade: HTTP ${status}${code ? ` (${code})` : ''}`)
    }

    this.brand.adopt(json) // #681: upgrade-initiate carries brand_tokens
    const upgradeUrl = (json as Record<string, unknown>)['upgrade_url'] as string | undefined
    if (!upgradeUrl) throw OneloError.server('Invalid upgrade-initiate response: missing upgrade_url')

    if (this.upgradeHost?.hasModalHost) {
      await this.upgradeHost.presentUrl(upgradeUrl)
      return
    }
    // eslint-disable-next-line no-console
    console.warn('[Onelo] openUpgrade: no <CustomerPortalModal> is mounted — opening the upgrade in the system browser, where its completion cannot reach the app.')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Linking } = require('react-native')
    await Linking.openURL(upgradeUrl)
  }

  /** Returns current modal state for rendering <StoreModal>. */
  getModalState(): StoreModalState {
    return {
      visible: this._modalVisible,
      hostedUrl: this._modalUrl,
      callbackScheme: this.callbackScheme,
      apiUrl: this.apiUrl,
      tokens: this.brand.current(),
      backgroundColor: this.brand.current().page_bg,
      onResult: this._modalResolve,
    }
  }

  /** Subscribe to store modal state changes. Returns an unsubscribe function. */
  onStoreStateChange(callback: () => void): () => void {
    this.storeStateListeners.push(callback)
    return () => {
      this.storeStateListeners = this.storeStateListeners.filter(l => l !== callback)
    }
  }

  private notifyStoreListeners(): void {
    for (const cb of this.storeStateListeners) cb()
  }
}
