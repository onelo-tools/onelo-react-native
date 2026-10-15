/**
 * #659 — after a store purchase / plan switch the app kept the old plan until
 * the stream caught up. Every hosted modal now reports a purchase or a switch
 * to one refresher, which re-resolves features + entitlement at once and, for
 * a pending switch, re-checks on a bounded backoff.
 * #635 — the stream's `paywall.access_changed` re-reads the entitlement.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('./storage', () => ({
  KeychainStorage: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    clear: vi.fn().mockResolvedValue(undefined),
  })),
}))
vi.mock('../sdk-headers', async () => ({ ...(await vi.importActual<object>('../sdk-headers')), sdkHeaders: vi.fn().mockResolvedValue({}) }))
vi.mock('./instance-id', () => ({ getInstanceId: vi.fn().mockResolvedValue('iid') }))
vi.mock('../features/feature-cache', () => ({ loadFeatureCache: vi.fn().mockResolvedValue(null), saveFeatureCache: vi.fn().mockResolvedValue(undefined) }))

const server = { applied: false }
function answer(url: string) {
  if (url.includes('/features/resolve')) {
    return { status: 200, json: { config_version: 3, features: { 'team-report': { status: server.applied ? 'enabled' : 'upsell' } } } }
  }
  if (url.includes('/portal-initiate')) return { status: 200, json: { hosted_url: 'https://st.onelo.tools/customer/portal?token=prt_1' } }
  if (url.includes('/store-initiate')) return { status: 200, json: { store_url: 'https://st.onelo.tools/store/hosted?token=srt_1' } }
  return { status: 200, json: {} }
}
vi.mock('@onelo/core', async () => {
  const actual = await vi.importActual<typeof import('@onelo/core')>('@onelo/core')
  return {
    ...actual,
    httpGet: async (url: string) => answer(url),
    httpPost: async (url: string) => answer(url),
  }
})

import { Onelo } from '../onelo'
import { OneloAuth } from '../auth/auth'
import { PlanChangeRefresher, PENDING_RECHECK_DELAYS_MS, planChangeOf } from './plan-change'
import type { OneloEventStream } from './event-stream'

const tick = () => new Promise((r) => setTimeout(r, 0))

// The Event Stream's transport: accept and hold open, never deliver.
class HeldXHR {
  readyState = 0; status = 0; responseText = ''
  onprogress = null; onreadystatechange = null; onerror = null; ontimeout = null; onabort = null
  open(): void { this.readyState = 1 }
  setRequestHeader(): void {}
  abort(): void {}
  send(): void {}
}
;(globalThis as Record<string, unknown>).XMLHttpRequest ??= HeldXHR as unknown

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  server.applied = false
})

async function until(cond: () => boolean) {
  for (let i = 0; i < 300 && !cond(); i++) await tick()
}

function signedInOnelo(): Onelo {
  const onelo = new Onelo({ publishableKey: 'onelo_pk_live_x', apiUrl: 'https://api.example.com' })
  vi.spyOn(onelo.auth, 'getSession').mockResolvedValue({ accessToken: 'at', refreshToken: 'r', expiresAt: 0, user: { id: 'u1' } } as never)
  vi.spyOn(onelo.auth, 'revalidateEntitlement').mockResolvedValue('active' as never)
  return onelo
}

describe('hosted modal hand-back reconciles the plan at once (#659)', () => {
  it('a plan switch from the store in the portal modal shows the new plan', async () => {
    const onelo = signedInOnelo()
    // Features load once the cold-start session restore settles (#736).
    await until(() => onelo.features.snapshotKey().includes('upsell'))
    expect(onelo.features.feature('team-report').status).toBe('upsell')

    const opened = onelo.customerPortal.open()
    await until(() => onelo.customerPortal.getModalState().visible)
    server.applied = true
    await onelo.customerPortal.getModalState().onResult!({ type: 'done', planChange: { kind: 'switched', reason: 'plan_switched' } })
    await opened

    await until(() => onelo.features.feature('team-report').status === 'enabled')
    expect(onelo.features.feature('team-report').status).toBe('enabled')
    expect(onelo.auth.revalidateEntitlement).toHaveBeenCalled()
    onelo.destroy()
  })

  it("the portal's own Done is not a plan change", async () => {
    const onelo = signedInOnelo()
    const refresh = vi.spyOn(onelo.features, 'refresh')
    const opened = onelo.customerPortal.open()
    await until(() => onelo.customerPortal.getModalState().visible)
    await onelo.customerPortal.getModalState().onResult!({ type: 'done' })
    await opened
    for (let i = 0; i < 5; i++) await tick()
    // The plan-change refresher forces the resolve past the debounce; nothing
    // here may have asked for one.
    expect(refresh.mock.calls.filter((c) => c[0] === true)).toHaveLength(0)
    onelo.destroy()
  })

  it('a switch finished in the store modal', async () => {
    const onelo = signedInOnelo()
    const refresh = vi.spyOn(onelo.features, 'refresh')
    const opened = onelo.store.open()
    await until(() => onelo.store.getModalState().visible)
    await onelo.store.getModalState().onResult!({ type: 'done', reason: 'switch_scheduled' })
    await opened
    await until(() => refresh.mock.calls.length > 0)
    expect(refresh).toHaveBeenCalledWith(true)
    onelo.destroy()
  })
})

describe('planChangeOf', () => {
  it('names a purchase and a switch, nothing else', () => {
    expect(planChangeOf({ kind: 'purchase' })).toEqual({ kind: 'purchase' })
    expect(planChangeOf({ kind: 'switched', reason: 'plan_switch_pending' })).toEqual({ kind: 'switched', reason: 'plan_switch_pending' })
    expect(planChangeOf({ kind: 'portal_closed' })).toBeUndefined()
    expect(planChangeOf({ kind: 'cancelled' })).toBeUndefined()
  })
})

describe('PlanChangeRefresher (#659)', () => {
  function targets(applyAfterRefreshes: number) {
    let refreshes = 0
    let plan = 'pro'
    return {
      refreshFeatures: vi.fn(async () => { refreshes++; if (refreshes >= applyAfterRefreshes) plan = 'business' }),
      revalidateEntitlement: vi.fn(async () => {}),
      snapshot: () => plan,
    }
  }

  it('a pending switch is re-checked until the plan moves, then stops', async () => {
    vi.useFakeTimers()
    const t = targets(3)
    await new PlanChangeRefresher(t).handBack({ kind: 'switched', reason: 'plan_switch_pending' })
    await vi.advanceTimersByTimeAsync(60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(3)
  })

  it('gives up after the bounded delays', async () => {
    vi.useFakeTimers()
    const t = targets(Number.POSITIVE_INFINITY)
    await new PlanChangeRefresher(t).handBack({ kind: 'switched', reason: 'plan_switch_pending' })
    await vi.advanceTimersByTimeAsync(10 * 60_000)
    expect(t.refreshFeatures).toHaveBeenCalledTimes(1 + PENDING_RECHECK_DELAYS_MS.length)
  })
})

describe('paywall.access_changed on the stream (#635)', () => {
  it('re-reads the entitlement', () => {
    const handlers = new Map<string, (d: Record<string, unknown>) => void>()
    const stream = { on: (name: string, fn: (d: Record<string, unknown>) => void) => { handlers.set(name, fn) } }
    const auth = new OneloAuth({ publishableKey: 'onelo_pk_live_x', apiUrl: 'https://api.example.com' })
    const revalidate = vi.spyOn(auth, 'revalidateEntitlement').mockResolvedValue('active' as never)
    auth.attachEventStream(stream as unknown as OneloEventStream)
    handlers.get('paywall.access_changed')?.({ app_user_id: 'u1' })
    expect(revalidate).toHaveBeenCalledTimes(1)
  })
})
