import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OneloWaitlist } from './waitlist'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

function mockResponse(status: number, body: unknown) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

describe('OneloWaitlist', () => {
  const waitlist = new OneloWaitlist('https://api.onelo.tools', 'onelo_pk_test')

  beforeEach(() => mockFetch.mockReset())

  it('returns success and position on join', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { success: true, position: 3, alreadyJoined: false }))
    const result = await waitlist.join('beta', 'ada@example.com')
    expect(result.success).toBe(true)
    expect(result.position).toBe(3)
  })

  it('sends publishableKey, email, slug', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { success: true, alreadyJoined: false }))
    await waitlist.join('beta', 'ada@example.com')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.email).toBe('ada@example.com')
    expect(body.slug).toBe('beta')
  })

  it('returns alreadyJoined: true', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { success: true, alreadyJoined: true }))
    const result = await waitlist.join('beta', 'x@x.com')
    expect(result.alreadyJoined).toBe(true)
  })

  it('omits slug from body when slug is undefined', async () => {
    mockFetch.mockResolvedValue(mockResponse(200, { success: true, alreadyJoined: false }))
    await waitlist.join(undefined, 'ada@example.com')
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect('slug' in body).toBe(false)
  })
})
