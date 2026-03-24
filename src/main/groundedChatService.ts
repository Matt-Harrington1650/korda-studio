import Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'
import type { Citation, EvidenceStatus } from '../shared/contracts/citation-contract'
import type { LLMMessage } from '../shared/contracts/llm-provider'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'
import { IPC_CHANNELS } from '../shared/ipc-types'
import { AnthropicClient } from './llmClient'
import { toolRegistry } from './toolRegistry'

interface PreferencesSnapshot {
  firmName: string
  disciplines: string
}

interface AIConfigSnapshot {
  provider: 'anthropic'
  defaultModel: string
  firmContext: string
}

interface RunGroundedPipelineParams {
  conversationId: string
  userContent: string
  model: string
  scopeSourceIds: string[]
  projectFilters: string[]
  assistantMessageId: string
  conversationMessages: LLMMessage[]
  win: BrowserWindow
  getApiKey: () => string
  getAIConfig: () => AIConfigSnapshot
  getPreferences: () => PreferencesSnapshot
  signal?: AbortSignal
}

export interface GroundedPipelineResult {
  mode: 'grounded' | 'grounded_fallback'
  content: string
  citations: Citation[]
  evidenceStatus: EvidenceStatus
  inputTokens: number
  outputTokens: number
  chunkCount: number
  searchQueriesUsed: string[]
}

const QUERY_REWRITE_SYSTEM_PROMPT = `You are a search query optimizer for an engineering document retrieval system.
Given a question, produce 2-3 specific search queries that will find relevant
engineering documents. Use precise technical terminology. Return ONLY a JSON
array of strings: ["query1", "query2", "query3"]. No explanation.`

const EVIDENCE_MARKER_RE = /(?:\r?\n)?<!--evidence:(supported|partial|unsupported)-->$/

function createClient(apiKey: string): Anthropic {
  const trimmed = apiKey.trim()
  if (!trimmed) {
    throw new Error('Anthropic API key is not configured')
  }

  return new Anthropic({ apiKey: trimmed })
}

function buildSearchSystemPrompt(
  preferences: PreferencesSnapshot,
  aiConfig: AIConfigSnapshot,
  rewrittenQueries: string[],
): string {
  return `You are an engineering document retrieval agent for ${preferences.firmName || 'the firm'}.
Use the search_knowledge_base tool to find the most relevant indexed documents before answering.
Prefer these rewritten queries first: ${rewrittenQueries.join(' | ')}.
${aiConfig.firmContext}`.trim()
}

function buildAnswerSystemPrompt(
  preferences: PreferencesSnapshot,
  aiConfig: AIConfigSnapshot,
): string {
  return `You are an engineering assistant for ${preferences.firmName || 'the firm'}.
Answer ONLY from the provided documents when possible and cite the supporting material.
At the very end of the answer, on its own line, append exactly one evidence marker:
<!--evidence:supported--> or <!--evidence:partial--> or <!--evidence:unsupported-->
${aiConfig.firmContext}`.trim()
}

function buildFallbackSystemPrompt(
  preferences: PreferencesSnapshot,
  aiConfig: AIConfigSnapshot,
): string {
  return `You are an engineering assistant for ${preferences.firmName || 'the firm'}.
Be precise, technically accurate, and concise.
${aiConfig.firmContext}`.trim()
}

function buildDocTitle(result: RetrievalResult): string {
  const parts = [result.file.name]
  if (result.chunk.sectionTitle) {
    parts.push(`- ${result.chunk.sectionTitle}`)
  }
  if (result.chunk.pageNumber) {
    parts.push(`(p.${result.chunk.pageNumber})`)
  }
  if (result.chunk.sheetName) {
    parts.push(`[${result.chunk.sheetName}]`)
  }

  return parts.join(' ')
}

function bindAbort(signal: AbortSignal | undefined, abort: () => void) {
  if (!signal) {
    return () => undefined
  }

  const handleAbort = () => abort()
  signal.addEventListener('abort', handleAbort, { once: true })
  return () => signal.removeEventListener('abort', handleAbort)
}

function extractRewriteText(response: { content?: unknown }): string | null {
  if (!Array.isArray(response.content)) {
    return null
  }

  for (const block of response.content) {
    if (
      block &&
      typeof block === 'object' &&
      'type' in block &&
      block.type === 'text' &&
      'text' in block &&
      typeof block.text === 'string'
    ) {
      return block.text
    }
  }

  return null
}

function stripEvidenceMarker(fullText: string): { text: string; evidenceStatus: EvidenceStatus } {
  const match = fullText.match(EVIDENCE_MARKER_RE)
  if (!match) {
    return {
      text: fullText,
      evidenceStatus: 'partial',
    }
  }

  return {
    text: fullText.replace(EVIDENCE_MARKER_RE, ''),
    evidenceStatus: match[1] as EvidenceStatus,
  }
}

