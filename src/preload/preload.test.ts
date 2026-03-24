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

  it('bridges ingestionStatus, ingestionFailedFiles, and ingestionRetry through ipcRenderer.invoke', () => {
    const api = electronState.exposedApi as {
      ingestionStatus: (sourceId?: string) => unknown
      ingestionFailedFiles: (sourceId?: string) => unknown
      ingestionRetry: (sourceId?: string) => unknown
    }

    api.ingestionStatus('src-1')
    api.ingestionFailedFiles('src-1')
    api.ingestionRetry('src-1')

    expect(electronState.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      1,
      IPC_CHANNELS.INGESTION_STATUS,
      'src-1',
    )
    expect(electronState.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      2,
      IPC_CHANNELS.INGESTION_FAILED_FILES,
      'src-1',
    )
    expect(electronState.ipcRenderer.invoke).toHaveBeenNthCalledWith(
      3,
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

  it('bridges chatSendGrounded through ipcRenderer.invoke', () => {
    const api = electronState.exposedApi as {
      chatSendGrounded: (params: {
        conversationId: string
        content: string
        model: string
        scopeSourceIds: string[]
        projectFilters: string[]
      }) => unknown
    }

    api.chatSendGrounded({
      conversationId: 'conv-1',
      content: 'fire rating corridor',
      model: 'claude-sonnet-4-6',
      scopeSourceIds: ['src1'],
      projectFilters: ['HospitalExpansion'],
    })

    expect(electronState.ipcRenderer.invoke).toHaveBeenCalledWith(IPC_CHANNELS.CHAT_SEND_GROUNDED, {
      conversationId: 'conv-1',
      content: 'fire rating corridor',
      model: 'claude-sonnet-4-6',
      scopeSourceIds: ['src1'],
      projectFilters: ['HospitalExpansion'],
    })
  })

  it('registers and unregisters grounded chat listeners', () => {
    const api = electronState.exposedApi as {
      onChatSearching: (cb: (messageId: string) => void) => () => void
      onChatCitation: (
        cb: (payload: {
          messageId: string
          index: number
          citation: { citationIndex: number; excerpt: string }
        }) => void,
      ) => () => void
      onChatGroundedDone: (
        cb: (payload: { messageId: string; finalText: string }) => void,
      ) => () => void
    }
    const onSearching = vi.fn()
    const onCitation = vi.fn()
    const onGroundedDone = vi.fn()

    const unsubscribeSearching = api.onChatSearching(onSearching)
    const unsubscribeCitation = api.onChatCitation(onCitation)
    const unsubscribeGroundedDone = api.onChatGroundedDone(onGroundedDone)

    const searchingHandler = vi.mocked(electronState.ipcRenderer.on).mock.calls[0][1] as (
      event: unknown,
      payload: string,
    ) => void
    const citationHandler = vi.mocked(electronState.ipcRenderer.on).mock.calls[1][1] as (
      event: unknown,
      payload: {
        messageId: string
        index: number
        citation: { citationIndex: number; excerpt: string }
      },
    ) => void
    const groundedDoneHandler = vi.mocked(electronState.ipcRenderer.on).mock.calls[2][1] as (
      event: unknown,
      payload: { messageId: string; finalText: string },
    ) => void

    searchingHandler({}, 'asst-1')
    citationHandler(
      {},
      {
        messageId: 'asst-1',
        index: 1,
        citation: { citationIndex: 1, excerpt: '2 hours' },
      },
    )
    groundedDoneHandler({}, { messageId: 'asst-1', finalText: 'Grounded answer' })

    expect(onSearching).toHaveBeenCalledWith('asst-1')
    expect(onCitation).toHaveBeenCalledWith({
      messageId: 'asst-1',
      index: 1,
      citation: { citationIndex: 1, excerpt: '2 hours' },
    })
    expect(onGroundedDone).toHaveBeenCalledWith({
      messageId: 'asst-1',
      finalText: 'Grounded answer',
    })

    unsubscribeSearching()
    unsubscribeCitation()
    unsubscribeGroundedDone()

    expect(electronState.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.CHAT_SEARCHING,
      searchingHandler,
    )
    expect(electronState.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.CHAT_CITATION,
      citationHandler,
    )
    expect(electronState.ipcRenderer.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.CHAT_GROUNDED_DONE,
      groundedDoneHandler,
    )
  })
})
