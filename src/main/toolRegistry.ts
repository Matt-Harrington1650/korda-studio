import {
  SEARCH_KNOWLEDGE_BASE_TOOL_NAME,
  type AgentTool,
  type AgentToolResult,
} from '../shared/contracts/agent-tool-contract'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'
import type { AnthropicToolSchema, ToolRegistry } from '../shared/contracts/tool-registry-contract'
import { retrievalService } from './retrievalService'

type ToolScope = {
  sourceIds: string[]
  projects: string[]
}

const DEFAULT_LIMIT = 10

export class ToolRegistryImpl implements ToolRegistry {
  private readonly tools = new Map<string, AgentTool>()
  private readonly collectedResults: RetrievalResult[] = []
  private currentScope: ToolScope = { sourceIds: [], projects: [] }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  async execute(name: string, input: Record<string, unknown>): Promise<AgentToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        content: `Unknown tool: ${name}`,
        isError: true,
      }
    }

    return tool.execute(input)
  }

  getSchemas(): AnthropicToolSchema[] {
    return [...this.tools.values()].map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }))
  }

  collectResults(): RetrievalResult[] {
    const deduped = new Map<string, RetrievalResult>()
    for (const result of this.collectedResults) {
      const existing = deduped.get(result.chunk.id)
      if (
        !existing ||
        (result.bm25Score ?? Number.NEGATIVE_INFINITY) >
          (existing.bm25Score ?? Number.NEGATIVE_INFINITY)
      ) {
        deduped.set(result.chunk.id, result)
      }
    }

    return [...deduped.values()]
      .sort(
        (left, right) =>
          (right.bm25Score ?? Number.NEGATIVE_INFINITY) -
          (left.bm25Score ?? Number.NEGATIVE_INFINITY),
      )
      .slice(0, 20)
  }

  reset(): void {
    this.collectedResults.length = 0
    this.currentScope = { sourceIds: [], projects: [] }
  }

  setScope(scope: ToolScope): void {
    this.currentScope = {
      sourceIds: [...scope.sourceIds],
      projects: [...scope.projects],
    }
  }

  getScope(): ToolScope {
    return this.currentScope
  }

  addResults(results: RetrievalResult[]): void {
    this.collectedResults.push(...results)
  }
}

export const toolRegistry = new ToolRegistryImpl()

function buildSearchCombos(scope: ToolScope): Array<{ sourceId?: string; project?: string }> {
  const sourceIds = scope.sourceIds.length > 0 ? scope.sourceIds : [undefined]
  const projects = scope.projects.length > 0 ? scope.projects : [undefined]
  const combos: Array<{ sourceId?: string; project?: string }> = []

  for (const sourceId of sourceIds) {
    for (const project of projects) {
      combos.push({ sourceId, project })
    }
  }

  return combos
}

export const searchKnowledgeBaseTool: AgentTool = {
  name: SEARCH_KNOWLEDGE_BASE_TOOL_NAME,
  description:
    'Search the indexed engineering knowledge base for documents, specifications, and project records relevant to a query.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Specific engineering search query to run against the knowledge base.',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of matches to return.',
      },
    },
    required: ['query'],
  },
  async execute(input: Record<string, unknown>): Promise<AgentToolResult> {
    const query = typeof input.query === 'string' ? input.query.trim() : ''
    if (!query) {
      return {
        content: 'search_knowledge_base requires a string query',
        isError: true,
      }
    }

    const rawLimit = typeof input.limit === 'number' ? input.limit : DEFAULT_LIMIT
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.floor(rawLimit) : DEFAULT_LIMIT

    try {
      const scopedResults: RetrievalResult[] = []
      for (const combo of buildSearchCombos(toolRegistry.getScope())) {
        const results = await retrievalService.search({
          query,
          sourceId: combo.sourceId,
          project: combo.project,
          limit,
        })
        scopedResults.push(...results)
      }

      toolRegistry.addResults(scopedResults)

      return {
        content: {
          query,
          matches: scopedResults.slice(0, 5).map((result) => ({
            fileName: result.file.name,
            filePath: result.file.path,
            sourceId: result.file.sourceId,
            project: result.file.project,
            excerpt: result.highlight || result.chunk.text.slice(0, 280),
            chunkId: result.chunk.id,
            pageNumber: result.chunk.pageNumber,
            sectionTitle: result.chunk.sectionTitle,
          })),
        },
      }
    } catch (error) {
      return {
        content: error instanceof Error ? error.message : String(error),
        isError: true,
      }
    }
  },
}
