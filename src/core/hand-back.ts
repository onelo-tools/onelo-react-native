import { parseCallbackDeepLink } from '../auth/webview-oauth'

/**
 * Store Hand-back (#615) — the ONE decoder for "the hosted page is finished"
 * in this SDK. The hosted store and Customer Portal navigate the WebView to
 * `<scheme>://callback?…` (produced by one helper on the page,
 * frontend/lib/store-hand-back.ts, plus the portal's Done):
 *   `?code=`                   a purchase finished → exchange the code
 *   `?source=store&event=<r>`  a plan switch finished without a code
 *                              (plan_switched | switch_scheduled |
 *                              plan_switch_pending) — a success
 *   `?source=portal[&event=]`  the Customer Portal closed
 *   `?preauth=`                store OAuth done, payment still owed (continue)
 *   `?error=token_expired`     the link died (#619) → the opener restarts it
 *   other `?error=` / nothing  not finished → cancel
 * The store modal and the portal modal both decide from this, so a new
 * terminal reaches both at once.
 *
 * `invalid` = the scheme matched but the host is not `callback` (guard #6: a
 * stored XSS must not smuggle a code in via `<scheme>://anything?code=`).
 * Returns null when `url` is not this app's scheme at all.
 */
export type HandBack =
  | { kind: 'purchase'; code: string }
  | { kind: 'switched'; reason: string }
  | { kind: 'portal_closed'; event: string | undefined }
  | { kind: 'preauth'; preauth: string }
  | { kind: 'cancelled' }
  /** The page's link is dead (#619). Not a cancel: the store modal re-runs
   *  store-initiate and loads the fresh URL in place. */
  | { kind: 'expired' }
  | { kind: 'invalid' }

/**
 * The same hand-back when it arrives as a page postMessage instead of a
 * deep-link (#627). A WebView relays the store's `window.postMessage` through
 * `OAUTH_RELAY_SCRIPT` (wire format: frontend/lib/store-hand-back.ts):
 *   `{type:'onelo:code', code}`             → purchase
 *   `{type:'onelo:done', reason}`           → switched
 *   `{type:'onelo:cancel', reason:'expired'}` → expired (#619)
 *   `{type:'onelo:cancel'}`                 → cancelled
 * Anything else (OAuth hand-offs, `onelo:ready`, renew requests) → null, for
 * the modal's other handlers.
 */
export function classifyHandBackMessage(data: string): HandBack | null {
  let msg: Record<string, unknown>
  try {
    const parsed = JSON.parse(data) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    msg = parsed as Record<string, unknown>
  } catch {
    return null
  }
  switch (msg['type']) {
    case 'onelo:code':
      return typeof msg['code'] === 'string' && msg['code'] ? { kind: 'purchase', code: msg['code'] } : null
    case 'onelo:done':
      return { kind: 'switched', reason: typeof msg['reason'] === 'string' ? msg['reason'] : '' }
    case 'onelo:cancel':
      return msg['reason'] === 'expired' ? { kind: 'expired' } : { kind: 'cancelled' }
    default:
      return null
  }
}

export function classifyHandBack(url: string, scheme: string): HandBack | null {
  const parsed = parseCallbackDeepLink(url, scheme)
  if (!parsed) return null
  if (parsed.host !== 'callback') return { kind: 'invalid' }
  const p = parsed.params
  if (p['source'] === 'store') return { kind: 'switched', reason: p['event'] ?? '' }
  if (p['source'] === 'portal') return { kind: 'portal_closed', event: p['event'] }
  if (p['code']) return { kind: 'purchase', code: p['code'] }
  if (p['preauth']) return { kind: 'preauth', preauth: p['preauth'] }
  if (p['error'] === 'token_expired' || p['error'] === 'expired_token') return { kind: 'expired' }
  return { kind: 'cancelled' }
}
