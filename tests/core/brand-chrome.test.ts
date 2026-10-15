// #681 — the React Native SDK's native chrome (retry buttons, ✕ chip, error
// text, headers, WebView skeletons) is painted from the backend's
// `brand_tokens`, with a neutral set before config — never hard-coded dark.
import { describe, it, expect } from 'vitest'
import { parseBrandTokens, NEUTRAL_BRAND_TOKENS, type BrandTokens } from '@onelo/core'
import { chromeStyles, resolveModalTokens } from '../../src/core/brand'
import { authSkeletonHtml } from '../../src/auth/auth-skeleton'
import { storeSkeletonHtml } from '../../src/store/store-modal'

const T: BrandTokens = parseBrandTokens({
  version: 1,
  page_bg: '#f5f5f4',
  brand: '#e4007c',
  card_bg: '#ffffff',
  text: '#111111',
  text_muted: 'rgba(17,17,17,0.65)',
  border: '#e4e4e7',
  button_bg: '#00aa55',
  button_text: '#010101',
  button_radius: 3,
  field_radius: 7,
  card_radius: 21,
  body_font: "'Poppins', sans-serif",
  heading_font: "'Lato', sans-serif",
  spinner_track: 'rgba(0,0,0,0.12)',
  light_bg: true,
})!

describe('React Native chrome from brand_tokens (#681)', () => {
  it('retry button, ✕ chip, header and ground come from the tokens', () => {
    const s = chromeStyles(T)
    expect(s.retryButton.backgroundColor).toBe('#00aa55')
    expect(s.retryButton.borderRadius).toBe(3)
    expect(s.retryText.color).toBe('#010101')
    expect(s.container.backgroundColor).toBe('#f5f5f4')
    expect(s.closeChip.backgroundColor).toBe('#ffffff')
    expect(s.closeText.color).toBe('#111111')
    expect(s.header.borderBottomColor).toBe('#e4e4e7')
    expect(s.spinnerColor).toBe('#e4007c')
  })

  it('WebView skeletons: page ground, card/border blocks, radii', () => {
    const auth = authSkeletonHtml(2, T)
    expect(auth).toContain('body{background:#f5f5f4')
    expect(auth).toContain('.onelo-skel{background-color:#ffffff')
    expect(auth).toContain('.cta{height:48px;border-radius:3px')
    expect(auth).not.toContain('rgba(255,255,255,0.04)')
    const store = storeSkeletonHtml(T)
    expect(store).toContain('background:#f5f5f4')
    expect(store).toContain('border-radius:21px')
  })

  it('before config the chrome is neutral, never Onelo orange; a legacy bg still sets the ground', () => {
    const n = chromeStyles(resolveModalTokens(undefined))
    expect(n.retryButton.backgroundColor).toBe(NEUTRAL_BRAND_TOKENS.button_bg)
    expect(JSON.stringify(n)).not.toMatch(/f97316|ffa100/i)
    expect(resolveModalTokens(undefined, '#0e0b1a').page_bg).toBe('#0e0b1a')
    expect(resolveModalTokens(T, '#0e0b1a')).toBe(T)
  })
})
