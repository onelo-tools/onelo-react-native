import { waitlistConsentField, waitlistLanguageField, type WaitlistJoinOptions } from '@onelo/core'

export class OneloWaitlist {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly bundleId?: string,
    /** #1076 — the App's language (`config.language`), sent when a join passes
     *  none; undefined sends the device language. */
    private readonly language?: string,
  ) {}

  async join(
    slug: string | undefined,
    email: string,
    /** #818: the checkboxes your form showed — `{ consent: { marketing, custom } }`.
     *  #1038: `language` — the App's language for this sign-up; omitted, the
     *  config's `language` (#1076), else the device language is sent and the
     *  backend stores the join's Page Language. */
    options?: WaitlistJoinOptions,
  ): Promise<{ success: boolean; position?: number; alreadyJoined: boolean; message?: string }> {
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      const { maybeSelfHealFromError: _maybeSelfHeal } = await import('../attest')
      const body: Record<string, unknown> = {
        publishableKey: this.publishableKey, email, ...waitlistConsentField(options),
        ...waitlistLanguageField({ ...options, language: options?.language ?? this.language }),
      }
      if (slug !== undefined) body.slug = slug
      // FAZA 3 — replay_guard path: hash the exact bytes we send.
      const bodyStr = JSON.stringify(body)
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: 'POST',
        headers: {
          ...(await sdkHeaders(this.bundleId, undefined, {
            method: 'POST', path: '/api/sdk/waitlist/join', body: bodyStr,
          })),
          'Content-Type': 'application/json',
        },
        body: bodyStr,
      })
      if (!res.ok) _maybeSelfHeal(await res.clone().json().catch(() => ({})))
      // Success: backend returns { ok: true, position, alreadyJoined? } — NOT
      // `success` — so derive it from the HTTP status (parity with Swift). Errors
      // are FastAPI { detail: "…" } bodies — surface that so a 403 "waitlist closed"
      // carries a reason instead of a bare failure.
      const json = await res.json().catch(() => ({})) as { position?: number; alreadyJoined?: boolean; detail?: unknown; message?: string }
      const message = typeof json.detail === 'string' ? json.detail
        : typeof json.message === 'string' ? json.message : undefined
      return { success: res.ok, position: json.position, alreadyJoined: json.alreadyJoined ?? false, message }
    } catch {
      return { success: false, alreadyJoined: false }
    }
  }
}
