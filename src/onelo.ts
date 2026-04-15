import type { OneloConfig } from '@onelo/core'
import { OneloAuth } from './auth/auth'

export class Onelo {
  readonly auth: OneloAuth

  constructor(config: OneloConfig) {
    this.auth = new OneloAuth(config)
  }
}
