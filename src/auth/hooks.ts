import { useState, useEffect } from 'react'
import type { OneloAuth } from './auth'
import type { ModalResult } from './auth-modal'

export interface ModalState {
  visible: boolean
  url: string
  onResult: ((result: ModalResult) => void) | null
}

/**
 * Reactive hook for rendering <AuthModal>.
 * Re-renders automatically when loadAuthView() opens or closes the modal.
 *
 * @example
 * const modal = useModalState(onelo.auth)
 * return <AuthModal visible={modal.visible} hostedUrl={modal.url} onResult={modal.onResult!} />
 */
export function useModalState(auth: OneloAuth): ModalState {
  const [state, setState] = useState<ModalState>(() => auth.getModalState())

  useEffect(() => {
    const unsubscribe = auth.onModalStateChange(() => {
      setState(auth.getModalState())
    })
    return unsubscribe
  }, [auth])

  return state
}
