import type { OneloSession } from '@onelo/core'

/** The slice of RN `Linking` the launch hand-off reads. */
export interface LaunchLinking {
  getInitialURL?: () => Promise<string | null> | string | null
}

/**
 * Hand the URL that launched the app to `handleLaunchUrl` (#542) and settle
 * once it is done, never rejecting. A magic link opened on this device after
 * the app was killed arrives only here, never as a `'url'` event.
 * `OneloAuthGate` waits for this BEFORE it resolves the gate: resolving opens
 * a new hosted flow, and a new flow replaces the stored PKCE verifier this
 * link needs. A failed completion is passed to `onError` for the retry
 * surface instead of being dropped.
 */
export async function completeLaunchUrl(
  auth: { handleLaunchUrl(url: string | null | undefined): Promise<OneloSession | null> },
  linking: LaunchLinking | null | undefined,
  onError: (e: unknown) => void,
): Promise<void> {
  let url: string | null = null
  try {
    if (linking && typeof linking.getInitialURL === 'function') url = await linking.getInitialURL()
  } catch {
    url = null
  }
  try {
    await auth.handleLaunchUrl(url)
  } catch (e) {
    onError(e)
  }
}
