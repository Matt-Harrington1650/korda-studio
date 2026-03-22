import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc-types'
import type {
  IngestionProgressEvent,
  RetrievalParams,
  SendParams,
  WindowState,
} from '../shared/ipc-types'

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
  storeSet: (key: string, value: unknown | null) =>
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
  chatSend: (params: SendParams) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND, params),
  chatStop: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_STOP),
  chatConversationsList: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_CONVERSATIONS_LIST),
  chatConversationGet: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.CHAT_CONVERSATION_GET, id),
  chatConversationNew: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_CONVERSATION_NEW),
  chatConversationDelete: (id: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHAT_CONVERSATION_DELETE, id),
  chatConversationRename: (id: string, title: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHAT_CONVERSATION_RENAME, id, title),
  chatMessagesDeleteFrom: (conversationId: string, fromMessageId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHAT_MESSAGES_DELETE_FROM, conversationId, fromMessageId),
  chatTestConnection: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_TEST_CONNECTION),
  chatApiKeySource: () => ipcRenderer.invoke(IPC_CHANNELS.CHAT_API_KEY_SOURCE),
  onChatToken: (cb: (token: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, token: string) => cb(token)
    ipcRenderer.on(IPC_CHANNELS.CHAT_TOKEN, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_TOKEN, handler)
  },
  onChatDone: (
    cb: (data: { messageId: string; inputTokens: number; outputTokens: number }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { messageId: string; inputTokens: number; outputTokens: number },
    ) => cb(data)
    ipcRenderer.on(IPC_CHANNELS.CHAT_DONE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_DONE, handler)
  },
  onChatError: (cb: (message: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, message: string) => cb(message)
    ipcRenderer.on(IPC_CHANNELS.CHAT_ERROR, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_ERROR, handler)
  },
  fileIndexSourcesList: () => ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_SOURCES_LIST),
  fileIndexSourceSave: (source: import('../shared/file-sources').FileSource) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_SOURCE_SAVE, source),
  fileIndexSourceDelete: (sourceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_SOURCE_DELETE, sourceId),
  fileIndexProjectsList: (sourceId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.FILE_INDEX_PROJECTS_LIST, sourceId),
  knowledgeSearch: (params: RetrievalParams) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_SEARCH, params),
  knowledgeAdjacent: (fileId: number, chunkIndex: number) =>
    ipcRenderer.invoke(IPC_CHANNELS.KNOWLEDGE_ADJACENT, fileId, chunkIndex),
  ingestionStatus: (sourceId?: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.INGESTION_STATUS, sourceId),
  ingestionRetry: (sourceId?: string) => ipcRenderer.invoke(IPC_CHANNELS.INGESTION_RETRY, sourceId),
  onIngestionProgress: (cb: (event: IngestionProgressEvent) => void) => {
    const handler = (_: Electron.IpcRendererEvent, event: IngestionProgressEvent) => cb(event)
    ipcRenderer.on(IPC_CHANNELS.INGESTION_PROGRESS, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.INGESTION_PROGRESS, handler)
  },
})
