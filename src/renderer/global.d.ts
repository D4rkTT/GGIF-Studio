import type { GgifApi } from '../preload/index'

declare global {
  interface Window {
    ggif: GgifApi
  }
}

export {}
