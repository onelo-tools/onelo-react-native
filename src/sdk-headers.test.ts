import { describe, it, expect, vi } from 'vitest'

vi.mock('./core/instance-id', () => ({ getInstanceId: vi.fn().mockResolvedValue('inst-1') }))
vi.mock('./attest', () => ({
  getCachedAttestToken: vi.fn().mockReturnValue(null),
  getCachedIntegrityToken: vi.fn().mockReturnValue(null),
  getAssertionHeaders: vi.fn(),
}))
vi.mock('react-native', () => ({ Platform: { OS: 'ios' }, NativeModules: {} }))

import { sdkHeaders } from './sdk-headers'
import { version } from '../package.json'

describe('sdkHeaders identity (#122)', () => {
  it('names this SDK by its registry key next to its version', async () => {
    const h = await sdkHeaders('com.example.app')
    expect(h['X-SDK-Version']).toBe(version)
    expect(h['X-Onelo-Sdk-Name']).toBe('onelo-react-native')
    // The discovery language tag is a different question and stays.
    expect(h['X-Onelo-Sdk-Platform']).toBe('react-native')
  })
})
