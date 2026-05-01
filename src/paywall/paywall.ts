const TIER: Record<string, number> = { free: 0, pro: 1, business: 2, enterprise: 3 }

export class OneloPaywall {
  check(requiredPlan: string, userPlan: string = 'free'): boolean {
    const req = TIER[requiredPlan]
    const usr = TIER[userPlan]
    if (req === undefined || usr === undefined) return false
    return usr >= req
  }
}
