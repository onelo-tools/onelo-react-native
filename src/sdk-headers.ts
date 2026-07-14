import { version as SDK_VERSION } from '../package.json'
import { getInstanceId } from './core/instance-id'

/**
 * Returns the common security headers to include in every SDK HTTP request —
 * the React Native port of Swift's `applySecurityHeaders` (`OneloHTTPClient.swift:24`).
 *
 * Always sent:
 * - `X-SDK-Version`             — SDK version string
 * - `X-Onelo-Instance-Id`      — per-install UUID (TOFU device binding)
 * - `X-Onelo-Sdk-Platform`     — always `react-native`
 *
 * Conditionally sent:
 * - `X-Bundle-Id`      — when `bundleId` is configured (backend
 *                        `validate_sdk_request_security` requires it)
 * - `X-Publishable-Key`— ONLY when `publishableKey` is passed. Header duality
 *                        (Subtle guard #16): shared-module calls omit the key
 *                        (it travels in the request body); auth/consent calls
 *                        that need bearer-scoped identity pass it here.
 *
 * Async because the instance id is Keychain-backed. Every caller already runs
 * inside an async function — `await sdkHeaders(...)`.
 */
export async function sdkHeaders(
  bundleId?: string,
  publishableKey?: string,
): Promise<Record<string, string>> {
  const instanceId = await getInstanceId()
  return {
    'X-SDK-Version': SDK_VERSION,
    'X-Onelo-Instance-Id': instanceId,
    'X-Onelo-Sdk-Platform': 'react-native',
    ...(bundleId ? { 'X-Bundle-Id': bundleId } : {}),
    ...(publishableKey ? { 'X-Publishable-Key': publishableKey } : {}),
  }
}
