// Typed key constants for electron-store namespaced data.
// These keys match the StoreSchema defined in src/main/main.ts.
export const STORE_KEYS = {
  PREFERENCES: 'preferences',
  NOTIFICATIONS: 'notifications',
  WINDOW_STATE: 'window-state',
  CONNECTIONS: 'connections',
  AI: 'ai',
} as const

export type StoreKey = (typeof STORE_KEYS)[keyof typeof STORE_KEYS]
