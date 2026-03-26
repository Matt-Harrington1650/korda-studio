import Anthropic from '@anthropic-ai/sdk'
import type { AgentTool } from '../shared/contracts/agent-tool-contract'
import type {
  LLMMessage,
  LLMProvider,
  LLMStreamResult,
  LLMToolCall,
} from '../shared/contracts/llm-provider'
import { toolRegistry } from './toolRegistry'

type ToolLoopContent = string | Array<Record<string, unknown>>
type ToolLoopMessage = {
  role: 'user' | 'assistant'
  content: ToolLoopContent
}

export class AnthropicClient implements LLMProvider {
  constructor(private readonly getApiKey: () => string) {}

  private createClient(): Anthropic {
    const apiKey = this.getApiKey().trim()
    if (!apiKey) {
      throw new Error('Anthropic API key is not configured')
    }

    return new Anthropic({ apiKey })
  }

  stream(messages: LLMMessage[], model: string, systemPrompt: string): LLMStreamResult {
    const client = this.createClient()
    const stream = client.messages.stream({
      model,
      max_tokens: 8096,
      system: systemPrompt,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content,
      })),
    })

    async function* textIterable(): AsyncIterable<string> {
      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield event.delta.text
        }
      }
    }

    return {
      iterable: textIterable(),
      abort: () => stream.abort(),
      finalMessage: async () => {
        const message = await stream.finalMessage()
        return {
          inputTokens: message.usage.input_tokens,
          outputTokens: message.usage.output_tokens,
        }
      },
    }
  }

  async runToolLoop(
    messages: LLMMessage[],
    model: string,
    systemPrompt: string,
    onToolCall: (name: string, input: Record<string, unknown>) => void | Promise<void>,
    maxToolCalls = 4,
    signal?: AbortSignal,
  ): Promise<void> {
    const client = this.createClient()
    const anthropicMessages: ToolLoopMessage[] = messages.map((message) => ({
      role: message.role,
      content: message.content,
    }))

    let toolCallCount = 0

    while (true) {
      const response = await client.messages.create(
        {
          model,
          max_tokens: 1024,
          system: systemPrompt,
          tools: toolRegistry.getSchemas(),
          // Force at least one tool call on the first iteration so the model
          // always searches before answering, even for queries it could answer
          // from training data (e.g. "What is the SPT N-value in the fill layer?").
          tool_choice: toolCallCount === 0 ? { type: 'any' } : { type: 'auto' },
          messages: anthropicMessages.map((message) => ({
            role: message.role,
            content: message.content,
          })) as never,
        },
        signal ? { signal } : undefined,
      )

      if (response.stop_reason !== 'tool_use') {
        break
      }

      anthropicMessages.push({
        role: 'assistant',
        content: response.content as unknown as Array<Record<string, unknown>>,
      })

      const toolResults: Array<{
        type: 'tool_result'
        tool_use_id: string
        content: string
      }> = []

      for (const block of response.content as unknown as Array<Record<string, unknown>>) {
        if (block.type !== 'tool_use') {
          continue
        }

        const name = typeof block.name === 'string' ? block.name : ''
        const input =
          block.input && typeof block.input === 'object'
            ? (block.input as Record<string, unknown>)
            : {}
        const toolUseId = typeof block.id === 'string' ? block.id : ''

        await onToolCall(name, input)
        const result = await toolRegistry.execute(name, input)

        toolResults.push({
          type: 'tool_result',
          tool_use_id: toolUseId,
          content: JSON.stringify(result.content),
        })
      }

      if (toolResults.length === 0) {
        break
      }

      anthropicMessages.push({
        role: 'user',
        content: toolResults as Array<Record<string, unknown>>,
      })

      toolCallCount += 1
      if (toolCallCount >= maxToolCalls) {
        break
      }
    }
  }

  streamWithTools(
    messages: LLMMessage[],
    _tools: AgentTool[],
    model: string,
    systemPrompt: string,
  ): ReturnType<LLMProvider['streamWithTools']> {
    const controller = new AbortController()
    let toolCallHandler: ((call: LLMToolCall) => Promise<unknown>) | undefined
    let nextToolCallId = 0

    const completion = Promise.resolve().then(() =>
      this.runToolLoop(
        messages,
        model,
        systemPrompt,
        async (name, input) => {
          await toolCallHandler?.({
            id: `tool-call-${++nextToolCallId}`,
            name,
            input,
          })
        },
        4,
        controller.signal,
      ),
    )

    return {
      iterable: (async function* () {})(),
      abort: () => controller.abort(),
      finalMessage: async () => {
        await completion
        return {
          inputTokens: 0,
          outputTokens: 0,
        }
      },
      onToolCall(cb: (call: LLMToolCall) => Promise<unknown>) {
        toolCallHandler = cb
      },
    }
  }
}
