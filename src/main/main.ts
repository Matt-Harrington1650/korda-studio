import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron'
import path from 'path'
import { IPC_CHANNELS, type SendParams } from '../shared/ipc-types'
import { DEFAULT_AI_CONFIG, type AIConfig } from '../shared/ai-config'
import type { RetrievalParams } from '../shared/contracts/retrieval-contract'
import { chatService } from './chatService'
import type { FileSource } from '../shared/file-sources'
import { fileIndexService } from './fileIndexService'
import { ingestionQueue } from './ingestionQueue'
import { retrievalService } from './retrievalService'

declare const MAIN_WINDOW_VITE_DEV_SERVER_URL: string
declare const MAIN_WINDOW_VITE_NAME: string

let mainWindow: BrowserWindow | null = null

interface StoreSchema {
  preferences: string
  notifications: string
  'window-state': {
    x: number
    y: number
    width: number
    height: number
    isMaximized: boolean
  }
  connections: string // JSON: FileSource[]
  ai: AIConfig
}

// Assigned in initStore() before createWindow()
let store: import('electron-store').default<StoreSchema>

function getSources(): FileSource[] {
  const raw = store?.get('connections') ?? ''
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw as string)
    if (Array.isArray(parsed)) return parsed as FileSource[]
    // Old format: { fileServerRoot } — migration runs in fileIndexService.init()
    return []
  } catch {
    return []
  }
}

async function initStore(): Promise<void> {
  const { default: Store } = await import('electron-store')
  store = new Store<StoreSchema>({
    defaults: {
      preferences: '',
      notifications: '',
      'window-state': getDefaultWindowBounds(),
      connections: '',
      ai: { ...DEFAULT_AI_CONFIG },
    },
  })
}

function getPreferences(): { firmName: string; disciplines: string } {
  const raw = store?.get('preferences') ?? '{}'
  try {
    const parsed = JSON.parse(raw as string) as { firmName?: string; disciplines?: string }
    return {
      firmName: parsed.firmName ?? '',
      disciplines: parsed.disciplines ?? '',
    }
  } catch {
    return { firmName: '', disciplines: '' }
  }
}

function getAIConfig(): AIConfig {
  return {
    ...DEFAULT_AI_CONFIG,
    ...(store?.get('ai') ?? {}),
  }
}

function getApiKey(): string {
  return process.env.ANTHROPIC_API_KEY ?? getAIConfig().anthropicApiKey ?? ''
}

function getDefaultWindowBounds() {
  const { width: screenWidth, height: screenHeight } = screen.getPrimaryDisplay().workAreaSize
  return {
    width: 1280,
    height: 800,
    x: Math.floor((screenWidth - 1280) / 2),
    y: Math.floor((screenHeight - 800) / 2),
    isMaximized: false,
  }
}

function getSavedWindowBounds() {
  if (!store) return null
  const saved = store.get('window-state')
  if (!saved) return null

  // Guard: validate the saved position overlaps at least one connected display's workArea.
  // Uses overlap (not full-containment) to handle windows that span multiple monitors.
  const displays = screen.getAllDisplays()
  const isOnScreen = displays.some((display: Electron.Display) => {
    const { x, y, width, height } = display.workArea
    return (
      saved.x < x + width &&
      saved.x + saved.width > x &&
      saved.y < y + height &&
      saved.y + saved.height > y
    )
  })

  return isOnScreen ? saved : null
}

