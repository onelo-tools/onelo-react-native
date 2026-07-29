import { describe, it, expect } from 'vitest'
import { authSkeletonHtml } from './auth-skeleton'

describe('authSkeletonHtml', () => {
  it('injects the branding background colour into the body', () => {
    const html = authSkeletonHtml(0, '#0a0a0a')
    expect(html).toContain('background:#0a0a0a')
  })

  it('defaults the background to #111111', () => {
    expect(authSkeletonHtml(0, '')).toContain('background:#111111')
  })

  it('renders NO social pills or divider when socialCount is 0', () => {
    const html = authSkeletonHtml(0, '#111111')
    expect(html).not.toContain('class="onelo-skel-strong pill"')
    expect(html).not.toContain('class="divider"')
  })

  it('renders N social pills + a divider when socialCount > 0', () => {
    const html = authSkeletonHtml(3, '#111111')
    expect((html.match(/onelo-skel-strong pill/g) ?? []).length).toBe(3)
    expect(html).toContain('class="divider"')
  })

  it('clamps socialCount to a max of 4 pills', () => {
    const html = authSkeletonHtml(10, '#111111')
    expect((html.match(/onelo-skel-strong pill/g) ?? []).length).toBe(4)
  })

  it('clamps negative / NaN socialCount to 0 (no pills, no divider)', () => {
    for (const bad of [-2, NaN, undefined as unknown as number]) {
      const html = authSkeletonHtml(bad, '#111111')
      expect(html).not.toContain('class="divider"')
    }
  })

  it('includes every canonical skeleton element (logo→heading→sub→inputs→cta→signup)', () => {
    const html = authSkeletonHtml(0, '#111111')
    for (const cls of ['icon', 'title', 'sub', 'lbl', 'input', 'lblrow', 'forgot', 'cta', 'signup']) {
      expect(html).toContain(cls)
    }
  })

  it('is CENTERED (matches the real hosted form, not the top-aligned canonical file)', () => {
    const html = authSkeletonHtml(0, '#111111')
    expect(html).toContain('justify-content:center')
    expect(html).toContain('min-height:100vh')
  })

  it('drives the single-beam RAF shimmer (not background-attachment:fixed)', () => {
    const html = authSkeletonHtml(0, '#111111')
    expect(html).toContain('requestAnimationFrame')
    expect(html).toContain('backgroundPositionX')
    expect(html).not.toContain('background-attachment:fixed')
  })

  it('#28 single-WebView: embeds a location.replace to redirectTo (history-safe, not push)', () => {
    const html = authSkeletonHtml(0, '#111111', 'https://app.example.com/auth/hosted?token=abc')
    expect(html).toContain('location.replace(')
    expect(html).toContain('https://app.example.com/auth/hosted?token=abc')
    // JSON.stringify wraps the URL in quotes → safe injection into the script.
    expect(html).toContain('"https://app.example.com/auth/hosted?token=abc"')
  })

  it('omits the redirect when redirectTo is not given (gate skeleton just shows)', () => {
    expect(authSkeletonHtml(3, '#111111')).not.toContain('location.replace')
  })
})
