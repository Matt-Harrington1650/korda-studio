import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-types'
import type { WindowState } from '../shared/ipc-types'

contextBridge.exposeInMainWorld('kordaAPI', {
  getAppVersion: () => ipcRenderer.invoke(IPC_CHANNELS.APP_VERSION),
  getWindowState: () => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_GET_STATE),
  saveWindowState: (state: WindowState) =>
    ipcRenderer.invoke(IPC_CHANNELS.WINDOW_SAVE_STATE, state),
  minimizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  maximizeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  closeWindow: () => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  openExternal: (url: string) => ipcRenderer.invoke(IPC_CHANNELS.OPEN_EXTERNAL, url),
  onNotification: (callback: (payload: { title: string; body: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: { title: string; body: string }) =>
      callback(payload)
    ipcRenderer.on('notification:push', handler)
    return () => ipcRenderer.removeListener('notification:push', handler)
  },
})
