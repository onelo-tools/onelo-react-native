import { httpGet, httpPost, OneloError, type BrandTokens } from '@onelo/core'
import { sdkHeaders } from '../sdk-headers'
import type { OneloAuth } from '../auth/auth'
import type { OneloEventStream } from '../core/event-stream'
import type { ConsentResult } from './consent-modal'

/**
 * Legal-consent enforcement level. `block` gates the app until accepted;
 * `notify` is informational. Unknown future values decode to `unknown`
 * (forward-compat — never throws), mirroring Swift/Electron.
 */
export type OneloConsentEnforcement = 'block' | 'notify' | 'unknown'

/**
 * One legal document the signed-in user has not yet accepted. Wire keys are
 * snake_case (see `_mapRequirement`); this is the camelCase SDK shape.
 */
export interface OneloConsentRequirement {
  /** Document type: "terms" | "privacy" | "dpa" | "cookies" (open set). */
  docType: string
  /** The version id to POST back on accept (`document_version_id`). */
  versionId: string
  /** Human version label, e.g. "2026-06-01-v2". */
  version: string
  /** `block` | `notify` | `unknown`. */
  enforcement: OneloConsentEnforcement
  /** True iff this document HARD-blocks the app right now (server-computed:
   *  enforcement=block AND effective_at<=now). The single gate signal. */
  blocking: boolean
  /** Read-only document URL (may be null for platform-scope docs). */
  url: string | null
  /** Gate-mode URL (document + accept/decline buttons); loaded in the gate
   *  modal. Null for platform-scope docs. */
  consentUrl: string | null
}

/** Modal state consumed by <ConsentGateModal> / useConsentModalState. */
export type ConsentModalState = {
  visible: boolean
  hostedUrl: string
  onResult: ((result: ConsentResult) => void) | null
  /** The app's brand tokens (#681): the gate's chrome is painted from them. */
  tokens: BrandTokens
  /** @deprecated Use `tokens.page_bg`. */
  backgroundColor: string
}

/** Map one wire requirement (snake_case) to the SDK shape. Forward-compat:
 *  unknown enforcement → 'unknown'; missing `blocking` → false (never gate on a
 *  field the server didn't send). Rows with no `version_id` are dropped — it's
 *  the load-bearing POST-back key, so a requirement we couldn't accept is useless. */
function _mapRequirement(j: Record<string, unknown>): OneloConsentRequirement | null {
  const versionId = j['version_id']
  const docType = j['doc_type']
  const version = j['version']
  if (typeof versionId !== 'string' || typeof docType !== 'string' || typeof version !== 'string') {
    return null
  }
  const rawEnf = j['enforcement']
  const enforcement: OneloConsentEnforcement =
    rawEnf === 'block' || rawEnf === 'notify' ? rawEnf : 'unknown'
  return {
    docType,
    versionId,
    version,
    enforcement,
    blocking: j['blocking'] === true,
    url: typeof j['url'] === 'string' ? j['url'] : null,
    consentUrl: typeof j['consent_url'] === 'string' ? j['consent_url'] : null,
  }
}

/**
 * Legal-consent gate for signed-in users — the React Native port of Swift's
 * `OneloAuth.requiredConsents()`/`acceptConsent()` + Electron's `OneloConsent`.
 *
 * At sign-in, consent is enforced server-side inside the hosted sign-in page.
 * This class covers the OTHER moment: a user who is ALREADY signed in when you
 * publish a new blocking legal version (Terms update). The gate is triggered
 * (a) on sign-in via the auth-state bridge in onelo.ts, (b) in real time over the
 * shared SSE stream (`legal.consent_required`, see attachEventStream), and
 * (c) whenever the app calls `presentGateIfNeeded()` (e.g. on foreground). If a
 * blocking document is outstanding it presents the hosted gate
 * in a fullscreen, non-dismissible WebView modal. Accept records consent (and
 * re-checks, since documents stack); decline signs the user out. Fail-open on
 * network errors — the gate surfaces real blocking updates, not network blips.
 *
 * Rendering: mount <ConsentGateModal onelo={onelo} /> once near the app root.
 */
