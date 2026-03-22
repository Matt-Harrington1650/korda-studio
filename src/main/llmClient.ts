import Anthropic from '@anthropic-ai/sdk'

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
  abort: () => void
  finalMessage: () => Promise<LLMFinalMessage>
}

export interface LLMClient {
  stream(messages: LLMMessage[], model: string, systemPrompt: string): LLMStreamResult
}

export class AnthropicClient implements LLMClient {
  constructor(private readonly getApiKey: () => string) {}

  stream(messages: LLMMessage[], model: string, systemPrompt: string): LLMStreamResult {
    const apiKey = this.getApiKey().trim()
    if (!apiKey) {
      throw new Error('Anthropic API key is not configured')
    }

    const client = new Anthropic({ apiKey })
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
}
