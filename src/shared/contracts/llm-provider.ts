import type { AgentTool } from './agent-tool-contract'

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  name?: string
  toolCallId?: string
}

export interface LLMUsage {
  inputTokens: number
  outputTokens: number
}

export interface LLMStreamResult {
  iterable: AsyncIterable<string>
  abort: () => void
  finalMessage: () => Promise<LLMUsage>
}

export interface LLMProviderRequest {
  model: string
  messages: LLMMessage[]
  systemPrompt?: string
  tools?: AgentTool[]
  temperature?: number
  maxTokens?: number
}

export interface LLMProvider {
  stream(request: LLMProviderRequest): LLMStreamResult
}
