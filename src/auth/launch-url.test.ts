/**
 * #542 — a magic link opened on this device after the app was killed arrives
 * only as the launch URL (`Linking.getInitialURL()`). `OneloAuthGate` must
 * complete it BEFORE it resolves the gate, because resolving opens a new
 * hosted flow and a new flow replaces the stored PKCE verifier the link needs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import Module from 'module'

// ── Minimal hook runtime: run the component once, run its effects in order. ──
const { effects, retryCalls, hooks } = vi.hoisted(() => ({
  effects: [] as Array<() => unknown>,
  retryCalls: [] as unknown[],
  hooks: { stateIndex: 0 },
}))
vi.mock('react', () => {
  const React = {
    createElement: (..._a: unknown[]) => null,
    useState: (init: unknown) => {
      const i = hooks.stateIndex++
      const v = typeof init === 'function' ? (init as () => unknown)() : init
      // useState order in OneloAuthGate: state, restoring, retry (then the modal hook's).
      return [v, (next: unknown) => { if (i === 2) retryCalls.push(next) }]
    },
    useEffect: (fn: () => unknown) => { effects.push(fn) },
    useRef: (v: unknown) => ({ current: v }),
    useCallback: (fn: unknown) => fn,
  }
  return { default: React, ...React }
})
vi.mock('./hooks', () => ({ useModalState: () => ({ visible: false, url: '', onResult: null }) }))
vi.mock('./auth-modal', () => ({ AuthModal: () => null }))
vi.mock('./auth-skeleton', () => ({ AuthSkeleton: () => null }))
vi.mock('../core/brand', () => ({ chromeStyles: () => ({}) }))

const order: string[] = []
const linking = {
  getInitialURL: vi.fn(async () => 'onelorn://callback?code=launch'),
  addEventListener: vi.fn(() => ({ remove: () => {} })),
}
const fakeRN = {
  View: 'View', Text: 'Text', TouchableOpacity: 'TouchableOpacity',
  StyleSheet: { create: (s: unknown) => s },
  AppState: { addEventListener: () => ({ remove: () => {} }) },
  Linking: linking,
}

// OneloAuthGate lazily `require`s react-native at render time.
const realLoad = (Module as unknown as { _load: (...a: unknown[]) => unknown })._load
beforeEach(() => {
  ;(Module as unknown as { _load: unknown })._load = function (req: string, ...rest: unknown[]) {
    if (req === 'react-native') return fakeRN
    return realLoad.call(this, req, ...rest)
  }
  effects.length = 0
  retryCalls.length = 0
  hooks.stateIndex = 0
  order.length = 0
})
afterEach(() => { ;(Module as unknown as { _load: unknown })._load = realLoad })

import { OneloAuthGate } from './OneloAuthGate'
import { completeLaunchUrl } from './launch-url'
import { OneloError } from '@onelo/core'
import { oneloText, withAppUserText } from '../core/texts'

function fakeOnelo(handleLaunchUrl: (url: string | null | undefined) => Promise<unknown>) {
  return {
    auth: {
      handleLaunchUrl: vi.fn(async (url: string | null | undefined) => { order.push(`launch:${url}`); return handleLaunchUrl(url) }),
      whenReady: vi.fn(async () => { order.push('recompute') }),
      getSession: vi.fn(async () => null),
      isPaywallEnabled: () => false,
      hasStoredSession: vi.fn(async () => false),
      revalidateEntitlement: vi.fn(async () => { order.push('revalidate') }),
      onAuthStateChange: vi.fn(() => () => {}),
      brandTokens: () => ({ page_bg: '#111111' }),
      loadAuthView: vi.fn(async () => null),
      oauthProviders: [] as string[],
      callbackScheme: 'onelorn',
    },
  }
}

const flush = async () => { for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 0)) }

describe('OneloAuthGate mount — the launch URL', () => {
  it('is completed before the gate resolves or revalidates', async () => {
    let finish!: () => void
    const onelo = fakeOnelo(() => new Promise((r) => { finish = () => r(null) }))
    OneloAuthGate({ onelo: onelo as never, children: null })
    effects[0]() // the mount effect

    await flush()
    expect(order).toEqual(['launch:onelorn://callback?code=launch'])

    finish()
    await flush()
    expect(order[0]).toBe('launch:onelorn://callback?code=launch')
    expect(order).toContain('recompute')
    expect(order).toContain('revalidate')
  })

  it('shows a failed completion on the retry surface', async () => {
    // #1076: the App User's words for it (Page Language), not the raw message.
    const onelo = fakeOnelo(async () => {
      throw withAppUserText(OneloError.server('belongs to a different sign-in'), 'linkOtherSignIn')
    })
    OneloAuthGate({ onelo: onelo as never, children: null })
    effects[0]()
    await flush()
    expect(retryCalls).toEqual([{ message: oneloText('linkOtherSignIn') }])
    expect(order).toContain('recompute')
  })
})

describe('completeLaunchUrl', () => {
  it('passes null when Linking has no getInitialURL or it throws', async () => {
    const auth = { handleLaunchUrl: vi.fn(async () => null) }
    await completeLaunchUrl(auth, {}, () => {})
    await completeLaunchUrl(auth, { getInitialURL: async () => { throw new Error('x') } }, () => {})
    expect(auth.handleLaunchUrl.mock.calls).toEqual([[null], [null]])
  })
})
