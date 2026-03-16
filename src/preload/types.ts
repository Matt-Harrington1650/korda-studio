import type { KordaAPI } from '../shared/ipc-types'

declare global {
  interface Window {
    kordaAPI: KordaAPI
  }
}
