/**
 * Shared WebView-OAuth helpers used by the auth, store, and customer-portal
 * modals. Third-party OAuth (GitHub/Google/Apple) MUST run in the SYSTEM BROWSER,
 * never the embedded WebView — App Store Review 4.5.4 forbids embedded webviews
 * for third-party OAuth, and Google/Apple actively block embedded UAs. Swift
 * parity (`OneloAuthView.decidePolicyFor`). Extracted from `auth-modal.tsx` so the
 * store + portal modals can enforce the same diversion + deep-link host guard.
 */

/** OAuth provider hosts that MUST open in the system browser, never the embedded
 *  WebView. Swift parity (`OneloAuthView.decidePolicyFor`). */
export const OAUTH_PROVIDER_HOSTS = ['github.com', 'accounts.google.com', 'appleid.apple.com']

/** Our own init endpoint that 302s to a provider. Diverting it (rather than the
 *  final provider URL) to the system browser lets the whole redirect chain —
 *  including any provider SSO cookies — happen in Safari/Chrome. Matches the
 *  Swift regex `^/api/sdk/auth/oauth/(github|google|apple)`. */
export const OAUTH_INIT_PATH_RE = /^\/api\/sdk\/auth\/oauth\/(github|google|apple)(\/|$|\?)/

/** OAuth signals relayed from the hosted page. `native_oauth` carries a provider
 *  + a fresh access token (we build the init URL from `apiUrl`); `native_oauth_url`
 *  carries a fully-built provider URL (the paid-store flow, where the hosted page
 *  already called `/store-oauth-init`). Swift parity (`onelo:native_oauth` /
 *  `onelo:native_oauth_url` in `userContentController`). */
export type ParsedOAuthMessage =
  | { type: 'native_oauth'; provider: string; token: string; intent?: string }
  | { type: 'native_oauth_url'; url: string }
  | null

