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
      const body: Record<string, unknown> = { publishableKey: this.publishableKey, formSlug, data }
      if (submitterEmail) body.submitterEmail = submitterEmail
      const res = await fetch(`${this.apiUrl}/api/sdk/forms/submit`, {
        method: 'POST',
        headers: { ...(await sdkHeaders(this.bundleId)), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      // Success: backend returns { ok: true, submissionId } — NOT `success` — so
      // derive it from the HTTP status (parity with Swift). Errors are FastAPI
      // HTTPException bodies shaped { detail: "…" } (string) — surface that as the
      // message so validation/rate-limit reasons aren't silently dropped.
      const json = await res.json().catch(() => ({})) as { detail?: unknown; message?: string }
      const message = typeof json.detail === 'string' ? json.detail
        : typeof json.message === 'string' ? json.message : undefined
      return { success: res.ok, message }
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) }
    }
  }
}
