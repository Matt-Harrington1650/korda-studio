// Renderer-only: must never be imported from main.ts or preload.ts.
// Returns a Zustand StateStorage-compatible adapter that routes reads/writes
// through the kordaAPI IPC bridge to electron-store in the main process.
// Usage: createJSONStorage(() => createElectronStorage('preferences'))

export function createElectronStorage(key: string) {
  return {
    getItem: (_name: string): Promise<string | null> => {
      return window.kordaAPI.storeGet(key)
    },
    setItem: (_name: string, value: string): Promise<void> => {
      return window.kordaAPI.storeSet(key, value)
    },
    removeItem: (_name: string): Promise<void> => {
      return window.kordaAPI.storeSet(key, null)
    },
  }
}
