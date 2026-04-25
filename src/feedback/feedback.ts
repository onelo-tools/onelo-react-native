export interface FeedbackOptions {
  type?: 'bug' | 'feature_request' | 'general'
  area?: string
  userId?: string
}

export class OneloFeedback {
  private _url: string | null = null
  private _listeners: Array<(url: string | null) => void> = []

  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly getActiveFeatures: () => string[],
  ) {}

  async open(options: FeedbackOptions = {}): Promise<void> {
    const params = new URLSearchParams({ key: this.publishableKey })
    if (options.type) params.set('type', options.type)
    if (options.area) params.set('area', options.area)
    if (options.userId) params.set('userId', options.userId)
    const active = this.getActiveFeatures()
    if (active.length > 0) params.set('session', JSON.stringify(active))

    const res = await fetch(`${this.apiUrl}/api/sdk/feedback/initiate?${params}`)
    if (!res.ok) throw new Error(`Feedback initiate failed: ${res.status}`)
    const { hosted_url } = await res.json() as { hosted_url: string }
    this._setUrl(hosted_url)
  }

  close(): void { this._setUrl(null) }

  private _setUrl(url: string | null) {
    this._url = url
    this._listeners.forEach(l => l(url))
  }

  subscribe(listener: (url: string | null) => void): () => void {
    this._listeners.push(listener)
    return () => { this._listeners = this._listeners.filter(l => l !== listener) }
  }

  getCurrentUrl(): string | null { return this._url }
}
