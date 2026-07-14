/**
 * Tests for OneloFeaturesOptions.featureDefaultStatus — the status returned by
 * feature() for a slug not (yet) in the resolved snapshot. Fail-closed 'hidden'
 * by default; a dev sets 'enabled' to preview new gates. 1:1 with Swift/Android/
 * Flutter `featureDefaultStatus`.
 */
import { describe, it, expect } from 'vitest'
import { OneloFeatures } from './features'

describe('OneloFeatures featureDefaultStatus', () => {
  it('returns the configured default status for a slug not in the snapshot', () => {
    const f = new OneloFeatures('https://api', 'pk_live', null, undefined, { featureDefaultStatus: 'enabled' })
    const state = f.feature('not-loaded-yet')
    expect(state.status).toBe('enabled')
    expect(state.isEnabled).toBe(true)
    f.stopPolling() // clear the batch-ping debounce feature() scheduled
  })

  it('defaults to hidden (fail-closed) when unset', () => {
    const f = new OneloFeatures('https://api', 'pk_live', null, undefined)
    const state = f.feature('unknown')
    expect(state.status).toBe('hidden')
    expect(state.isVisible).toBe(false)
    f.stopPolling()
  })
})
