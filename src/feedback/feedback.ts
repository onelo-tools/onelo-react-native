import { BrandSource, type BrandTokens } from '@onelo/core'
export interface FeedbackOptions {
  type?: 'bug' | 'feature_request' | 'general'
  area?: string
  userId?: string
}

import type { RenewReply } from '../customer-portal/portal-renewal'
import { bearerHeader, sendWithUserToken, type UserTokenSource } from '../core/user-token'

export class OneloFeedback {
  private _url: string | null = null
  /** The options of the open form, re-initiated to renew its `ft` (#622). */
  private _options: FeedbackOptions = {}
  private _visible = false
  private _listeners: Array<(url: string | null, visible: boolean) => void> = []

  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly getActiveFeatures: () => string[],
    private readonly bundleId?: string,
    /** The SDK's one brand-token model (#681) — `Onelo` passes the auth's. */
    private readonly brand: BrandSource = new BrandSource(),
    /** The signed-in Onelo user's access token (#820). Wired by `Onelo` to
     *  `auth`; with a session the initiate call carries it and the report names
     *  a verified reporter. Absent, the call is exactly as before. */
    private readonly userToken?: UserTokenSource,
  ) {}

  open(options: FeedbackOptions = {}): void {
    // Show modal immediately (with loading state), fetch URL in background
    this._options = options
    this._notify(null, true)
    void this._fetchAndLoad(options)
  }

  close(): void { this._notify(null, false) }

  private async _fetchAndLoad(options: FeedbackOptions): Promise<void> {
    try {
      const hostedUrl = await this._initiate(options)
      if (!hostedUrl) { this.close(); return }
      if (this._visible) this._notify(hostedUrl, true)
    } catch {
      this.close()
    }
  }

  /** Mint a hosted feedback URL (and with it a fresh reporter token `ft`), or
   *  null when initiate refused. */
  private async _initiate(options: FeedbackOptions): Promise<string | null> {
    const params = new URLSearchParams({ key: this.publishableKey })
    if (options.type) params.set('type', options.type)
    if (options.area) params.set('area', options.area)
    const active = this.getActiveFeatures()
    if (active.length > 0) params.set('session', JSON.stringify(active))

    const { sdkHeaders } = await import('../sdk-headers')
    const base = await sdkHeaders(this.bundleId)
    const url = `${this.apiUrl}/api/sdk/feedback/initiate?${params}`
    // Signed in (#820): `Authorization: Bearer <access token>` makes the server
    // sign the token's user as a VERIFIED reporter. A refused token is refreshed
    // and retried once; refused again, the form still opens without it (as a
    // signed-out call would), so feedback never fails on identity.
    // userId as a header (X-Onelo-User-Id), not a query param → stays out of logs.
    // Without a session it is the developer's unverified label.
    const { status, json } = await sendWithUserToken(this.userToken, async ({ token }) => {
      const headers = { ...base, ...bearerHeader(token), ...(options.userId ? { 'X-Onelo-User-Id': options.userId } : {}) }
      const res = await fetch(url, { headers })
      let body: unknown = null
      try { body = await res.json() } catch { /* non-JSON error body */ }
      return { status: res.status, json: body }
    }, () => {})
    if (status < 200 || status >= 300) return null
    return (json as { hosted_url?: string } | null)?.hosted_url || null
  }

  /**
   * Answer the hosted form's `onelo:renew_request` (kind `feedback`, #622). The
   * form's reporter token `ft` lives 30 minutes; a form left open longer asks
   * for a fresh one on submit. The open form's options are initiated again, so
   * the report keeps its reporter, type, area and session.
   */
  async renewReply(requestId: string): Promise<RenewReply> {
    try {
      const hostedUrl = await this._initiate(this._options)
      if (hostedUrl) return { type: 'onelo:renewed', request_id: requestId, hosted_url: hostedUrl }
    } catch { /* network: fall through */ }
    return { type: 'onelo:renew_failed', request_id: requestId, reason: 'renew_failed' }
  }

  private _notify(url: string | null, visible: boolean) {
    this._url = url
    this._visible = visible
    this._listeners.forEach(l => l(url, visible))
  }

  subscribe(listener: (url: string | null, visible: boolean) => void): () => void {
    this._listeners.push(listener)
    return () => { this._listeners = this._listeners.filter(l => l !== listener) }
  }

  getCurrentUrl(): string | null { return this._url }
  isVisible(): boolean { return this._visible }
  /** The app's brand tokens (#681) the feedback modal paints its chrome with. */
  brandTokens(): BrandTokens { return this.brand.current() }
  /** @deprecated Use `brandTokens().page_bg`. */
  getPageBackgroundColor(): string { return this.brand.current().page_bg }
}
