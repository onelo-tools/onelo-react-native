import { describe, it, expect } from 'vitest'
import { shouldShowNativeStoreClose } from '../../src/auth/auth-modal'

/**
 * Regression for the "two ✕ in a circle" bug (React Native, 2026-08-20): the
 * native store ✕ used to be unconditional (`onStore` alone), so it stayed on
 * screen for the WHOLE store visit, overlapping the hosted page's own
 * canonical ✕ (StoreExitX) forever. It must now be a FAIL-SAFE — visible
 * only until the hosted page proves it's up.
 */
describe('shouldShowNativeStoreClose', () => {
  it('hides before the grace period elapses — never flashes on a normal fast load', () => {
    expect(shouldShowNativeStoreClose({ onStore: true, hostedReady: false, failSafeArmed: false })).toBe(false)
  })

  it('shows once the grace elapses and the hosted page still has not confirmed ready', () => {
    expect(shouldShowNativeStoreClose({ onStore: true, hostedReady: false, failSafeArmed: true })).toBe(true)
  })

  it('hides once the hosted page posts onelo:ready — its own canonical ✕ takes over, THE regression', () => {
    expect(shouldShowNativeStoreClose({ onStore: true, hostedReady: true, failSafeArmed: true })).toBe(false)
  })

  it('never shows off the store (sign-in form has no ✕ at all)', () => {
    expect(shouldShowNativeStoreClose({ onStore: false, hostedReady: false, failSafeArmed: true })).toBe(false)
  })
})
