import type { FileSource, SourceStatus } from './file-sources'
import type { Citation, EvidenceStatus } from './contracts/citation-contract'
import type { PipelineState } from './contracts/index-record'
import type { ChunkRecord } from './contracts/chunk-record'
import type { RetrievalParams, RetrievalResult } from './contracts/retrieval-contract'
export type { FileSource, FileSourceType, SourceStatus } from './file-sources'
export type { Citation, EvidenceStatus } from './contracts/citation-contract'
export type { RetrievalParams, RetrievalResult } from './contracts/retrieval-contract'
export type { ChunkRecord } from './contracts/chunk-record'
export type { PipelineState } from './contracts/index-record'

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
  sourceId: string | null // present in all search results; null for legacy rows
  project: string | null
  discipline: string | null
  docType: string | null
  drawingNumber: string | null
  revision: string | null
  issueStatus: string | null
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

export interface IngestionStatus {
  new: number
  queued: number
  extracting: number
  chunking: number
  contextualizing: number
  indexed: number
  failed: number
  skipped: number
  total: number
  totalChunks: number
  avgChunksPerFile: number
}

export interface FailedIngestionFile {
  fileId: number
  path: string
  name: string
  sourceId: string
  error: string | null
  updatedAt: number | null
}

export interface IngestionProgressEvent {
  fileId: number
  state: PipelineState
  chunkCount?: number
  error?: string
}

export interface Conversation {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
}

export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  model?: string
  inputTokens?: number
  outputTokens?: number
  mode?: 'plain' | 'grounded' | 'grounded_fallback'
  citations?: Citation[]
  evidenceStatus?: EvidenceStatus
  groundedChunkCount?: number
}

export interface SendParams {
  conversationId: string
  content: string
  model: string
}

export interface GroundedSendParams {
  conversationId: string
  content: string
  model: string
  scopeSourceIds: string[]
  projectFilters: string[]
}

export interface GroundedDonePayload {
  messageId: string
  citations: Citation[]
  evidenceStatus: EvidenceStatus
  inputTokens: number
  outputTokens: number
  chunkCount: number
  finalText: string
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
  storeGet: <T = string>(key: string) => Promise<T | null>
  storeSet: (key: string, value: unknown | null) => Promise<void>
  fileIndexSearch: (params: SearchParams) => Promise<FileEntry[]>
  fileIndexStatus: () => Promise<SourceStatus[]>
  fileIndexOpen: (path: string) => Promise<string>
  fileIndexReindex: (sourceId?: string) => Promise<void>
  onFileIndexProgress: (cb: (count: number) => void) => () => void
  chatSend: (params: SendParams) => Promise<{ messageId: string }>
  chatStop: () => Promise<void>
  chatConversationsList: () => Promise<Conversation[]>
  chatConversationGet: (
    id: string,
  ) => Promise<{ conversation: Conversation; messages: ChatMessage[] }>
  chatConversationNew: () => Promise<Conversation>
  chatConversationDelete: (id: string) => Promise<void>
  chatConversationRename: (id: string, title: string) => Promise<void>
  chatMessagesDeleteFrom: (conversationId: string, fromMessageId: string) => Promise<void>
  chatTestConnection: () => Promise<{ ok: boolean; error?: string }>
  chatApiKeySource: () => Promise<'env' | 'store' | 'none'>
  onChatToken: (cb: (token: string) => void) => () => void
  onChatDone: (
    cb: (data: { messageId: string; inputTokens: number; outputTokens: number }) => void,
  ) => () => void
  onChatError: (cb: (message: string) => void) => () => void
  chatSendGrounded(params: GroundedSendParams): Promise<{ messageId: string }>
  onChatSearching(cb: (messageId: string) => void): () => void
  onChatCitation(
    cb: (payload: { messageId: string; index: number; citation: Citation }) => void,
  ): () => void
  onChatGroundedDone(cb: (payload: GroundedDonePayload) => void): () => void
  fileIndexSourcesList: () => Promise<FileSource[]>
  fileIndexSourceSave: (source: FileSource) => Promise<void>
  fileIndexSourceDelete: (sourceId: string) => Promise<string | null>
  fileIndexProjectsList: (sourceId?: string) => Promise<string[]>
  knowledgeSearch: (params: RetrievalParams) => Promise<RetrievalResult[]>
  knowledgeAdjacent: (
    fileId: number,
    chunkIndex: number,
  ) => Promise<{ prev: ChunkRecord | null; next: ChunkRecord | null }>
  ingestionStatus: (sourceId?: string) => Promise<IngestionStatus>
  ingestionFailedFiles: (sourceId?: string) => Promise<FailedIngestionFile[]>
  ingestionRetry: (sourceId?: string) => Promise<void>
  onIngestionProgress: (cb: (event: IngestionProgressEvent) => void) => () => void
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
  CHAT_SEND: 'chat:send',
  CHAT_SEND_GROUNDED: 'chat:send-grounded',
  CHAT_STOP: 'chat:stop',
  CHAT_CONVERSATIONS_LIST: 'chat:conversations:list',
  CHAT_CONVERSATION_GET: 'chat:conversation:get',
  CHAT_CONVERSATION_NEW: 'chat:conversation:new',
  CHAT_CONVERSATION_DELETE: 'chat:conversation:delete',
  CHAT_CONVERSATION_RENAME: 'chat:conversation:rename',
  CHAT_MESSAGES_DELETE_FROM: 'chat:messages:delete-from',
  CHAT_TEST_CONNECTION: 'chat:test-connection',
  CHAT_API_KEY_SOURCE: 'chat:api-key-source',
  CHAT_TOKEN: 'chat:token',
  CHAT_DONE: 'chat:done',
  CHAT_ERROR: 'chat:error',
  CHAT_SEARCHING: 'chat:searching',
  CHAT_CITATION: 'chat:citation',
  CHAT_GROUNDED_DONE: 'chat:grounded-done',
  FILE_INDEX_SOURCES_LIST: 'file-index:sources-list',
  FILE_INDEX_SOURCE_SAVE: 'file-index:source-save',
  FILE_INDEX_SOURCE_DELETE: 'file-index:source-delete',
  FILE_INDEX_PROJECTS_LIST: 'file-index:projects-list',
  KNOWLEDGE_SEARCH: 'knowledge:search',
  KNOWLEDGE_ADJACENT: 'knowledge:adjacent',
  INGESTION_STATUS: 'ingestion:status',
  INGESTION_FAILED_FILES: 'ingestion:failed-files',
  INGESTION_RETRY: 'ingestion:retry',
  INGESTION_PROGRESS: 'ingestion:progress',
} as const
