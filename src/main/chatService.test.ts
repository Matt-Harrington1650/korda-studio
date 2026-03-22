// @vitest-environment node
import Database from 'better-sqlite3'
import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { BrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IPC_CHANNELS } from '../shared/ipc-types'

const { mockClientStream } = vi.hoisted(() => ({
  mockClientStream: vi.fn(),
}))

vi.mock('./llmClient', () => ({
  AnthropicClient: class {
    stream(...args: unknown[]) {
      return mockClientStream(...args)
    }
  },
}))

import { chatService } from './chatService'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })

  return { promise, resolve, reject }
}

function createStream(tokens: string[], usage = { inputTokens: 11, outputTokens: 22 }) {
  return {
    abort: vi.fn(),
    finalMessage: vi.fn().mockResolvedValue(usage),
    iterable: (async function* () {
      for (const token of tokens) {
        yield token
      }
    })(),
  }
}

describe('chatService', () => {
  let dbDir: string
  let dbPath: string
  let webContentsSend: ReturnType<typeof vi.fn>
  let mainWindow: BrowserWindow
  let preferences: { firmName: string; disciplines: string }
  let aiConfig: { provider: 'anthropic'; defaultModel: string; firmContext: string }

  beforeEach(() => {
    vi.clearAllMocks()
    dbDir = mkdtempSync(join(tmpdir(), 'korda-chat-service-'))
    dbPath = join(dbDir, 'chat.db')
    webContentsSend = vi.fn()
    mainWindow = {
      webContents: {
        send: webContentsSend,
      },
    } as unknown as BrowserWindow
    preferences = {
      firmName: 'KORDA',
      disciplines: 'Civil, Structural',
    }
    aiConfig = {
      provider: 'anthropic',
      defaultModel: 'claude-sonnet-4-6',
      firmContext: 'Disciplines practiced by this firm: {disciplines}',
    }

    chatService.init(
      dbPath,
      () => 'test-api-key',
      () => preferences,
      () => aiConfig,
      mainWindow,
    )
  })

  afterEach(() => {
    chatService.close()
    rmSync(dbDir, { recursive: true, force: true })
  })

  it('creates a new conversation with the placeholder title and default model', () => {
    const conversation = chatService.newConversation()

    expect(conversation.title).toBe('New Conversation')
    expect(conversation.model).toBe('claude-sonnet-4-6')
    expect(chatService.listConversations()).toEqual([conversation])
  })

  it('updates the first-message title with collapsed whitespace', async () => {
    mockClientStream.mockReturnValue(createStream(['Ready']))
    const conversation = chatService.newConversation()

    chatService.send(conversation.id, '  First line\n\nSecond line   ', 'claude-sonnet-4-6')

    await vi.waitFor(() => {
      expect(chatService.getConversation(conversation.id).messages).toHaveLength(2)
    })

    expect(chatService.getConversation(conversation.id).conversation.title).toBe(
      'First line Second line',
    )
  })

  it('persists the user message before the stream completes', () => {
    const gate = deferred<void>()
    mockClientStream.mockReturnValue({
      abort: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({ inputTokens: 1, outputTokens: 2 }),
      iterable: (async function* () {
        await gate.promise
        yield 'Later'
      })(),
    })

    const conversation = chatService.newConversation()
    chatService.send(conversation.id, 'Persist me first', 'claude-sonnet-4-6')

    const snapshot = chatService.getConversation(conversation.id)
    expect(snapshot.messages).toHaveLength(1)
    expect(snapshot.messages[0]).toMatchObject({
      role: 'user',
      content: 'Persist me first',
    })

    gate.resolve()
  })

  it('streams token events, persists the assistant reply, and records token counts', async () => {
    mockClientStream.mockReturnValue(
      createStream(['Hello', ' ', 'world'], { inputTokens: 123, outputTokens: 456 }),
    )
    const conversation = chatService.newConversation()

    const { messageId } = chatService.send(conversation.id, 'Say hello', 'claude-sonnet-4-6')

    await vi.waitFor(() => {
      expect(chatService.getConversation(conversation.id).messages).toHaveLength(2)
    })

    const { messages } = chatService.getConversation(conversation.id)
    expect(messages[1]).toMatchObject({
      id: messageId,
      role: 'assistant',
      content: 'Hello world',
      model: 'claude-sonnet-4-6',
      inputTokens: 123,
      outputTokens: 456,
    })
    expect(webContentsSend).toHaveBeenNthCalledWith(1, IPC_CHANNELS.CHAT_TOKEN, 'Hello')
    expect(webContentsSend).toHaveBeenNthCalledWith(2, IPC_CHANNELS.CHAT_TOKEN, ' ')
    expect(webContentsSend).toHaveBeenNthCalledWith(3, IPC_CHANNELS.CHAT_TOKEN, 'world')
    expect(webContentsSend).toHaveBeenLastCalledWith(IPC_CHANNELS.CHAT_DONE, {
      messageId,
      inputTokens: 123,
      outputTokens: 456,
    })
  })

  it('aborts the active stream when stop is called', () => {
    const stream = createStream(['Hello'])
    mockClientStream.mockReturnValue(stream)
    const conversation = chatService.newConversation()

    chatService.send(conversation.id, 'Stop soon', 'claude-sonnet-4-6')
    chatService.stop()

    expect(stream.abort).toHaveBeenCalled()
  })

  it('deletes the target message and all subsequent messages', async () => {
    mockClientStream.mockReturnValue(createStream(['First']))
    const conversation = chatService.newConversation()
    chatService.send(conversation.id, 'Message one', 'claude-sonnet-4-6')
    await vi.waitFor(() => {
      expect(chatService.getConversation(conversation.id).messages).toHaveLength(2)
    })

    mockClientStream.mockReturnValue(createStream(['Second']))
    chatService.send(conversation.id, 'Message two', 'claude-sonnet-4-6')
    await vi.waitFor(() => {
      expect(chatService.getConversation(conversation.id).messages).toHaveLength(4)
    })

    const secondUserMessageId = chatService.getConversation(conversation.id).messages[2].id
    chatService.deleteMessagesFrom(conversation.id, secondUserMessageId)

    expect(chatService.getConversation(conversation.id).messages.map((message) => message.content)).toEqual([
      'Message one',
      'First',
    ])
  })

  it('deletes conversations and cascades their messages', async () => {
    mockClientStream.mockReturnValue(createStream(['Cascade']))
    const conversation = chatService.newConversation()
    chatService.send(conversation.id, 'Remove me', 'claude-sonnet-4-6')

    await vi.waitFor(() => {
      expect(chatService.getConversation(conversation.id).messages).toHaveLength(2)
    })

    chatService.deleteConversation(conversation.id)

    const db = new Database(dbPath)
    try {
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM conversations').get() as { count: number },
      ).toEqual({ count: 0 })
      expect(
        db.prepare('SELECT COUNT(*) AS count FROM messages').get() as { count: number },
      ).toEqual({ count: 0 })
    } finally {
      db.close()
    }
  })

  it('builds the system prompt from live preferences and firm context', () => {
    expect(chatService.buildSystemPrompt()).toContain('engineering assistant for KORDA')
    expect(chatService.buildSystemPrompt()).toContain('Civil, Structural')
    expect(chatService.buildSystemPrompt()).toContain('TODO(phase-2E)')
  })
})
