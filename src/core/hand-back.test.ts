import { describe, it, expect } from 'vitest'
import { classifyHandBack } from './hand-back'

// #615 — the one Store Hand-back decoder; the store and portal modals both
// decide from it.
describe('classifyHandBack', () => {
  it.each([
    ['purchase (P1/P2)', 'onelorn://callback?code=oac_1', { kind: 'purchase', code: 'oac_1' }],
    ['interval switch (P3)', 'onelorn://callback?source=store&event=plan_switched', { kind: 'switched', reason: 'plan_switched' }],
    ['lagging paid switch (P3t)', 'onelorn://callback?source=store&event=plan_switch_pending', { kind: 'switched', reason: 'plan_switch_pending' }],
    ['scheduled downgrade (P5)', 'onelorn://callback?source=store&event=switch_scheduled', { kind: 'switched', reason: 'switch_scheduled' }],
    ['switch without a reason', 'onelorn://callback?source=store', { kind: 'switched', reason: '' }],
    ['portal Done (P8)', 'onelorn://callback?source=portal', { kind: 'portal_closed', event: undefined }],
    ['portal Done + event', 'onelorn://callback?source=portal&event=account_revoked', { kind: 'portal_closed', event: 'account_revoked' }],
    ['store OAuth, payment owed', 'onelorn://callback?preauth=jwt', { kind: 'preauth', preauth: 'jwt' }],
    ['dead link (P14, #619)', 'onelorn://callback?error=token_expired', { kind: 'expired' }],
    ['dead link, legacy code (#619)', 'onelorn://callback?error=expired_token', { kind: 'expired' }],
    ['other error', 'onelorn://callback?error=access_denied', { kind: 'cancelled' }],
    ['bare callback', 'onelorn://callback', { kind: 'cancelled' }],
    ['foreign host (guard #6)', 'onelorn://evil?code=abc', { kind: 'invalid' }],
  ])('%s', (_n, url, expected) => {
    expect(classifyHandBack(url, 'onelorn')).toEqual(expected)
  })

  it('ignores other schemes and web pages', () => {
    expect(classifyHandBack('otherapp://callback?code=x', 'onelorn')).toBeNull()
    expect(classifyHandBack('https://st.onelo.tools/store/hosted', 'onelorn')).toBeNull()
  })
})

// #627 — the same hand-back arriving as a relayed postMessage. The page's wire
// format is frontend/lib/store-hand-back.ts `handBackMessage`.
import { classifyHandBackMessage } from './hand-back'
import { OAUTH_RELAY_SCRIPT } from '../auth/webview-oauth'

describe('classifyHandBackMessage', () => {
  it.each([
    ['purchase', { type: 'onelo:code', code: 'oac_1' }, { kind: 'purchase', code: 'oac_1' }],
    ['plan switch', { type: 'onelo:done', reason: 'switch_scheduled' }, { kind: 'switched', reason: 'switch_scheduled' }],
    ['dead link (#619)', { type: 'onelo:cancel', reason: 'expired' }, { kind: 'expired' }],
    ['store ✕ (no reason)', { type: 'onelo:cancel' }, { kind: 'cancelled' }],
  ])('%s', (_n, msg, expected) => {
    expect(classifyHandBackMessage(JSON.stringify(msg))).toEqual(expected)
  })

  it.each([
    ['onelo:ready', JSON.stringify({ type: 'onelo:ready' })],
    ['an OAuth hand-off', JSON.stringify({ type: 'onelo:native_oauth', provider: 'google', token: 't' })],
    ['a code message without a code', JSON.stringify({ type: 'onelo:code' })],
    ['the retired onelo:cancelled', JSON.stringify({ type: 'onelo:cancelled' })],
    ['not JSON', 'native_oauth:google'],
    ['JSON null', 'null'],
  ])('ignores %s', (_n, raw) => {
    expect(classifyHandBackMessage(raw)).toBeNull()
  })
})

describe('OAUTH_RELAY_SCRIPT forwards every store hand-back (#627)', () => {
  function runRelay() {
    let listener: ((e: { data: unknown }) => void) | null = null
    const posted: string[] = []
    const win = {
      addEventListener: (type: string, fn: (e: { data: unknown }) => void) => { if (type === 'message') listener = fn },
      ReactNativeWebView: { postMessage: (s: string) => { posted.push(s) } },
    }
    new Function('window', OAUTH_RELAY_SCRIPT)(win)
    return { send: (data: unknown) => listener?.({ data }), posted }
  }

  it.each([
    [{ type: 'onelo:cancel', reason: 'expired' }, { kind: 'expired' }],
    [{ type: 'onelo:done', reason: 'plan_switched' }, { kind: 'switched', reason: 'plan_switched' }],
    [{ type: 'onelo:code', code: 'oac_9' }, { kind: 'purchase', code: 'oac_9' }],
  ])('%o reaches the native side and decodes', (msg, expected) => {
    const relay = runRelay()
    relay.send(msg)
    expect(relay.posted).toHaveLength(1)
    expect(classifyHandBackMessage(relay.posted[0]!)).toEqual(expected)
  })

  it('a string payload is relayed too', () => {
    const relay = runRelay()
    relay.send(JSON.stringify({ type: 'onelo:cancel', reason: 'expired' }))
    expect(classifyHandBackMessage(relay.posted[0]!)).toEqual({ kind: 'expired' })
  })
})
