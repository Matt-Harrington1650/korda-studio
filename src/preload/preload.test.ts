import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-types'

const electronState = vi.hoisted(() => {
  let exposedApi: Record<string, unknown> | null = null

  return {
    get exposedApi() {
      return exposedApi
    },
    set exposedApi(value: Record<string, unknown> | null) {
      exposedApi = value
    },
    contextBridge: {
      exposeInMainWorld: vi.fn((name: string, api: Record<string, unknown>) => {
        if (name === 'kordaAPI') {
          exposedApi = api
        }
      }),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    },
  }
})

vi.mock('electron', () => ({
  contextBridge: electronState.contextBridge,
  ipcRenderer: electronState.ipcRenderer,
}))

describe('preload knowledge and ingestion bridges', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    electronState.exposedApi = null
    vi.resetModules()
    await import('./preload')
  })

  it('bridges knowledgeSearch through ipcRenderer.invoke', () => {
    const api = electronState.exposedApi as {
      knowledgeSearch: (params: { query: string; limit?: number }) => unknown
    }

    api.knowledgeSearch({ query: 'fire rated', limit: 5 })

    expect(electronState.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.KNOWLEDGE_SEARCH, {
      query: 'fire rated',
      limit: 5,
    })
  })

  it('bridges knowledgeAdjacent through ipcRenderer.invoke', () => {
    const api = electronState.exposedApi as {
      knowledgeAdjacent: (fileId: number, chunkIndex: number) => unknown
    }

    api.knowledgeAdjacent(17, 3)

    expect(electronState.ipcRenderer.invoke).toHaveBeenCalledWith(
      IPC_CHANNELS.KNOWLEDGE_ADJACENT,
      17,
      3,
    )
  })

  it('bridges ingestionStatus and ingestionRetry through ipcRenderer.invoke', () => {
    const api = electronState.exposedApi as {
      ingestionStatus: (sourceId?: string) => unknown
      ingestionRetry: (sourceId?: string) => unknown
    }

    api.ingestionStatus('src-1')
    api.ingestionRetry('src-1')

    expect(electronState.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.INGESTION_STATUS,
      'src-1',
    )
    expect(electronState.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.INGESTION_RETRY,
      'src-1',
    )
  })

  it('registers and unregisters onIngestionProgress listeners', () => {
    const api = electronState.exposedApi as {
      onIngestionProgress: (cb: (event: { fileId: number; state: string }) => void) => () => void
    }
    const callback = vi.fn()

    const unsubscribe = api.onIngestionProgress(callback)

    expect(electronState.ipcRenderer.on).toHaveBeenCalledWith(
      IPC_CHANNELS.INGESTION_PROGRESS,
      expect.any(Function),
    )

    const handler = vi.mocked(electronState.ipcRenderer.on).mock.calls[0][1] as (
      event: unknown,
      payload: { fileId: number; state: string },
    ) => void
    handler({}, { fileId: 9, state: 'indexed' })
    expect(callback).toHaveBeenCalledWith({ fileId: 9, state: 'indexed' })

    unsubscribe()

    expect(electronState.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.INGESTION_PROGRESS,
      handler,
    )
  })
})
