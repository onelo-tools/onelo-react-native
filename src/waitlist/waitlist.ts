export class OneloWaitlist {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly bundleId?: string,
  ) {}

  async join(
    slug: string | undefined,
    email: string,
  ): Promise<{ success: boolean; position?: number; alreadyJoined: boolean; message?: string }> {
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      const { maybeSelfHealFromError: _maybeSelfHeal } = await import('../attest')
      const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
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
