import type { OneloConfig } from '@onelo/core'
import { OneloAuth } from './auth/auth'
import { OneloFeatures } from './features/features'
import { OneloMonitor } from './monitor/monitor'
import { OneloFeedback } from './feedback/feedback'
import { OneloPaywall } from './paywall/paywall'
import { OneloForms } from './forms/forms'
import { OneloWaitlist } from './waitlist/waitlist'

export class Onelo {
  readonly auth: OneloAuth
  readonly features: OneloFeatures
  readonly monitor: OneloMonitor
  readonly feedback: OneloFeedback
  readonly paywall: OneloPaywall
  readonly forms: OneloForms
  readonly waitlist: OneloWaitlist
  private authUnsubscribe: (() => void) | null = null

  constructor(config: OneloConfig) {
    this.auth = new OneloAuth(config)
    this.monitor = new OneloMonitor(config.publishableKey, config.apiUrl)
    this.features = new OneloFeatures(config.apiUrl, config.publishableKey, this.monitor)
    this.feedback = new OneloFeedback(config.apiUrl, config.publishableKey, () => this.features.getActiveFeatures())
    this.paywall = new OneloPaywall()
    this.forms = new OneloForms(config.apiUrl, config.publishableKey)
    this.waitlist = new OneloWaitlist(config.apiUrl, config.publishableKey)

    // Auth → features identity bridge: reload features when session changes
    this.authUnsubscribe = this.auth.onAuthStateChange((session) => {
      const userId = session?.user.id ?? null
      this.monitor.setUserId(userId)
      void this.features.load(userId)
    })

    this.monitor.setUserId(null)
    void this.features.load(null)
  }

  /** Only needed when NOT using Onelo Auth (own auth system). */
  async identify(userId: string): Promise<void> {
    await this.features.load(userId)
  }

  /** Release background timers. Call when the SDK instance is no longer needed. */
  destroy(): void {
    this.authUnsubscribe?.()
    this.features.stopPolling()
    this.monitor.destroy()
  }
}
