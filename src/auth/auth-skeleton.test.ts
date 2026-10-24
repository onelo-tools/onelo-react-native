import { describe, it, expect } from 'vitest'
import { brandTokensFromLegacy, NEUTRAL_BRAND_TOKENS } from '@onelo/core'
import { authSkeletonHtml } from './auth-skeleton'

// #681: the skeleton takes brand tokens; these tests only vary the ground.
const bg = (hex: string) => brandTokensFromLegacy(null, hex)

describe('authSkeletonHtml', () => {
  it('injects the branding background colour into the body', () => {
    const html = authSkeletonHtml(0, bg('#0a0a0a'))
    expect(html).toContain('background:#0a0a0a')
  })

  it('the neutral tokens paint the #111111 default ground', () => {
    expect(authSkeletonHtml(0, NEUTRAL_BRAND_TOKENS)).toContain('background:#111111')
  })

  it('renders NO social pills or divider when socialCount is 0', () => {
    const html = authSkeletonHtml(0, bg('#111111'))
    expect(html).not.toContain('class="onelo-skel-strong pill"')
    expect(html).not.toContain('class="divider"')
  })

  it('renders N social pills + a divider when socialCount > 0', () => {
    const html = authSkeletonHtml(3, bg('#111111'))
    expect((html.match(/onelo-skel-strong pill/g) ?? []).length).toBe(3)
    expect(html).toContain('class="divider"')
  })

  it('clamps socialCount to a max of 4 pills', () => {
    const html = authSkeletonHtml(10, bg('#111111'))
    expect((html.match(/onelo-skel-strong pill/g) ?? []).length).toBe(4)
  })

  it('clamps negative / NaN socialCount to 0 (no pills, no divider)', () => {
    for (const bad of [-2, NaN, undefined as unknown as number]) {
      const html = authSkeletonHtml(bad, bg('#111111'))
      expect(html).not.toContain('class="divider"')
    }
  })

  it('includes every canonical skeleton element (logo→heading→sub→inputs→cta→signup)', () => {
    const html = authSkeletonHtml(0, bg('#111111'))
    for (const cls of ['icon', 'title', 'sub', 'lbl', 'input', 'lblrow', 'forgot', 'cta', 'signup']) {
      expect(html).toContain(cls)
    }
  })

  it('is CENTERED (matches the real hosted form, not the top-aligned canonical file)', () => {
    const html = authSkeletonHtml(0, bg('#111111'))
    expect(html).toContain('justify-content:center')
    expect(html).toContain('min-height:100vh')
  })

  it('drives the single-beam RAF shimmer (not background-attachment:fixed)', () => {
    const html = authSkeletonHtml(0, bg('#111111'))
    expect(html).toContain('requestAnimationFrame')
    expect(html).toContain('backgroundPositionX')
    expect(html).not.toContain('background-attachment:fixed')
  })

  it('#28 single-WebView: embeds a location.replace to redirectTo (history-safe, not push)', () => {
    const html = authSkeletonHtml(0, bg('#111111'), 'https://app.example.com/auth/hosted?token=abc')
    expect(html).toContain('location.replace(')
    expect(html).toContain('https://app.example.com/auth/hosted?token=abc')
    // JSON.stringify wraps the URL in quotes → safe injection into the script.
    expect(html).toContain('"https://app.example.com/auth/hosted?token=abc"')
  })

  it('omits the redirect when redirectTo is not given (gate skeleton just shows)', () => {
    expect(authSkeletonHtml(3, bg('#111111'))).not.toContain('location.replace')
  })
})

describe('authSkeletonHtml shape + light page (#948)', () => {
  it('draws the magic-link row only when magic link is on, between password and CTA', () => {
    expect(authSkeletonHtml(0, bg('#111111'))).not.toContain('magic"')
    const html = authSkeletonHtml(0, bg('#111111'), undefined, true)
    expect(html).toMatch(/onelo-skel-strong input"><\/div>\n<div class="onelo-skel magic"><\/div><div class="onelo-skel-strong cta"/)
  })

  it('light page: soft blocks are not painted with the page colour', () => {
    const t = bg('#ffffff')
    const html = authSkeletonHtml(0, t)
    expect(html).toContain(`.onelo-skel{background-color:${t.border};`)
  })

  it('dark page: soft blocks keep the card colour', () => {
    const t = bg('#111111')
    expect(authSkeletonHtml(0, t)).toContain(`.onelo-skel{background-color:${t.card_bg};`)
  })
})
