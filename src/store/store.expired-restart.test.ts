import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * #619 — the store modal reports a dead link as `{type:'expired'}`. `open()`
 * mints a fresh link through store-initiate and keeps the modal up on it, so
 * the buyer continues. A plain cancel still resolves null.
 */

const httpGet = vi.fn()
vi.mock('@onelo/core', async (orig) => ({
  ...(await orig<typeof import('@onelo/core')>()),
  httpGet: (...a: unknown[]) => httpGet(...a),
}))

import { OneloStore } from './store'

const HOSTED = 'https://st.onelo.tools/store/hosted'
const SESSION = { accessToken: 'at' } as never

function makeStore() {
  return new OneloStore('https://api.test', 'pk_test', 'com.app', async () => 'at', async () => SESSION, undefined, 'onelorn', async () => SESSION)
}

async function until(cond: () => boolean) {
  for (let i = 0; i < 200 && !cond(); i++) await new Promise((r) => setTimeout(r, 1))
}

beforeEach(() => { httpGet.mockReset() })

describe('OneloStore.open after the link died (#619)', () => {
  it('re-initiates and keeps the modal up on the fresh link', async () => {
    httpGet
      .mockResolvedValueOnce({ status: 200, json: { store_url: `${HOSTED}?token=srt_1` } })
      .mockResolvedValueOnce({ status: 200, json: { store_url: `${HOSTED}?token=srt_2` } })
    const store = makeStore()
    const opened = store.open()
    await until(() => store.getModalState().visible)
    expect(store.getModalState().hostedUrl).toContain('srt_1')

    await store.getModalState().onResult!({ type: 'expired' })

    const state = store.getModalState()
    expect(state.visible).toBe(true)
    expect(state.hostedUrl).toContain('srt_2')
    expect(httpGet).toHaveBeenCalledTimes(2)
    expect(String(httpGet.mock.calls[1][0])).toContain('/api/sdk/paywall/store-initiate')

    await state.onResult!({ type: 'success', code: 'oac_1' })
    expect(await opened).toBe(SESSION)
    expect(store.getModalState().visible).toBe(false)
  })

  it('a failed re-initiate closes as a cancel', async () => {
    httpGet
      .mockResolvedValueOnce({ status: 200, json: { store_url: `${HOSTED}?token=srt_1` } })
      .mockResolvedValueOnce({ status: 503, json: {} })
    const store = makeStore()
    const opened = store.open()
    await until(() => store.getModalState().visible)
    await store.getModalState().onResult!({ type: 'expired' })
    expect(await opened).toBeNull()
    expect(store.getModalState().visible).toBe(false)
  })

  it('a plain cancel resolves null with one initiate', async () => {
    httpGet.mockResolvedValue({ status: 200, json: { store_url: `${HOSTED}?token=srt_1` } })
    const store = makeStore()
    const opened = store.open()
    await until(() => store.getModalState().visible)
    await store.getModalState().onResult!({ type: 'cancelled' })
    expect(await opened).toBeNull()
    expect(httpGet).toHaveBeenCalledTimes(1)
  })
})
