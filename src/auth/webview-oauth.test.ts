/**
 * Tests for the shared WebView-OAuth helpers (webview-oauth.ts) used by the auth,
 * store, and customer-portal modals.
 *
 * The three properties that matter for security + App Review compliance:
 *   - parseCallbackDeepLink surfaces the host so callers can enforce
 *     `host === 'callback'` (guard #6) — an arbitrary `onelorn://evil?code=x`
 *     must be rejectable, never silently exchanged.
 *   - isOAuthNavigation diverts provider hosts + our oauth-init endpoint to the
 *     system browser (App Review 4.5.4 / Google embedded-UA block), but NOT the
 *     hosted page's own navigations.
 *   - buildHostedInitUrl targets the token-authenticated hosted-init route (the
 *     bare `/oauth/{provider}` alias 422s on a plain token).
 */
import { describe, it, expect } from 'vitest'
import {
  parseCallbackDeepLink,
  isOAuthNavigation,
  buildHostedInitUrl,
  parseOAuthMessage,
  withOAuthPreauth,
  OAUTH_PROVIDER_HOSTS,
} from './webview-oauth'

const SCHEME = 'onelorn'

describe('parseCallbackDeepLink — host guard', () => {
  it('exposes host "callback" for a legitimate callback so the code is trusted', () => {
    const parsed = parseCallbackDeepLink(`${SCHEME}://callback?code=abc123`, SCHEME)
    expect(parsed).not.toBeNull()
    expect(parsed!.host).toBe('callback')
    expect(parsed!.params['code']).toBe('abc123')
    // A caller enforcing `host === 'callback'` accepts this one.
    expect(parsed!.host === 'callback').toBe(true)
  })

  it('exposes a NON-callback host so an injected onelorn://evil?code=x is rejectable', () => {
    const parsed = parseCallbackDeepLink(`${SCHEME}://evil?code=x`, SCHEME)
    expect(parsed).not.toBeNull()
    // host is 'evil', not 'callback' → a caller enforcing the guard rejects it.
    expect(parsed!.host).toBe('evil')
    expect(parsed!.host === 'callback').toBe(false)
    // The code IS parsed out (so a naive caller could smuggle it) — the host
    // guard is exactly what stops that.
    expect(parsed!.params['code']).toBe('x')
  })

  it('lowercases the host so an EVIL / Callback host can\'t bypass a lowercase compare', () => {
    expect(parseCallbackDeepLink(`${SCHEME}://EVIL?code=x`, SCHEME)!.host).toBe('evil')
    expect(parseCallbackDeepLink(`${SCHEME}://Callback?code=x`, SCHEME)!.host).toBe('callback')
  })

  it('parses source + event params (portal callback shape)', () => {
    const parsed = parseCallbackDeepLink(`${SCHEME}://callback?source=portal&event=account_revoked`, SCHEME)
    expect(parsed!.host).toBe('callback')
    expect(parsed!.params['source']).toBe('portal')
    expect(parsed!.params['event']).toBe('account_revoked')
  })

  it('URL-decodes param values', () => {
    const parsed = parseCallbackDeepLink(`${SCHEME}://callback?code=a%20b%2Bc`, SCHEME)
    expect(parsed!.params['code']).toBe('a b+c')
  })

  it('returns null for a different scheme', () => {
    expect(parseCallbackDeepLink('https://callback?code=x', SCHEME)).toBeNull()
    expect(parseCallbackDeepLink('evil://callback?code=x', SCHEME)).toBeNull()
  })
})

describe('isOAuthNavigation — system-browser diversion', () => {
  it('matches every provider host', () => {
    for (const host of OAUTH_PROVIDER_HOSTS) {
      expect(isOAuthNavigation(`https://${host}/authorize?client_id=1`)).toBe(true)
    }
  })

  it('matches the oauth-init path for each provider', () => {
    expect(isOAuthNavigation('https://st.backend.onelo.tools/api/sdk/auth/oauth/github')).toBe(true)
    expect(isOAuthNavigation('https://st.backend.onelo.tools/api/sdk/auth/oauth/google?token=t')).toBe(true)
    expect(isOAuthNavigation('https://st.backend.onelo.tools/api/sdk/auth/oauth/apple/')).toBe(true)
  })

  it('matches a provider host even with a port', () => {
    expect(isOAuthNavigation('https://github.com:443/login/oauth')).toBe(true)
  })

  it('does NOT divert the hosted page itself', () => {
    expect(isOAuthNavigation('https://st.onelo.tools/hosted/signin')).toBe(false)
    expect(isOAuthNavigation('https://st.backend.onelo.tools/api/sdk/auth/initiate')).toBe(false)
    // hosted-init is the token hand-off WE build + open ourselves; it is not a
    // provider host and not the oauth-init /{provider} path, so it isn't diverted.
    expect(isOAuthNavigation('https://st.backend.onelo.tools/api/sdk/auth/oauth/hosted-init?provider=github')).toBe(false)
  })

  it('does NOT match a look-alike host as a substring', () => {
    expect(isOAuthNavigation('https://github.com.evil.example/x')).toBe(false)
    expect(isOAuthNavigation('https://notgithub.com/x')).toBe(false)
  })

  it('returns false for non-http(s) urls', () => {
    expect(isOAuthNavigation('onelorn://callback?code=x')).toBe(false)
  })
})

describe('buildHostedInitUrl — shape + encoding', () => {
  it('targets the token-authenticated hosted-init route (not the 422-ing alias)', () => {
    const url = buildHostedInitUrl('https://api.example.com', 'github', 'tok123')
    expect(url).toBe('https://api.example.com/api/sdk/auth/oauth/hosted-init?provider=github&token=tok123')
    expect(url).toContain('/api/sdk/auth/oauth/hosted-init?')
    // Must NOT be the bare /oauth/{provider}?token= alias that 422s.
    expect(url).not.toMatch(/\/oauth\/github\?token=/)
  })

  it('URL-encodes provider + token', () => {
    const url = buildHostedInitUrl('https://api.example.com', 'goo gle', 'a+b/c=')
    expect(url).toContain('provider=goo%20gle')
    expect(url).toContain('token=a%2Bb%2Fc%3D')
  })
})

describe('parseOAuthMessage', () => {
  it('parses a native_oauth signal', () => {
    const msg = parseOAuthMessage(JSON.stringify({ type: 'onelo:native_oauth', provider: 'github', token: 't' }))
    expect(msg).toEqual({ type: 'native_oauth', provider: 'github', token: 't' })
  })

  it('parses a native_oauth_url signal', () => {
    const msg = parseOAuthMessage(JSON.stringify({ type: 'onelo:native_oauth_url', url: 'https://github.com/x' }))
    expect(msg).toEqual({ type: 'native_oauth_url', url: 'https://github.com/x' })
  })

  it('returns null for unrelated / malformed messages', () => {
    expect(parseOAuthMessage(JSON.stringify({ type: 'onelo:code', code: 'x' }))).toBeNull()
    expect(parseOAuthMessage('not json')).toBeNull()
    expect(parseOAuthMessage(JSON.stringify({ type: 'onelo:native_oauth', provider: 'github' }))).toBeNull()
  })
})

describe('withOAuthPreauth', () => {
  it('appends oauth_preauth and drops stale oauth_* params', () => {
    const out = withOAuthPreauth('https://st.onelo.tools/store?lang=en&oauth_code=old', 'jwt123')
    expect(out).toContain('lang=en')
    expect(out).toContain('oauth_preauth=jwt123')
    expect(out).not.toContain('oauth_code=old')
  })
})
