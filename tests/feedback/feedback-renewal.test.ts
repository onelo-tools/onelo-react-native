// #622 — the hosted feedback form's reporter token `ft` lives 30 minutes. A form
// left open longer asks the RN SDK for a fresh one on submit; the SDK initiates
// the open form's options again and the modal injects the answer as a self-post.
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('../../src/sdk-headers', () => ({ sdkHeaders: async () => ({ 'X-Bundle-Id': 'com.app' }) }))

import { OneloFeedback } from '../../src/feedback/feedback'
import { parseRenewRequest } from '../../src/customer-portal/portal-renewal'

const HOSTED = 'https://onelo.test/feedback/hosted?key=pk_test&ft=old'
const FRESH = 'https://onelo.test/feedback/hosted?key=pk_test&ft=fresh'

const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)
afterEach(() => fetchMock.mockReset())

const ok = (hosted_url: string) => ({ ok: true, status: 200, json: async () => ({ hosted_url }) })

describe('parseRenewRequest(kind: feedback)', () => {
  it('reads the feedback form request', () => {
    expect(parseRenewRequest(JSON.stringify({ type: 'onelo:renew_request', kind: 'feedback', request_id: 'r1' }), 'feedback')).toBe('r1')
  })
  it('a portal request is not a feedback request, and the reverse', () => {
    expect(parseRenewRequest(JSON.stringify({ type: 'onelo:renew_request', kind: 'portal', request_id: 'r1' }), 'feedback')).toBeNull()
    expect(parseRenewRequest(JSON.stringify({ type: 'onelo:renew_request', kind: 'feedback', request_id: 'r1' }))).toBeNull()
  })
})

describe('OneloFeedback.renewReply', () => {
  async function openForm() {
    const fb = new OneloFeedback('https://api.test', 'pk_test', () => ['beta'], 'com.app')
    fetchMock.mockResolvedValueOnce(ok(HOSTED))
    fb.open({ type: 'bug', area: 'checkout', userId: 'u-1' })
    await vi.waitFor(() => expect(fb.getCurrentUrl()).toBe(HOSTED))
    return fb
  }

  it('re-initiates the open form options and answers with the fresh URL', async () => {
    const fb = await openForm()
    fetchMock.mockResolvedValueOnce(ok(FRESH))
    expect(await fb.renewReply('r1')).toEqual({ type: 'onelo:renewed', request_id: 'r1', hosted_url: FRESH })
    const [url, init] = fetchMock.mock.calls[1] as [string, { headers: Record<string, string> }]
    expect(url).toContain('/api/sdk/feedback/initiate?key=pk_test')
    expect(url).toContain('type=bug')
    expect(url).toContain('area=checkout')
    expect(init.headers['X-Onelo-User-Id']).toBe('u-1')
    expect(init.headers['X-Bundle-Id']).toBe('com.app')
  })

  it('a refused initiate answers renew_failed', async () => {
    const fb = await openForm()
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    expect(await fb.renewReply('r2')).toEqual({ type: 'onelo:renew_failed', request_id: 'r2', reason: 'renew_failed' })
  })
})
