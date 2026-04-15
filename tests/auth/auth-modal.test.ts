import { describe, it, expect } from 'vitest'
import { parseModalMessage } from '../../src/auth/auth-modal'

describe('parseModalMessage', () => {
  it('returns code for valid onelo:code message', () => {
    const result = parseModalMessage('{"type":"onelo:code","code":"abc123"}')
    expect(result).toEqual({ type: 'code', code: 'abc123' })
  })

  it('returns cancelled for onelo:cancelled', () => {
    const result = parseModalMessage('{"type":"onelo:cancelled"}')
    expect(result).toEqual({ type: 'cancelled' })
  })

  it('returns null for unrecognized message', () => {
    const result = parseModalMessage('{"type":"other"}')
    expect(result).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    const result = parseModalMessage('not-json')
    expect(result).toBeNull()
  })
})