export function parseOAuthMessage(data: string): ParsedOAuthMessage {
  try {
    const msg = JSON.parse(data) as Record<string, unknown>
    if (
      msg['type'] === 'onelo:native_oauth' &&
      typeof msg['provider'] === 'string' &&
      typeof msg['token'] === 'string'
    ) {
      return {
        type: 'native_oauth',
        provider: msg['provider'] as string,
        token: msg['token'] as string,
        // WHICH BUTTON the user pressed. Carried, never decided here — see
        // buildHostedInitUrl. Absent on an older hosted page, which the URL
        // builder treats as a sign-in (the safe default).
        intent: typeof msg['intent'] === 'string' ? (msg['intent'] as string) : undefined,
      }
    }
    if (msg['type'] === 'onelo:native_oauth_url' && typeof msg['url'] === 'string') {
      return { type: 'native_oauth_url', url: msg['url'] as string }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Parse a custom-scheme deep link (`onelorn://callback?code=…`). RN's `URL` is
 * unreliable for non-http schemes, so parse by hand. Returns the (lowercased)
 * host + decoded query params, or `null` if the scheme doesn't match. The host
 * is the segment between `<scheme>://` and the first `/` or `?`.
 *
 * Callers MUST verify `host === 'callback'` before trusting any `code` — without
 * it a stored XSS on the hosted page could navigate to `onelorn://anything?code=X`
 * and smuggle an arbitrary code into the exchange (Swift parity, guard #6).
 */
/**
 * Is this deep-linked gate URL one of Onelo's own hosted surfaces?
 *
 * A magic link the Access Gate turns down carries no code, by design — the
 * backend withholds it rather than let the app decide. The refusal travels as
 * `<scheme>://callback?gate=<url>` and is then LOADED in the app's own sign-in
 * WebView, and any app on the device can fire a custom scheme at us. So the URL
 * is checked against an origin the BACKEND named, never accepted on trust.
 *
 * The anchor is the hosted URL this flow is already showing — `/flow/init` gave
 * it to us moments ago. No persistence needed: a gate refusal can only arrive
 * while a hosted flow is open.
 *
 * Fails CLOSED — non-https, unparsable, or a different host all answer false. A
 * false negative costs one re-resolve back to sign-in; a false positive renders
 * an attacker's page inside this app.
 */
export function isOneloHostedSurface(gateUrl: string, hostedUrl: string): boolean {
  try {
    const gate = new URL(gateUrl)
    const anchor = new URL(hostedUrl)
    if (gate.protocol !== 'https:') return false
    return gate.host.toLowerCase() === anchor.host.toLowerCase()
  } catch {
    return false
  }
}

export function parseCallbackDeepLink(
  url: string,
  scheme: string,
): { host: string; params: Record<string, string> } | null {
  const prefix = `${scheme}://`
  if (!url.toLowerCase().startsWith(prefix.toLowerCase())) return null
  let rest = url.slice(prefix.length)
  let query = ''
  const q = rest.indexOf('?')
  if (q !== -1) {
    query = rest.slice(q + 1)
    rest = rest.slice(0, q)
  }
  const slash = rest.indexOf('/')
  const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase()
  const params: Record<string, string> = {}
  for (const part of query.split('&')) {
    if (!part) continue
    const eq = part.indexOf('=')
    const k = eq === -1 ? part : part.slice(0, eq)
    const v = eq === -1 ? '' : part.slice(eq + 1)
    if (k) {
      try {
        params[decodeURIComponent(k)] = decodeURIComponent(v)
      } catch {
        params[k] = v
      }
    }
  }
  return { host, params }
}

/** Extract host (no port) + path from an http(s) URL without relying on `URL`. */
function httpHostPath(url: string): { host: string; path: string } | null {
  const m = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(url)
  if (!m) return null
  return { host: m[1].toLowerCase().replace(/:\d+$/, ''), path: m[2] || '/' }
}

/** True when a top-level navigation should be handed to the system browser
 *  instead of loaded in the embedded WebView (provider host or our oauth-init
 *  endpoint). */
export function isOAuthNavigation(url: string): boolean {
  const hp = httpHostPath(url)
  if (!hp) return false
  return OAUTH_PROVIDER_HOSTS.includes(hp.host) || OAUTH_INIT_PATH_RE.test(hp.path)
}

/** Re-open the hosted page with `?oauth_preauth=<jwt>` so the store client drives
 *  the Stripe step after a paid-product OAuth (`preauth` callback). Strips any
 *  stale `oauth_*` params first so a reload never reuses a consumed token.
 *  Mirrors Swift's store-reload branch in `startNativeOAuth`. */
export function withOAuthPreauth(url: string, preauth: string): string {
  const [beforeHash, hash] = url.split('#')
  const qIdx = beforeHash.indexOf('?')
  const path = qIdx === -1 ? beforeHash : beforeHash.slice(0, qIdx)
  const query = qIdx === -1 ? '' : beforeHash.slice(qIdx + 1)
  const kept = query
    .split('&')
    .filter((p) => p && !/^oauth_(preauth|code|error)=/i.test(p))
  kept.push(`oauth_preauth=${encodeURIComponent(preauth)}`)
  return `${path}?${kept.join('&')}${hash ? `#${hash}` : ''}`
}

/**
 * Build the system-browser hand-off URL for a `native_oauth{provider,token}`
 * signal. The correct token-authenticated route is
 * `GET /api/sdk/auth/oauth/hosted-init?provider=&token=`. The bare
 * `/api/sdk/auth/oauth/{provider}` alias is an authorization-code endpoint that
 * requires `key` + `redirect_uri` + `code_challenge` and 422s on a plain token —
 * do NOT target it here (shared-with-Swift bug; RN fixes it).
 */
export function buildHostedInitUrl(
  apiUrl: string,
  provider: string,
  token: string,
  intent?: string,
): string {
  // `intent` decides whether the backend may CREATE an account. OAuth returns a
  // verified identity and never an intention, so the backend defaults to
  // `signin`, which refuses to create one — and a sign-up that fails to say so
  // is silently downgraded into "This account isn't registered", whichever
  // button the user pressed (found on Flutter, 2026-08-19; this builder had the
  // same hole).
  //
  // Only the value the backend defines travels; anything else falls back to the
  // safe default. This function CARRIES the intent — the hosted page decided it.
  const wantsSignUp = intent === 'signup' ? '&intent=signup' : ''
  return (
    `${apiUrl}/api/sdk/auth/oauth/hosted-init` +
    `?provider=${encodeURIComponent(provider)}&token=${encodeURIComponent(token)}${wantsSignUp}`
  )
}

/**
 * Injected after the hosted page loads. The page posts its OAuth signals
 * (`onelo:native_oauth` / `onelo:native_oauth_url`) via a native bridge or
 * `window.postMessage`; this relay forwards a matching payload to the RN bridge,
 * where `onMessage` picks it up. Mirrors the consent relay + Swift's
 * `WKScriptMessageHandler`. (The reliable path on RN is the navigation diversion
 * in `onShouldStartLoadWithRequest` — the hosted page falls back to a
 * `window.location.href` navigation when no native bridge is detected — so this
 * relay is a forward-compat complement.)
 */
export const OAUTH_RELAY_SCRIPT = `
(function () {
  function forward(d) {
    try {
      if (typeof d === 'string') { d = JSON.parse(d); }
      // Forward the OAuth hand-off AND the hosted-flow success/cancel codes. The
      // hosted store's sendSuccess() posts { type:'onelo:code', code } to
      // window.parent — which, inside react-native-webview, is window itself, so it
      // fires a same-window 'message' event that ONLY reaches the native side if we
      // relay it to ReactNativeWebView.postMessage here. Without this, an in-WebView
      // store purchase renders "You're in!" but the code never reaches the app →
      // no exchange, no auto-login.
      if (d && (
        d.type === 'onelo:native_oauth' ||
        d.type === 'onelo:native_oauth_url' ||
        d.type === 'onelo:code' ||
        d.type === 'onelo:cancelled' ||
        // #40 Phase 2 — the hosted page signals it has mounted so the host can hide
        // its native fail-safe ✕ (used by the customer-portal modal; auth/store
        // ignore it). The canonical ✕ is then owned by the hosted page.
        d.type === 'onelo:ready'
      )) {
        window.ReactNativeWebView.postMessage(JSON.stringify(d));
      }
    } catch (err) { /* ignore non-JSON page messages */ }
  }
  window.addEventListener('message', function (e) { forward(e.data); });
  true;
})();
`

/**
 * Open a provider URL in the SYSTEM BROWSER (never the embedded WebView). The
 * provider redirects back to `onelorn://callback?code=…` (or `?preauth=`), captured
 * by each modal's `Linking` url listener. `onError` fires when the OS cannot open
 * the URL (no browser / malformed URL) so the caller can surface it.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function openInSystemBrowser(Linking: any, url: string, onError: () => void): void {
  Linking.openURL(url).catch(() => onError())
}
