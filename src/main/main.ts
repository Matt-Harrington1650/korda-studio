import { app, BrowserWindow, ipcMain, screen, session, shell } from 'electron'
import path from 'path'
import { IPC_CHANNELS, type SendParams } from '../shared/ipc-types'
import { DEFAULT_AI_CONFIG, DEFAULT_FIRM_CONTEXT, type AIConfig } from '../shared/ai-config'
import { chatService } from './chatService'
import { fileIndexService } from './fileIndexService'

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
  connections: string  // JSON-encoded { fileServerRoot: string }
  ai: AIConfig
}

// Assigned in initStore() before createWindow()
let store: import('electron-store').default<StoreSchema>

// Reads the current file-server root from the store (live — always up to date)
function getRoot(): string {
  const raw = store?.get('connections') ?? ''
  if (!raw) return ''
  try {
    const parsed = JSON.parse(raw as string) as { fileServerRoot?: string }
    return parsed.fileServerRoot ?? ''
  } catch {
    return ''
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
  const { width: screenWidth, height: screenHeight } =
    screen.getPrimaryDisplay().workAreaSize
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

ipcMain.handle(IPC_CHANNELS.FILE_INDEX_REINDEX, () => {
  fileIndexService.reindex()
  // Also (re)start the watcher with the current root so live changes are picked up
  // even if the root was empty at app startup
  const root = getRoot()
  if (root) fileIndexService.startWatcher(root)
  // Resolves immediately — crawl runs in background; renderer tracks via FILE_INDEX_PROGRESS
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

  const dbPath = path.join(app.getPath('userData'), 'file-index.db')
  const chatDbPath = path.join(app.getPath('userData'), 'chat.db')
  try {
    fileIndexService.init(dbPath, getRoot, mainWindow)
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
