export class OneloForms {
  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly bundleId?: string,
  ) {}

  async submit(
    formSlug: string,
    data: Record<string, unknown>,
    submitterEmail?: string,
  ): Promise<{ success: boolean; message?: string }> {
    try {
      const { sdkHeaders } = await import('../sdk-headers')
      const { maybeSelfHealFromError: _maybeSelfHeal } = await import('../attest')
      const body: Record<string, unknown> = { publishableKey: this.publishableKey, formSlug, data }
      if (submitterEmail) body.submitterEmail = submitterEmail
      // FAZA 3 — hash the EXACT bytes we send (forms/submit is a replay_guard
      // path). bodyStr is both the assertion preimage body and the fetch body,
      // so client and server hash identical bytes.
      const bodyStr = JSON.stringify(body)
      const res = await fetch(`${this.apiUrl}/api/sdk/forms/submit`, {
        method: 'POST',
        headers: {
          ...(await sdkHeaders(this.bundleId, undefined, {
            method: 'POST', path: '/api/sdk/forms/submit', body: bodyStr,
          })),
          'Content-Type': 'application/json',
        },
        body: bodyStr,
      })
      // Success: backend returns { ok: true, submissionId } — NOT `success` — so
      // derive it from the HTTP status (parity with Swift). Errors are FastAPI
      // HTTPException bodies shaped { detail: "…" } (string) — surface that as the
      // message so validation/rate-limit reasons aren't silently dropped.
      const json = await res.json().catch(() => ({})) as { detail?: unknown; message?: string }
      if (!res.ok) await _maybeSelfHeal(json)
      const message = typeof json.detail === 'string' ? json.detail
        : typeof json.message === 'string' ? json.message : undefined
      return { success: res.ok, message }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
