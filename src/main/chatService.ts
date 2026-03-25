import Database from 'better-sqlite3'
import { randomUUID } from 'node:crypto'
import Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'
import type { ChatMessage, Conversation } from '../shared/ipc-types'
import { IPC_CHANNELS } from '../shared/ipc-types'
import type { GroundedAnswer } from '../shared/contracts/citation-contract'
import type { LLMProvider, LLMStreamResult } from '../shared/contracts/llm-provider'
import { runGroundedPipeline } from './groundedChatService'
import { AnthropicClient } from './llmClient'

interface PreferencesSnapshot {
  firmName: string
  disciplines: string
}

interface AIConfigSnapshot {
  provider: 'anthropic'
  defaultModel: string
  firmContext: string
  retrievalMode?: 'keyword' | 'vector' | 'hybrid' | 'auto'
}

interface ConversationRow {
  id: string
  title: string
  model: string
  createdAt: number
  updatedAt: number
}

interface MessageRow {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  model: string | null
  inputTokens: number | null
  outputTokens: number | null
  mode: string | null
  citations: string | null
  groundedChunkCount: number | null
}

let db: Database.Database | null = null
let mainWin: BrowserWindow | null = null
let getApiKeyRef: () => string = () => ''
let getPreferencesRef: () => PreferencesSnapshot = () => ({ firmName: '', disciplines: '' })
let getAIConfigRef: () => AIConfigSnapshot = () => ({
  provider: 'anthropic',
  defaultModel: 'claude-sonnet-4-6',
  firmContext: '',
})
let llmClient: LLMProvider | null = null
let activeStream: LLMStreamResult | null = null
let activeGroundedController: AbortController | null = null

let stmtInsertConversation: Database.Statement
let stmtListConversations: Database.Statement
let stmtGetConversation: Database.Statement
let stmtGetConversationMessages: Database.Statement
let stmtDeleteConversation: Database.Statement
let stmtRenameConversation: Database.Statement
let stmtInsertMessage: Database.Statement
let stmtCountUserMessages: Database.Statement
let stmtUpdateConversationTitle: Database.Statement
let stmtUpdateConversationModel: Database.Statement
let stmtDeleteMessagesFrom: Database.Statement

function isDuplicateColumnError(error: unknown): boolean {
  return error instanceof Error && /duplicate column name/i.test(error.message)
}

