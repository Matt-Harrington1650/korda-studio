import type { FileSource, SourceStatus } from './file-sources'
export type { FileSource, FileSourceType, SourceStatus } from './file-sources'

export interface WindowState {
  x: number
  y: number
  width: number
  height: number
  isMaximized: boolean
}

export interface FileEntry {
  path: string
  name: string
  ext: string
  sizeBytes: number
  modifiedMs: number
  isDir: boolean
  project: string | null
  discipline: string | null
  docType: string | null
  drawingNumber: string | null
  revision: string | null
  issueStatus: string | null
}

/** @deprecated Use SourceStatus[] from file-sources instead */
export interface IndexStatus {
  status: 'idle' | 'crawling' | 'error' | 'not-configured'
  fileCount: number
  lastCrawledMs: number | null
  rootPath: string
  crawlError: string | null
}

export interface SearchParams {
  query: string
  sourceId?: string // omit to search all sources
  project?: string | string[] // single value or multi-select array
  discipline?: string
  docType?: string
  ext?: string
  limit?: number
}

export interface KordaAPI {
  getAppVersion: () => Promise<string>
  getWindowState: () => Promise<WindowState | null>
  saveWindowState: (state: WindowState) => Promise<void>
  minimizeWindow: () => void
  maximizeWindow: () => void
  closeWindow: () => void
  openExternal: (url: string) => Promise<void>
  onNotification: (callback: (payload: { title: string; body: string }) => void) => () => void
  storeGet: (key: string) => Promise<string | null>
  storeSet: (key: string, value: string | null) => Promise<void>
  fileIndexSearch: (params: SearchParams) => Promise<FileEntry[]>
  fileIndexStatus: () => Promise<SourceStatus[]>
  fileIndexOpen: (path: string) => Promise<string>
  fileIndexReindex: (sourceId?: string) => Promise<void>
  onFileIndexProgress: (cb: (count: number) => void) => () => void
  fileIndexSourcesList: () => Promise<FileSource[]>
  fileIndexSourceSave: (source: FileSource) => Promise<void>
  fileIndexSourceDelete: (sourceId: string) => Promise<string | null>
  fileIndexProjectsList: (sourceId?: string) => Promise<string[]>
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
  STORE_GET: 'store:get',
  STORE_SET: 'store:set',
  FILE_INDEX_SEARCH: 'file-index:search',
  FILE_INDEX_STATUS: 'file-index:status',
  FILE_INDEX_OPEN: 'file-index:open',
  FILE_INDEX_REINDEX: 'file-index:reindex',
  FILE_INDEX_PROGRESS: 'file-index:progress',
  FILE_INDEX_SOURCES_LIST: 'file-index:sources-list',
  FILE_INDEX_SOURCE_SAVE: 'file-index:source-save',
  FILE_INDEX_SOURCE_DELETE: 'file-index:source-delete',
  FILE_INDEX_PROJECTS_LIST: 'file-index:projects-list',
} as const
