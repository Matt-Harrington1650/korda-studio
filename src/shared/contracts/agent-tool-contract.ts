export interface AgentToolInputSchema {
  type: 'object'
  properties?: Record<string, unknown>
  required?: string[]
  additionalProperties?: boolean
}

export interface AgentTool {
  name: string
  description: string
  inputSchema: AgentToolInputSchema
  run?: (input: unknown) => Promise<unknown> | unknown
}