const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS conversations (
    id         TEXT    PRIMARY KEY,
    title      TEXT    NOT NULL DEFAULT 'New Conversation',
    model      TEXT    NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS messages (
    id              TEXT    PRIMARY KEY,
    conversation_id TEXT    NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT    NOT NULL,
    content         TEXT    NOT NULL,
    created_at      INTEGER NOT NULL,
    model           TEXT,
    input_tokens    INTEGER,
    output_tokens   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation
    ON messages(conversation_id, created_at);
`

function requireDb(): Database.Database {
  if (!db) {
    throw new Error('chatService has not been initialized')
  }

  return db
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    model: row.model,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

function mapMessage(row: MessageRow): ChatMessage {
  const groundedAnswer = row.citations ? (JSON.parse(row.citations) as GroundedAnswer) : null

  return {
    id: row.id,
    conversationId: row.conversationId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt,
    model: row.model ?? undefined,
    inputTokens: row.inputTokens ?? undefined,
    outputTokens: row.outputTokens ?? undefined,
    mode: (row.mode as ChatMessage['mode']) ?? 'plain',
    citations: groundedAnswer?.citations,
    evidenceStatus: groundedAnswer?.evidenceStatus,
    groundedChunkCount: row.groundedChunkCount ?? undefined,
  }
}

function deriveConversationTitle(userContent: string): string {
  return userContent.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New Conversation'
}

async function runStream(
  conversationId: string,
  messageId: string,
  model: string,
  stream: LLMStreamResult,
): Promise<void> {
  let assistantContent = ''

  try {
    for await (const token of stream.iterable) {
      assistantContent += token
      mainWin?.webContents.send(IPC_CHANNELS.CHAT_TOKEN, token)
    }

    const usage = await stream.finalMessage()
    const now = Date.now()
    stmtInsertMessage.run({
      id: messageId,
      conversationId,
      role: 'assistant',
      content: assistantContent,
      createdAt: now,
      model,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      mode: 'plain',
      citations: null,
      groundedChunkCount: null,
    })
    stmtUpdateConversationModel.run({
      id: conversationId,
      model,
      updatedAt: now,
    })
    mainWin?.webContents.send(IPC_CHANNELS.CHAT_DONE, {
      messageId,
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    mainWin?.webContents.send(IPC_CHANNELS.CHAT_ERROR, message)
  } finally {
    if (activeStream === stream) {
      activeStream = null
    }
  }
}

export const chatService = {
  init(
    dbPath: string,
    getApiKey: () => string,
    getPreferences: () => PreferencesSnapshot,
    getAIConfig: () => AIConfigSnapshot,
    win: BrowserWindow | null,
  ): void {
    db?.close()

    db = new Database(dbPath)
    db.pragma('foreign_keys = ON')
    db.pragma('journal_mode = WAL')
    db.exec(SCHEMA_SQL)
    try {
      db.exec(`ALTER TABLE messages ADD COLUMN mode TEXT NOT NULL DEFAULT 'plain'`)
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }
    try {
      db.exec(`ALTER TABLE messages ADD COLUMN citations TEXT`)
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }
    try {
      db.exec(`ALTER TABLE messages ADD COLUMN grounded_chunk_count INTEGER`)
    } catch (error) {
      if (!isDuplicateColumnError(error)) {
        throw error
      }
    }

    mainWin = win
    getApiKeyRef = getApiKey
    getPreferencesRef = getPreferences
    getAIConfigRef = getAIConfig
    llmClient = new AnthropicClient(getApiKey)
    activeStream = null
    activeGroundedController = null

    stmtInsertConversation = db.prepare(`
      INSERT INTO conversations (id, title, model, created_at, updated_at)
      VALUES (@id, @title, @model, @createdAt, @updatedAt)
    `)
    stmtListConversations = db.prepare(`
      SELECT
        id,
        title,
        model,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM conversations
      ORDER BY updated_at DESC, created_at DESC
    `)
    stmtGetConversation = db.prepare(`
      SELECT
        id,
        title,
        model,
        created_at AS createdAt,
        updated_at AS updatedAt
      FROM conversations
      WHERE id = ?
    `)
    stmtGetConversationMessages = db.prepare(`
      SELECT
        id,
        conversation_id AS conversationId,
        role,
        content,
        created_at AS createdAt,
        model,
        input_tokens AS inputTokens,
        output_tokens AS outputTokens,
        mode,
        citations,
        grounded_chunk_count AS groundedChunkCount
      FROM messages
      WHERE conversation_id = ?
      ORDER BY rowid ASC
    `)
    stmtDeleteConversation = db.prepare('DELETE FROM conversations WHERE id = ?')
    stmtRenameConversation = db.prepare('UPDATE conversations SET title = ? WHERE id = ?')
    stmtInsertMessage = db.prepare(`
      INSERT INTO messages (
        id,
        conversation_id,
        role,
        content,
        created_at,
        model,
        input_tokens,
        output_tokens,
        mode,
        citations,
        grounded_chunk_count
      ) VALUES (
        @id,
        @conversationId,
        @role,
        @content,
        @createdAt,
        @model,
        @inputTokens,
        @outputTokens,
        @mode,
        @citations,
        @groundedChunkCount
      )
    `)
    stmtCountUserMessages = db.prepare(`
      SELECT COUNT(*) AS count
      FROM messages
      WHERE conversation_id = ? AND role = 'user'
    `)
    stmtUpdateConversationTitle = db.prepare(`
      UPDATE conversations
      SET title = @title, model = @model, updated_at = @updatedAt
      WHERE id = @id
    `)
    stmtUpdateConversationModel = db.prepare(`
      UPDATE conversations
      SET model = @model, updated_at = @updatedAt
      WHERE id = @id
    `)
    stmtDeleteMessagesFrom = db.prepare(`
      DELETE FROM messages
      WHERE conversation_id = ?
        AND rowid >= (SELECT rowid FROM messages WHERE id = ?)
    `)
  },

  close(): void {
    activeStream?.abort()
    activeGroundedController?.abort()
    activeStream = null
    activeGroundedController = null
    db?.close()
    db = null
    mainWin = null
    llmClient = null
  },

  listConversations(): Conversation[] {
    requireDb()
    return (stmtListConversations.all() as ConversationRow[]).map(mapConversation)
  },

  getConversation(id: string): { conversation: Conversation; messages: ChatMessage[] } {
    requireDb()
    const conversation = stmtGetConversation.get(id) as ConversationRow | undefined
    if (!conversation) {
      throw new Error(`Conversation not found: ${id}`)
    }

    return {
      conversation: mapConversation(conversation),
      messages: (stmtGetConversationMessages.all(id) as MessageRow[]).map(mapMessage),
    }
  },

  newConversation(): Conversation {
    requireDb()
    const now = Date.now()
    const conversation = {
      id: randomUUID(),
      title: 'New Conversation',
      model: getAIConfigRef().defaultModel,
      createdAt: now,
      updatedAt: now,
    }

    stmtInsertConversation.run(conversation)
    return conversation
  },

  deleteConversation(id: string): void {
    requireDb()
    stmtDeleteConversation.run(id)
  },

  renameConversation(id: string, title: string): void {
    requireDb()
    stmtRenameConversation.run(title.trim() || 'New Conversation', id)
  },

  deleteMessagesFrom(conversationId: string, fromMessageId: string): void {
    requireDb()
    stmtDeleteMessagesFrom.run(conversationId, fromMessageId)
  },

  send(conversationId: string, userContent: string, model: string): { messageId: string } {
    requireDb()
    if (!llmClient) {
      throw new Error('LLM client is not initialized')
    }

    const now = Date.now()
    const assistantMessageId = randomUUID()
    const userMessageId = randomUUID()
    const existingUserMessages = stmtCountUserMessages.get(conversationId) as { count: number }

    stmtInsertMessage.run({
      id: userMessageId,
      conversationId,
      role: 'user',
      content: userContent,
      createdAt: now,
      model: null,
      inputTokens: null,
      outputTokens: null,
      mode: 'plain',
      citations: null,
      groundedChunkCount: null,
    })

    if (existingUserMessages.count === 0) {
      stmtUpdateConversationTitle.run({
        id: conversationId,
        title: deriveConversationTitle(userContent),
        model,
        updatedAt: now,
      })
    } else {
      stmtUpdateConversationModel.run({
        id: conversationId,
        model,
        updatedAt: now,
      })
    }

    const messages = (stmtGetConversationMessages.all(conversationId) as MessageRow[]).map(
      (row) => ({
        role: row.role,
        content: row.content,
      }),
    )
    const stream = llmClient.stream(messages, model, this.buildSystemPrompt())
    activeStream = stream
    void runStream(conversationId, assistantMessageId, model, stream)

    return { messageId: assistantMessageId }
  },

  sendGrounded(
    conversationId: string,
    userContent: string,
    model: string,
    scopeSourceIds: string[],
    projectFilters: string[],
  ): { messageId: string } {
    requireDb()

    if (scopeSourceIds.length === 0) {
      return this.send(conversationId, userContent, model)
    }

    if (!mainWin) {
      throw new Error('Main window is not available')
    }

    const now = Date.now()
    const assistantMessageId = randomUUID()
    const userMessageId = randomUUID()
    const existingUserMessages = stmtCountUserMessages.get(conversationId) as { count: number }

    stmtInsertMessage.run({
      id: userMessageId,
      conversationId,
      role: 'user',
      content: userContent,
      createdAt: now,
      model: null,
      inputTokens: null,
      outputTokens: null,
      mode: 'grounded',
      citations: null,
      groundedChunkCount: null,
    })

    if (existingUserMessages.count === 0) {
      stmtUpdateConversationTitle.run({
        id: conversationId,
        title: deriveConversationTitle(userContent),
        model,
        updatedAt: now,
      })
    } else {
      stmtUpdateConversationModel.run({
        id: conversationId,
        model,
        updatedAt: now,
      })
    }

    const conversationMessages = (
      stmtGetConversationMessages.all(conversationId) as MessageRow[]
    ).map((row) => ({
      role: row.role as 'user' | 'assistant',
      content: row.content,
    }))

    const controller = new AbortController()
    activeGroundedController = controller

    void runGroundedPipeline({
      conversationId,
      userContent,
      model,
      scopeSourceIds,
      projectFilters,
      assistantMessageId,
      conversationMessages,
      win: mainWin,
      getApiKey: getApiKeyRef,
      getAIConfig: getAIConfigRef,
      getPreferences: getPreferencesRef,
      signal: controller.signal,
    })
      .then((result) => {
        const finalizedAt = Date.now()
        const groundedAnswer =
          result.mode === 'grounded'
            ? JSON.stringify({
                text: result.content,
                citations: result.citations,
                evidenceStatus: result.evidenceStatus,
                retrievedChunkCount: result.chunkCount,
                searchQueriesUsed: result.searchQueriesUsed,
              } satisfies GroundedAnswer)
            : null

        stmtInsertMessage.run({
          id: assistantMessageId,
          conversationId,
          role: 'assistant',
          content: result.content,
          createdAt: finalizedAt,
          model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          mode: result.mode,
          citations: groundedAnswer,
          groundedChunkCount: result.chunkCount,
        })
        stmtUpdateConversationModel.run({
          id: conversationId,
          model,
          updatedAt: finalizedAt,
        })

        if (result.mode === 'grounded') {
          mainWin?.webContents.send(IPC_CHANNELS.CHAT_GROUNDED_DONE, {
            messageId: assistantMessageId,
            citations: result.citations,
            evidenceStatus: result.evidenceStatus,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
            chunkCount: result.chunkCount,
            finalText: result.content,
          })
        } else {
          mainWin?.webContents.send(IPC_CHANNELS.CHAT_DONE, {
            messageId: assistantMessageId,
            inputTokens: result.inputTokens,
            outputTokens: result.outputTokens,
          })
        }
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error)
        mainWin?.webContents.send(IPC_CHANNELS.CHAT_ERROR, message)
      })
      .finally(() => {
        if (activeGroundedController === controller) {
          activeGroundedController = null
        }
      })

    return { messageId: assistantMessageId }
  },

  stop(): void {
    activeStream?.abort()
    activeGroundedController?.abort()
    activeGroundedController = null
  },

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    const apiKey = getApiKeyRef().trim()
    if (!apiKey) {
      return { ok: false, error: 'Anthropic API key is not configured' }
    }

    try {
      const client = new Anthropic({ apiKey })
      await client.messages.create({
        model: getAIConfigRef().defaultModel,
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      })
      return { ok: true }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },

  buildSystemPrompt(): string {
    const { firmName, disciplines } = getPreferencesRef()
    const systemPrompt = `You are an engineering assistant for {firmName}. You help engineers with technical questions, document review, calculations, specifications, and project coordination.

${getAIConfigRef().firmContext}

// TODO(phase-2E): append live file index context here
// const indexSummary = await fileIndexService.getProjectSummary()`

    return systemPrompt.replaceAll('{firmName}', firmName).replaceAll('{disciplines}', disciplines)
  },
}
