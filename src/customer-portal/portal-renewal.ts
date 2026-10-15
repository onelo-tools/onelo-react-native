// Opener renewal for the hosted Customer Portal (#613 / #614).
//
// The portal page's `prt_*` token lives ten minutes. When an action meets a dead
// one, the page (or the store it opened) posts
//   { type: 'onelo:renew_request', kind: 'portal', request_id }
// through `window.ReactNativeWebView.postMessage`. The SDK — where the user is
// still signed in — mints a fresh portal with the user's own access token and
// answers by injecting a self-post into the page:
//   { type: 'onelo:renewed', request_id, hosted_url }
//   { type: 'onelo:renew_failed', request_id, reason }
// The page accepts only a self-post (event.source === window) whose URL is the
// same portal page, so nothing else can answer for the SDK.

export type RenewReply = Record<string, unknown> & { type: 'onelo:renewed' | 'onelo:renew_failed'; request_id: string }

/** The request id of a renew request of `kind` (the portal by default; the
 *  feedback form asks with kind `feedback`, #622), or null for any other message. */
export function parseRenewRequest(raw: unknown, kind: 'portal' | 'feedback' = 'portal'): string | null {
  let data: unknown = raw
  if (typeof raw === 'string') {
    try { data = JSON.parse(raw) } catch { return null }
  }
  const d = data as Record<string, unknown> | null
  if (!d || d['type'] !== 'onelo:renew_request' || d['kind'] !== kind) return null
  return typeof d['request_id'] === 'string' && d['request_id'] ? d['request_id'] : null
}

/** The script injected into the portal WebView to deliver a reply. */
export function renewReplyScript(reply: RenewReply): string {
  return `window.postMessage(${JSON.stringify(reply)}, '*'); true;`
}

/** True when both URLs share scheme, host and port. A fresh portal is a bearer
 *  credential, so the modal answers only a page still on the portal's origin. */
export function sameOrigin(a: string | undefined | null, b: string | undefined | null): boolean {
  const origin = (u: string | undefined | null): string | null => {
    const m = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]+)/i.exec(u ?? '')
    return m ? `${m[1].toLowerCase()}://${m[2].toLowerCase()}` : null
  }
  const oa = origin(a)
  return oa !== null && oa === origin(b)
}
