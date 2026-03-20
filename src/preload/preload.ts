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
    ipcRenderer.on(IPC_CHANNELS.NOTIFICATION_PUSH, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.NOTIFICATION_PUSH, handler)
  },
  storeGet: (key: string) => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET, key),
  storeSet: (key: string, value: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.STORE_SET, key, value),
  fileIndexSearch: (params: import('../shared/ipc-types').SearchParams) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_SEARCH, params),
  fileIndexStatus: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_STATUS),
  fileIndexOpen: (filePath: string) => ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_OPEN, filePath),
  fileIndexReindex: (sourceId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_REINDEX, sourceId),
  onFileIndexProgress: (cb: (count: number) => void) => {
    const handler = (_: Electron.IpcRendererEvent, count: number) => cb(count)
    ipcRenderer.on(IPC_CHANNELS.FILE_INDEX_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.FILE_INDEX_PROGRESS, handler)
  },
  fileIndexSourcesList: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_SOURCES_LIST),
  fileIndexSourceSave: (source: import('../shared/file-sources').FileSource) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_SOURCE_SAVE, source),
  fileIndexSourceDelete: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_SOURCE_DELETE, sourceId),
  fileIndexProjectsList: (sourceId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_PROJECTS_LIST, sourceId),
})