export class OneloConsent {
  private readonly apiUrl: string
  private readonly publishableKey: string
  private readonly auth: OneloAuth
  private readonly bundleId?: string
  /** When false, a `legal.consent_required` push (and the sign-in bridge) will
   *  NOT auto-open the gate — the dev drives their own UI via `requiredConsents()`
   *  + `onConsentRequired()`. From `config.autoPresentConsentGate` (default true). */
  private readonly autoPresent: boolean

  private _modalVisible = false
  private _modalUrl = ''
  private _modalResolve: ((result: ConsentResult) => void) | null = null
  private modalStateListeners: Array<() => void> = []

  /** Bumped on each `legal.consent_required` push (parity with Swift's
   *  @Published consentRevision). Observe via `onConsentRequired`. */
  private _consentRevision = 0
  private readonly revisionListeners = new Set<(revision: number) => void>()

  /** Set synchronously at the top of presentGateIfNeeded and held across its
   *  `await requiredConsents()` round-trip — serializes concurrent callers (e.g.
   *  a sign-in bridge trigger + an app foreground call) so only one gate opens.
   *  JS is single-threaded, so a boolean is enough. */
  private _presenting = false

  constructor(apiUrl: string, publishableKey: string, auth: OneloAuth, bundleId?: string, autoPresent = true) {
    if (!apiUrl) throw new Error('[Onelo] apiUrl is required')
    this.apiUrl = apiUrl
    this.publishableKey = publishableKey
    this.auth = auth
    this.bundleId = bundleId
    this.autoPresent = autoPresent
  }

  /** Current consent revision — bumped on each `legal.consent_required` push
   *  (parity with Swift @Published consentRevision). */
  get consentRevision(): number {
    return this._consentRevision
  }

  /**
   * Subscribe to `legal.consent_required` pushes (revision bumps). Returns an
   * unsubscribe fn. Use this when you build your own consent UI (with
   * `autoPresentConsentGate:false`) instead of the auto-presented gate.
   */
  onConsentRequired(listener: (revision: number) => void): () => void {
    this.revisionListeners.add(listener)
    return () => { this.revisionListeners.delete(listener) }
  }

  // ── Real-time consent signal (shared SSE stream) ─────────────────────────────

  /**
   * Register the `legal.consent_required` listener on the shared stream (called
   * once by Onelo). The event is a signal only (payload ignored): on receipt we
   * bump the revision, notify `onConsentRequired` observers, and — unless
   * `autoPresent` is false — re-run the gate. Keeps the existing
   * `presentGateIfNeeded` concurrency guard, so a push that races the sign-in
   * bridge can't stack a second gate.
   */
  attachEventStream(stream: OneloEventStream): void {
    stream.on('legal.consent_required', () => {
      this._consentRevision++
      for (const l of [...this.revisionListeners]) {
        try { l(this._consentRevision) } catch { /* a listener must never break the stream */ }
      }
      if (this.autoPresent) void this.presentGateIfNeeded()
    })
  }

  // ── Data API (mirrors Swift OneloAuth.requiredConsents / acceptConsent) ──────

  /**
   * Fetch the signed-in user's outstanding legal documents. Requires a session;
   * returns `[]` when signed out. Fail-open: any network/non-200/parse failure
   * returns `[]` (never throws).
   */
  async requiredConsents(): Promise<OneloConsentRequirement[]> {
    const session = await this.auth.getSession()
    if (!session) return []
    try {
      const { status, json } = await httpGet(`${this.apiUrl}/v1/sdk/consent/required`, {
        ...(await sdkHeaders(this.bundleId, this.publishableKey)),
        Authorization: `Bearer ${session.accessToken}`,
      })
      if (status !== 200) return []
      const rows = (json as { required?: unknown }).required
      if (!Array.isArray(rows)) return []
      return rows
        .map((r) => _mapRequirement(r as Record<string, unknown>))
        .filter((r): r is OneloConsentRequirement => r !== null)
    } catch {
      // Fail-open — the gate surfaces real blocking updates, not network blips.
      return []
    }
  }

