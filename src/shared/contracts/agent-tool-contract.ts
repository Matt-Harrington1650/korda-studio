export interface AgentTool {
  name: string
  description: string
  inputSchema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
  execute(input: Record<string, unknown>): Promise<AgentToolResult>
}

export interface AgentToolResult {
  content: unknown
  isError?: boolean
}

export const SEARCH_KNOWLEDGE_BASE_TOOL_NAME = 'search_knowledge_base' as const
