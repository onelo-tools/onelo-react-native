import { describe, it, expect } from 'vitest'
import { OneloPaywall } from './paywall'

describe('OneloPaywall', () => {
  const paywall = new OneloPaywall()

  it('allows access when user plan meets requirement', () => {
    expect(paywall.check('free', 'free')).toBe(true)
    expect(paywall.check('pro', 'business')).toBe(true)
  })

  it('blocks access when user plan is below requirement', () => {
    expect(paywall.check('pro', 'free')).toBe(false)
  })

  it('defaults userPlan to free', () => {
    expect(paywall.check('free')).toBe(true)
    expect(paywall.check('pro')).toBe(false)
  })

  it('returns false for unknown plans', () => {
    expect(paywall.check('unknown', 'free')).toBe(false)
  })
})
