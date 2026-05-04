import { version as SDK_VERSION } from '../package.json'

/**
 * Returns common security headers to include in every SDK HTTP request.
 * - X-SDK-Version: always sent
 * - X-Bundle-Id: sent when bundleId is configured (required by backend validate_sdk_request_security)
 */
export function sdkHeaders(bundleId?: string): Record<string, string> {
  return {
    'X-SDK-Version': SDK_VERSION,
    ...(bundleId ? { 'X-Bundle-Id': bundleId } : {}),
  }
}
