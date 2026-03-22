import type { AgentTool } from './agent-tool-contract'

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMFinalMessage {
  inputTokens: number
  outputTokens: number
}

export interface LLMStreamResult {
  iterable: AsyncIterable<string>
  abort(): void
  finalMessage(): Promise<LLMFinalMessage>
}

export interface LLMToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

export interface LLMProvider {
  stream(messages: LLMMessage[], model: string, systemPrompt: string): LLMStreamResult
  streamWithTools(
    messages: LLMMessage[],
    tools: AgentTool[],
    model: string,
    systemPrompt: string,
  ): LLMStreamResult & {
    onToolCall(cb: (call: LLMToolCall) => Promise<unknown>): void
  }
}