function createWindow() {
  const saved = getSavedWindowBounds()
  const defaults = getDefaultWindowBounds()
  const bounds = saved ?? defaults

  mainWindow = new BrowserWindow({
    width: bounds.width,
    height: bounds.height,
    x: bounds.x,
    y: bounds.y,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#1a1a2e',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  })

  // Restore maximized state after window is shown
  if (saved?.isMaximized) {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.maximize()
      mainWindow?.show()
    })
  } else {
    mainWindow.once('ready-to-show', () => {
      mainWindow?.show()
    })
  }

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL)
  } else {
    mainWindow.loadFile(path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`))
  }

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools()
  }

  // Save window state on close
  mainWindow.on('close', () => {
    if (mainWindow && store) {
      const closeBounds = mainWindow.getBounds()
      store.set('window-state', {
        ...closeBounds,
        isMaximized: mainWindow.isMaximized(),
      })
    }
  })
}

// IPC Handlers
ipcMain.handle(IPC_CHANNELS.APP_VERSION, () => app.getVersion())

ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, () => mainWindow?.minimize())
ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, () => {
  if (mainWindow?.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    mainWindow?.maximize()
  }
})
ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, () => mainWindow?.close())

ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, (_event, url: string) => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error(`Blocked: only http/https URLs allowed, got ${parsed.protocol}`)
  }
  return shell.openExternal(url)
})

ipcMain.handle(IPC_CHANNELS.WINDOW_GET_STATE, () => {
  return store?.get('window-state') ?? null
})

ipcMain.handle(IPC_CHANNELS.WINDOW_SAVE_STATE, () => {
  if (mainWindow && store) {
    const bounds = mainWindow.getBounds()
    store.set('window-state', { ...bounds, isMaximized: mainWindow.isMaximized() })
  }
})

ipcMain.handle(IPC_CHANNELS.STORE_GET, (_event, key: string) => {
  return store?.get(key as keyof StoreSchema) ?? null
})

ipcMain.handle(IPC_CHANNELS.STORE_SET, (_event, key: string, value: unknown | null) => {
  if (!store) return
  if (value === null) {
    store.delete(key as keyof StoreSchema)
  } else {
    store.set(key as keyof StoreSchema, value as StoreSchema[keyof StoreSchema])
  }
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_SEARCH, (_event, params) => {
  return fileIndexService.search(params)
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_STATUS, () => {
  return fileIndexService.getStatus()
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_OPEN, (_event, filePath: string) => {
  return fileIndexService.openFile(filePath)
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_REINDEX, (_event, sourceId?: string) => {
  fileIndexService.reindex(sourceId)
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_SOURCES_LIST, () => {
  return getSources()
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_PROJECTS_LIST, (_event, sourceId?: string) => {
  return fileIndexService.listProjects(sourceId)
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_SOURCE_SAVE, (_event, source: FileSource) => {
  const current = getSources()
  const existingIdx = current.findIndex((s) => s.id === source.id)
  const wasEnabled = existingIdx >= 0 ? current[existingIdx].enabled : false
  const isNew = existingIdx < 0
  const updated =
    existingIdx >= 0
      ? current.map((s, i) => (i === existingIdx ? source : s))
      : [...current, source]
  store.set('connections', JSON.stringify(updated))

  if (source.enabled && (isNew || !wasEnabled)) {
    fileIndexService.stopWatcher(source.id)
    fileIndexService.startWatcher(source)
    fileIndexService
      .crawlSource(source.id)
      .catch((err) =>
        console.error(`fileIndexService: crawl after save failed [${source.id}]:`, err),
      )
  } else if (!source.enabled) {
    fileIndexService.stopWatcher(source.id)
  }
})

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_SOURCE_DELETE, (_event, sourceId: string): string | null => {
  if (fileIndexService.isCrawling(sourceId)) {
    return 'Source is currently indexing — please wait'
  }
  fileIndexService.stopWatcher(sourceId)
  fileIndexService.deleteSourceData(sourceId)
  const current = getSources().filter((s) => s.id !== sourceId)
  store.set('connections', JSON.stringify(current))
  return null
})

ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_SEARCH, (_event, params: RetrievalParams) => {
  return retrievalService.search(params)
})

ipcMain.handle(IPC_CHANNELS.KNOWLEDGE_ADJACENT, (_event, fileId: number, chunkIndex: number) => {
  return retrievalService.getAdjacentChunks(fileId, chunkIndex)
})

ipcMain.handle(IPC_CHANNELS.INGESTION_STATUS, (_event, sourceId?: string) => {
  return ingestionQueue.getStatus(sourceId)
})

ipcMain.handle(IPC_CHANNELS.INGESTION_RETRY, (_event, sourceId?: string) => {
  ingestionQueue.retry(sourceId)
})

ipcMain.handle(IPC_CHANNELS.CHAT_SEND, (_event, params: SendParams) => {
  return chatService.send(params.conversationId, params.content, params.model)
})

ipcMain.handle(IPC_CHANNELS.CHAT_STOP, () => {
  chatService.stop()
})

ipcMain.handle(IPC_CHANNELS.CHAT_CONVERSATIONS_LIST, () => {
  return chatService.listConversations()
})

ipcMain.handle(IPC_CHANNELS.CHAT_CONVERSATION_GET, (_event, id: string) => {
  return chatService.getConversation(id)
})

ipcMain.handle(IPC_CHANNELS.CHAT_CONVERSATION_NEW, () => {
  return chatService.newConversation()
})

ipcMain.handle(IPC_CHANNELS.CHAT_CONVERSATION_DELETE, (_event, id: string) => {
  chatService.deleteConversation(id)
})

ipcMain.handle(IPC_CHANNELS.CHAT_CONVERSATION_RENAME, (_event, id: string, title: string) => {
  chatService.renameConversation(id, title)
})

ipcMain.handle(
  IPC_CHANNELS.CHAT_MESSAGES_DELETE_FROM,
  (_event, conversationId: string, fromMessageId: string) => {
    chatService.deleteMessagesFrom(conversationId, fromMessageId)
  },
)

ipcMain.handle(IPC_CHANNELS.CHAT_TEST_CONNECTION, () => {
  return chatService.testConnection()
})

ipcMain.handle(IPC_CHANNELS.CHAT_API_KEY_SOURCE, (): 'env' | 'store' | 'none' => {
  if (process.env.ANTHROPIC_API_KEY) return 'env'
  if (getAIConfig().anthropicApiKey) return 'store'
  return 'none'
})

app.whenReady().then(async () => {
  await initStore()

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [
          "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        ],
      },
    })
  })

  createWindow()

  const chatDbPath = path.join(app.getPath('userData'), 'chat.db')
  const fileIndexDbPath = path.join(app.getPath('userData'), 'file-index.db')
  try {
    fileIndexService.init(fileIndexDbPath, getSources, mainWindow)
    const fileIndexDb = fileIndexService.getDb()
    ingestionQueue.init(fileIndexDb, fileIndexDbPath, (event) => {
      mainWindow?.webContents.send(IPC_CHANNELS.INGESTION_PROGRESS, event)
    })
    ingestionQueue.drainNew()
    retrievalService.init(fileIndexDb)
    fileIndexService.crawlIfStale()
  } catch (err) {
    console.error('[KORDA] fileIndexService.init FAILED:', err)
  }

  try {
    chatService.init(chatDbPath, getApiKey, getPreferences, getAIConfig, mainWindow)
  } catch (err) {
    console.error('[KORDA] chatService.init FAILED:', err)
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
