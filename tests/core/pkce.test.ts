import { describe, it, expect } from 'vitest'
import { generateCodeVerifier, generateCodeChallenge } from '../../src/core/pkce'

describe('PKCE (React Native / js-sha256)', () => {
  it('generateCodeVerifier returns a base64url string', () => {
    const v = generateCodeVerifier()
    expect(v).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(v.length).toBeGreaterThanOrEqual(43)
  })

  it('generateCodeChallenge returns a base64url string', () => {
    const v = generateCodeVerifier()
    const c = generateCodeChallenge(v)
    expect(c).toMatch(/^[A-Za-z0-9\-_]+$/)
    expect(c).not.toBe(v)
  })

  it('same verifier always produces same challenge', () => {
    const v = 'test-verifier-string'
    expect(generateCodeChallenge(v)).toBe(generateCodeChallenge(v))
  })
})
