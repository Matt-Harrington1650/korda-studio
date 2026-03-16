export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export interface KordaAPI {
  getAppVersion: () => Promise<string>
  getWindowState: () => Promise<WindowState | null>
  saveWindowState: (state: WindowState) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  openExternal: (url: string) => Promise<void>
  // Push notifications from main process → renderer (future phases)
  onNotification: (callback: (payload: { title: string; body: string }) => void) => () => void
}

// Channel names as constants to prevent typos
export const IPC_CHANNELS = {
  APP_VERSION: 'app:version',
  WINDOW_GET_STATE: 'window:get-state',
  WINDOW_SAVE_STATE: 'window:save-state',
  WINDOW_MINIMIZE: 'window:minimize',
  WINDOW_MAXIMIZE: 'window:maximize',
  WINDOW_CLOSE: 'window:close',
  OPEN_EXTERNAL: 'shell:open-external',
  NOTIFICATION_PUSH: 'notification:push',
} as const