  /**
   * Record acceptance of a legal document version. Requires a session. Throws
   * `OneloError` on no-session or a non-2xx response. Server-side idempotent.
   */
  async acceptConsent(versionId: string): Promise<void> {
    const session = await this.auth.getSession()
    if (!session) throw OneloError.notAuthenticated()
    const { status } = await httpPost(
      `${this.apiUrl}/v1/sdk/consent/accept`,
      // snake_case `document_version_id` — the backend ConsentActionIn model.
      { document_version_id: versionId },
      {
        ...(await sdkHeaders(this.bundleId, this.publishableKey)),
        Authorization: `Bearer ${session.accessToken}`,
      },
    )
    if (status === 401) throw OneloError.notAuthenticated()
    if (status < 200 || status >= 300) throw OneloError.server(`Failed to record consent: HTTP ${status}`)
  }

  // ── Gate presentation ────────────────────────────────────────────────────────

  /**
   * Check for an outstanding BLOCKING consent and, if present, open the hosted
   * gate modal. Resolves `true` if a gate was shown. No-op (returns `false`)
   * when: no session, no blocking document with a gate URL, a gate is already
   * open, or another call is mid-flight. Call this on app foreground; it is also
   * wired to fire automatically on sign-in.
   */
  async presentGateIfNeeded(): Promise<boolean> {
    // A gate is already up, or another call is mid-flight (its `requiredConsents`
    // round-trip hasn't opened the modal yet). Both guards are checked+set
    // synchronously before the first `await`, so concurrent callers can't stack.
    if (this._presenting) return false
    if (this._modalVisible) return false
    this._presenting = true
    try {
      const items = await this.requiredConsents()
      // Need a blocking document AND a gate URL to show (platform-scope docs have
      // no consentUrl → nothing to present; fail-open, same as Swift/Electron).
      const blocker = items.find((i) => i.blocking && i.consentUrl)
      if (!blocker || !blocker.consentUrl) return false
      this._openGate(blocker.consentUrl, blocker.versionId)
      return true
    } finally {
      this._presenting = false
    }
  }

  /** Alias for `presentGateIfNeeded()`. */
  checkConsent(): Promise<boolean> {
    return this.presentGateIfNeeded()
  }

  private _openGate(consentUrl: string, versionId: string): void {
    this._modalUrl = consentUrl
    this._modalResolve = async (result: ConsentResult) => {
      // Clear + notify FIRST so the modal unmounts before we run the next step
      // (accept → re-check re-opens it for the next stacked doc; decline → signOut).
      this._modalVisible = false
      this._modalResolve = null
      this.notifyModalListeners()

      if (result.action === 'accept') {
        // Swallow accept errors (parity with Swift's `try?`) so a transient
        // failure lets the user retry rather than bouncing them out.
        try {
          await this.acceptConsent(versionId)
        } catch {
          /* allow retry */
        }
        // Documents stack (Terms AND Privacy may both be due) — re-check for the
        // NEXT blocking document. `_presenting` is already false here.
        await this.presentGateIfNeeded()
      } else {
        // Decline (or any non-accept) → sign out. No server decline endpoint
        // (parity with Swift/Electron).
        await this.auth.signOut().catch(() => {
          /* best-effort — session may be partly cleared */
        })
      }
    }
    this._modalVisible = true
    this.notifyModalListeners()
  }

  // ── Modal-state plumbing (mirrors auth.ts / customer-portal.ts) ──────────────

  /** Returns current modal state for rendering <ConsentGateModal>. */
  getModalState(): ConsentModalState {
    return {
      visible: this._modalVisible,
      hostedUrl: this._modalUrl,
      onResult: this._modalResolve,
      tokens: this.auth.brandTokens(),
      backgroundColor: this.auth.brandTokens().page_bg,
    }
  }

  /** Subscribe to consent modal state changes. Returns an unsubscribe function. */
  onModalStateChange(callback: () => void): () => void {
    this.modalStateListeners.push(callback)
    return () => {
      this.modalStateListeners = this.modalStateListeners.filter((l) => l !== callback)
    }
  }

  private notifyModalListeners(): void {
    for (const cb of this.modalStateListeners) cb()
  }

  /** Release listeners and hide any open gate. Call on SDK teardown. */
  dispose(): void {
    this.modalStateListeners = []
    this.revisionListeners.clear()
    this._modalResolve = null
    this._modalVisible = false
  }
}
