export interface FeedbackOptions {
  type?: 'bug' | 'feature_request' | 'general'
  area?: string
  userId?: string
}

export class OneloFeedback {
  private _url: string | null = null
  private _visible = false
  private _listeners: Array<(url: string | null, visible: boolean) => void> = []

  constructor(
    private readonly apiUrl: string,
    private readonly publishableKey: string,
    private readonly getActiveFeatures: () => string[],
  ) {}

  open(options: FeedbackOptions = {}): void {
    // Show modal immediately (with loading state), fetch URL in background
    this._notify(null, true)
    void this._fetchAndLoad(options)
  }

  close(): void { this._notify(null, false) }

  private async _fetchAndLoad(options: FeedbackOptions): Promise<void> {
    try {
      const params = new URLSearchParams({ key: this.publishableKey })
      if (options.type) params.set('type', options.type)
      if (options.area) params.set('area', options.area)
      if (options.userId) params.set('userId', options.userId)
      const active = this.getActiveFeatures()
      if (active.length > 0) params.set('session', JSON.stringify(active))

      const res = await fetch(`${this.apiUrl}/api/sdk/feedback/initiate?${params}`)
      if (!res.ok) { this.close(); return }
      const { hosted_url } = await res.json() as { hosted_url: string }
      if (this._visible) this._notify(hosted_url, true)
    } catch {
      this.close()
    }
  }

  private _notify(url: string | null, visible: boolean) {
    this._url = url
    this._visible = visible
    this._listeners.forEach(l => l(url, visible))
  }

  subscribe(listener: (url: string | null, visible: boolean) => void): () => void {
    this._listeners.push(listener)
    return () => { this._listeners = this._listeners.filter(l => l !== listener) }
  }

  getCurrentUrl(): string | null { return this._url }
  isVisible(): boolean { return this._visible }
}
