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
      const body: Record<string, unknown> = { publishableKey: this.publishableKey, email }
      if (slug !== undefined) body.slug = slug
      const res = await fetch(`${this.apiUrl}/api/sdk/waitlist/join`, {
        method: 'POST',
        headers: { ...(await sdkHeaders(this.bundleId)), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
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
