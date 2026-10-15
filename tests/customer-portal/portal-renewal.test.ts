// #613 / #614 — the hosted portal asks the RN SDK for a fresh portal token when
// an action meets a dead one. The SDK re-mints with the user's access token and
// injects the answer back into the page as a self-post.
import { describe, it, expect, vi, afterEach } from 'vitest'

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))
vi.mock('../../src/sdk-headers', () => ({ sdkHeaders: async () => ({}) }))

import { OneloCustomerPortal } from '../../src/customer-portal/customer-portal'
import { parseRenewRequest, renewReplyScript, sameOrigin } from '../../src/customer-portal/portal-renewal'

const FRESH = 'https://onelo.test/customer/portal?token=prt_fresh'

afterEach(() => { httpGet.mockReset() })

function portal(token: string | null = 'user-jwt') {
  return new OneloCustomerPortal('https://api.test', 'pk_test', undefined, async () => token, async () => {})
}

describe('parseRenewRequest', () => {
  it('reads the JSON the page posts through ReactNativeWebView', () => {
    expect(parseRenewRequest(JSON.stringify({ type: 'onelo:renew_request', kind: 'portal', request_id: 'r1' }))).toBe('r1')
  })
  it.each([
    ['another message', JSON.stringify({ type: 'onelo:ready' })],
    ['another kind', JSON.stringify({ type: 'onelo:renew_request', kind: 'store', request_id: 'r1' })],
    ['no id', JSON.stringify({ type: 'onelo:renew_request', kind: 'portal' })],
    ['not JSON', 'native_oauth:google'],
  ])('ignores %s', (_l, raw) => {
    expect(parseRenewRequest(raw)).toBeNull()
  })
})

describe('renewReplyScript', () => {
  it('self-posts the reply as an object literal', () => {
    const script = renewReplyScript({ type: 'onelo:renewed', request_id: 'r1', hosted_url: FRESH })
    expect(script).toBe(`window.postMessage({"type":"onelo:renewed","request_id":"r1","hosted_url":"${FRESH}"}, '*'); true;`)
  })
  it('cannot be broken out of by a hostile value', () => {
    const script = renewReplyScript({ type: 'onelo:renew_failed', request_id: `"); alert(1); ("`, reason: 'x' })
    expect(script).toContain('\\"); alert(1); (\\"')
  })
})

describe('renewReply', () => {
  it('mints a fresh portal with the current access token', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { hosted_url: FRESH } })
    expect(await portal().renewReply('r1')).toEqual({ type: 'onelo:renewed', request_id: 'r1', hosted_url: FRESH })
    const [url, headers] = httpGet.mock.calls[0]
    expect(url).toContain('/api/sdk/paywall/portal-initiate?key=pk_test')
    expect(headers.Authorization).toBe('Bearer user-jwt')
  })
  it('signed out → not_authenticated, no request', async () => {
    expect(await portal(null).renewReply('r2')).toEqual({ type: 'onelo:renew_failed', request_id: 'r2', reason: 'not_authenticated' })
    expect(httpGet).not.toHaveBeenCalled()
  })
  it('refused access token (401) → not_authenticated; server error → renew_failed', async () => {
    httpGet.mockResolvedValueOnce({ status: 401, json: {} })
    expect((await portal().renewReply('r3')).reason).toBe('not_authenticated')
    httpGet.mockResolvedValueOnce({ status: 502, json: {} })
    expect((await portal().renewReply('r4')).reason).toBe('renew_failed')
  })
  it('is exposed on the modal state the modal reads', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { hosted_url: FRESH } })
    const reply = await portal().getModalState().onRenewRequest('r5')
    expect(reply.type).toBe('onelo:renewed')
  })
})

describe('sameOrigin (#614 review N1)', () => {
  it('answers only a page on the portal origin', () => {
    expect(sameOrigin('https://Onelo.tools/store/hosted?token=srt_1', 'https://onelo.tools/customer/portal?token=prt_1')).toBe(true)
    expect(sameOrigin('https://checkout.stripe.com/pay', 'https://onelo.tools/customer/portal')).toBe(false)
    expect(sameOrigin('http://localhost:3000/x', 'http://localhost:3001/x')).toBe(false)
    expect(sameOrigin(undefined, 'https://onelo.tools')).toBe(false)
  })
})

// #606 — change-plan intent and the upgrade opened in the SDK's portal modal.
import { withPortalIntent } from '../../src/customer-portal/customer-portal'
import { OneloStore } from '../../src/store/store'

describe('withPortalIntent', () => {
  it('adds intent=change_plan to the hosted portal URL', () => {
    expect(withPortalIntent('https://onelo.test/customer/portal?token=prt_1', 'change_plan'))
      .toBe('https://onelo.test/customer/portal?token=prt_1&intent=change_plan')
  })
  it('leaves the URL alone without an intent', () => {
    expect(withPortalIntent('https://onelo.test/customer/portal?token=prt_1')).toBe('https://onelo.test/customer/portal?token=prt_1')
  })
})

describe("customerPortal.open({ intent: 'change_plan' })", () => {
  it('presents the portal URL carrying the intent, then re-reads the entitlement', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { hosted_url: 'https://onelo.test/customer/portal?token=prt_1' } })
    const onClosed = vi.fn(async () => 'active')
    const p = new OneloCustomerPortal('https://api.test', 'pk_test', undefined, async () => 'jwt', async () => {}, undefined, undefined, 'onelorn', onClosed)
    p.onPortalStateChange(() => {})
    const done = p.open({ intent: 'change_plan' })
    await vi.waitFor(() => expect(p.getModalState().visible).toBe(true))
    expect(p.getModalState().hostedUrl).toBe('https://onelo.test/customer/portal?token=prt_1&intent=change_plan')
    p.getModalState().onResult!({ type: 'done' })
    await done
    expect(onClosed).toHaveBeenCalledTimes(1)
  })
})

describe('store.openUpgrade (#606)', () => {
  const UPGRADE = 'https://onelo.test/store/hosted?token=srt_1'
  function store(host: { hasModalHost: boolean; presentUrl: (u: string) => Promise<void> } | undefined) {
    return new OneloStore('https://api.test', 'pk_test', undefined, async () => 'jwt', undefined, undefined, 'onelorn', undefined, host)
  }

  it('presents the upgrade URL in the mounted portal modal', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { upgrade_url: UPGRADE, target: 'store_switch' } })
    const presentUrl = vi.fn(async () => {})
    await store({ hasModalHost: true, presentUrl }).openUpgrade('pro')
    expect(presentUrl).toHaveBeenCalledWith(UPGRADE)
  })

  it('without a mounted modal it opens the system browser and warns', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { upgrade_url: UPGRADE, target: 'store' } })
    const presentUrl = vi.fn(async () => {})
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    // `Linking` needs the real react-native runtime, absent under node — the
    // fallback's require throws here; what matters is that the modal is skipped.
    await store({ hasModalHost: false, presentUrl }).openUpgrade('pro').catch(() => {})
    expect(presentUrl).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })
})