export async function rewriteQuery(userContent: string, apiKey: string): Promise<string[]> {
  try {
    const client = createClient(apiKey)
    const response = await client.messages.create({
      model: 'claude-haiku-4-5',
      max_tokens: 256,
      system: QUERY_REWRITE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
    })

    const text = extractRewriteText(response)
    if (!text) {
      return [userContent]
    }

    const parsed = JSON.parse(text)
    if (!Array.isArray(parsed)) {
      return [userContent]
    }

    const queries = parsed
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.trim())
      .filter(Boolean)

    return queries.length > 0 ? queries : [userContent]
  } catch {
    return [userContent]
  }
}

export async function runGroundedPipeline(
  params: RunGroundedPipelineParams,
): Promise<GroundedPipelineResult> {
  const {
    userContent,
    model,
    scopeSourceIds,
    projectFilters,
    assistantMessageId,
    conversationMessages,
    win,
    getApiKey,
    getAIConfig,
    getPreferences,
    signal,
  } = params

  const apiKey = getApiKey()
  const preferences = getPreferences()
  const aiConfig = getAIConfig()
  const rewrittenQueries = await rewriteQuery(userContent, apiKey)
  const toolLoopClient = new AnthropicClient(() => apiKey)

  toolRegistry.reset()
  toolRegistry.setScope({ sourceIds: scopeSourceIds, projects: projectFilters })
  win.webContents.send(IPC_CHANNELS.CHAT_SEARCHING, assistantMessageId)

  await toolLoopClient.runToolLoop(
    conversationMessages,
    'claude-haiku-4-5',
    buildSearchSystemPrompt(preferences, aiConfig, rewrittenQueries),
    () => {
      win.webContents.send(IPC_CHANNELS.CHAT_SEARCHING, assistantMessageId)
    },
    4,
    signal,
  )

  const results = toolRegistry.collectResults()
  const client = createClient(apiKey)

  if (results.length === 0) {
    const fallbackStream = client.messages.stream({
      model,
      max_tokens: 4096,
      system: buildFallbackSystemPrompt(preferences, aiConfig),
      messages: conversationMessages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })
    const unbindAbort = bindAbort(signal, () => fallbackStream.abort())

    try {
      let fullText = ''
      win.webContents.send(
        IPC_CHANNELS.CHAT_TOKEN,
        'WARNING: No matching documents found in selected scope - answering from general knowledge\n\n',
      )

      for await (const event of fallbackStream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          fullText += event.delta.text
          win.webContents.send(IPC_CHANNELS.CHAT_TOKEN, event.delta.text)
        }
      }

      const finalMessage = await fallbackStream.finalMessage()
      return {
        mode: 'grounded_fallback',
        content: fullText,
        citations: [],
        evidenceStatus: 'unsupported',
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        chunkCount: 0,
        searchQueriesUsed: rewrittenQueries,
      }
    } finally {
      unbindAbort()
    }
  }

  const pass2Stream = client.messages.stream({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: buildAnswerSystemPrompt(preferences, aiConfig),
        cache_control: { type: 'ephemeral' as const },
      },
    ],
    messages: [
      {
        role: 'user',
        content: [
          ...results.map((result) => ({
            type: 'document' as const,
            source: {
              type: 'text' as const,
              media_type: 'text/plain' as const,
              data: result.chunk.text,
            },
            title: buildDocTitle(result),
            citations: { enabled: true },
            cache_control: { type: 'ephemeral' as const },
          })),
          {
            type: 'text' as const,
            text: userContent,
          },
        ],
      },
    ],
  })
  const unbindAbort = bindAbort(signal, () => pass2Stream.abort())

  try {
    let fullText = ''
    const citations: Citation[] = []
    let citationIndex = 1

    for await (const event of pass2Stream) {
      if (event.type !== 'content_block_delta') {
        continue
      }

      const delta = event.delta as {
        type: string
        text?: string
        citation?: {
          document_index: number
          cited_text: string
        }
      }

      if (delta.type === 'text_delta' && delta.text) {
        fullText += delta.text
        win.webContents.send(IPC_CHANNELS.CHAT_TOKEN, delta.text)
        continue
      }

      if (delta.type === 'citations_delta' && delta.citation) {
        const result = results[delta.citation.document_index]
        if (!result) {
          continue
        }

        const citation: Citation = {
          citationIndex,
          fileId: result.chunk.fileId,
          filePath: result.file.path,
          fileName: result.file.name,
          chunkId: result.chunk.id,
          excerpt: delta.citation.cited_text,
          pageNumber: result.chunk.pageNumber,
          sectionTitle: result.chunk.sectionTitle,
          sourceId: result.file.sourceId ?? '',
        }

        citations.push(citation)
        win.webContents.send(IPC_CHANNELS.CHAT_CITATION, {
          messageId: assistantMessageId,
          index: citationIndex,
          citation,
        })
        citationIndex += 1
      }
    }

    const finalMessage = await pass2Stream.finalMessage()
    const { text, evidenceStatus } = stripEvidenceMarker(fullText)

    return {
      mode: 'grounded',
      content: text,
      citations,
      evidenceStatus,
      inputTokens: finalMessage.usage.input_tokens,
      outputTokens: finalMessage.usage.output_tokens,
      chunkCount: results.length,
      searchQueriesUsed: rewrittenQueries,
    }
  } finally {
    unbindAbort()
  }
}
