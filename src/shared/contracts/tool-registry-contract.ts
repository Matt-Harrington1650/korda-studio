import type { AgentTool, AgentToolResult } from './agent-tool-contract'
import type { RetrievalResult } from './retrieval-contract'

export interface ToolRegistry {
  register(tool: AgentTool): void
  execute(name: string, input: Record<string, unknown>): Promise<AgentToolResult>
  getSchemas(): AnthropicToolSchema[]
  collectResults(): RetrievalResult[]
  reset(): void
  setScope(scope: { sourceIds: string[]; projects: string[] }): void
}

export interface AnthropicToolSchema {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

export interface EngineeringTool extends AgentTool {
  commandTriggers?: string[]
  contextKeywords?: string[]
}
