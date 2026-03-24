# Phase 3B — Grounded Chat Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire two-pass grounded chat (tool-loop retrieval + Citations API streaming answer) into the existing chat UI, with scope selector, citation panel, and evidence status badge.

**Architecture:** Pre-Pass-1 query rewriting (Haiku) → multi-turn tool loop collecting chunks from indexed knowledge base (Haiku) → Citations API streaming answer with inline [N] markers (Sonnet). All three passes run in sequence inside `groundedChatService.runGroundedPipeline()`. DB operations live in `chatService.ts`; AI logic lives in `groundedChatService.ts`.

**Tech Stack:** Anthropic SDK 0.80 (tool use + Citations API + prompt caching already supported), better-sqlite3, Electron IPC, React + Tailwind, Vitest, @testing-library/react.

---

## File Map

### Create

```
src/shared/contracts/tool-registry-contract.ts   ← ToolRegistry interface + AnthropicToolSchema + EngineeringTool stub
src/main/toolRegistry.ts                          ← ToolRegistryImpl class + searchKnowledgeBaseTool const
src/main/toolRegistry.test.ts
src/main/groundedChatService.ts                   ← rewriteQuery + runGroundedPipeline
src/main/groundedChatService.test.ts
src/renderer/modules/chat/components/ScopeSelector.tsx
src/renderer/modules/chat/components/ScopeSelector.test.tsx
src/renderer/modules/chat/components/CitationMarker.tsx
src/renderer/modules/chat/components/CitationMarker.test.tsx
src/renderer/modules/chat/components/CitationPanel.tsx
src/renderer/modules/chat/components/CitationPanel.test.tsx
```

### Modify

```
src/shared/ipc-types.ts                           ← new types + channels + extended ChatMessage + KordaAPI
src/preload/preload.ts                            ← 4 new bridge functions
src/main/llmClient.ts                             ← runToolLoop() + streamWithTools() delegate
src/main/llmClient.anthropic.test.ts              ← update placeholder test + runToolLoop tests
src/main/chatService.ts                           ← schema migration + sendGrounded() + mapMessage()
src/main/main.ts                                  ← toolRegistry.register + chat:send-grounded handler
src/renderer/modules/chat/ChatModule.tsx          ← scope state + grounded routing + grounded IPC handlers
src/renderer/modules/chat/components/ChatInput.tsx  ← ScopeSelector integration
src/renderer/modules/chat/components/MessageBubble.tsx  ← [N] markers + CitationPanel + amber notice
```

### No new dependencies

All features use `@anthropic-ai/sdk` 0.80 which is already installed.

---

## Chunk 1: Contracts & IPC Types

### Task 1: Create `tool-registry-contract.ts`

**Files:**

- Create: `src/shared/contracts/tool-registry-contract.ts`

- [ ] **Step 1: Create the contract file**

```typescript
// src/shared/contracts/tool-registry-contract.ts
import type { AgentTool, AgentToolResult } from './agent-tool-contract'
import type { RetrievalResult } from './retrieval-contract'

export interface ToolRegistry {
  /** Register a tool. Called at init time. */
  register(tool: AgentTool): void

  /** Execute a named tool with given input. Called by the tool loop. */
  execute(name: string, input: Record<string, unknown>): Promise<AgentToolResult>

  /**
   * All registered tools in Anthropic SDK format.
   * Maps AgentTool.inputSchema (camelCase) → input_schema (snake_case required by API).
   */
  getSchemas(): AnthropicToolSchema[]

  /**
   * All unique RetrievalResults from search_knowledge_base calls this session.
   * Each RetrievalResult contains both ChunkRecord AND FileEntry.
   * Deduped by chunk.id, sorted by bm25Score desc, capped at 20.
   */
  collectResults(): RetrievalResult[]

  /** Reset result collection. Called at start of each sendGrounded(). */
  reset(): void

  /** Set scope filters injected into every search_knowledge_base execution. */
  setScope(scope: { sourceIds: string[]; projects: string[] }): void
}

export interface AnthropicToolSchema {
  name: string
  description: string
  /** snake_case as required by Anthropic API — mapped from AgentTool.inputSchema */
  input_schema: {
    type: 'object'
    properties: Record<string, { type: string; description?: string }>
    required?: string[]
  }
}

/**
 * EngineeringTool — stub interface for Phase 3D custom tools.
 * Extends AgentTool with optional trigger patterns.
 * Not implemented in Phase 3B — locked here for future registration.
 */
export interface EngineeringTool extends AgentTool {
  /** Slash command triggers: ['/loads', '/units'] */
  commandTriggers?: string[]
  /** Context keywords that suggest this tool is relevant */
  contextKeywords?: string[]
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd "C:/code/Korda studio/korda-studio"
npx tsc --noEmit 2>&1 | head -20
```

Expected: no errors from this file.

- [ ] **Step 3: Commit**

```bash
git add src/shared/contracts/tool-registry-contract.ts
git commit -m "feat(3b): add ToolRegistry contract + EngineeringTool stub"
```

---

### Task 2: Extend `ipc-types.ts`

**Files:**

- Modify: `src/shared/ipc-types.ts`

- [ ] **Step 1: Add import + new types + extend ChatMessage + extend KordaAPI + add IPC channels**

Open `src/shared/ipc-types.ts` and apply these changes:

**At the top, add import after existing imports:**

```typescript
import type { Citation, EvidenceStatus } from './contracts/citation-contract'
export type { Citation, EvidenceStatus } from './contracts/citation-contract'
```

**Replace the existing `ChatMessage` interface with:**

```typescript
export interface ChatMessage {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  model?: string
  inputTokens?: number
  outputTokens?: number
  mode?: 'plain' | 'grounded' | 'grounded_fallback'
  citations?: Citation[]
  evidenceStatus?: EvidenceStatus
  groundedChunkCount?: number
}
```

**Add these new interfaces after `SendParams`:**

```typescript
export interface GroundedSendParams {
  conversationId: string
  content: string
  model: string
  scopeSourceIds: string[]
  projectFilters: string[]
}

export interface GroundedDonePayload {
  messageId: string
  citations: Citation[]
  evidenceStatus: EvidenceStatus
  inputTokens: number
  outputTokens: number
  chunkCount: number
  /** Stripped final text (evidence marker removed). Renderer replaces streamed content. */
  finalText: string
}
```

**Add these methods to `KordaAPI` after `onChatError`:**

```typescript
  chatSendGrounded(params: GroundedSendParams): Promise<{ messageId: string }>
  onChatSearching(cb: (messageId: string) => void): () => void
  onChatCitation(
    cb: (payload: { messageId: string; index: number; citation: Citation }) => void,
  ) : () => void
  onChatGroundedDone(cb: (payload: GroundedDonePayload) => void): () => void
```

**Add these entries to `IPC_CHANNELS`:**

```typescript
  CHAT_SEND_GROUNDED: 'chat:send-grounded',
  CHAT_SEARCHING: 'chat:searching',
  CHAT_CITATION: 'chat:citation',
  CHAT_GROUNDED_DONE: 'chat:grounded-done',
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/shared/ipc-types.ts
git commit -m "feat(3b): extend ipc-types with grounded chat channels and types"
```

---

## Chunk 2: Tool Registry & runToolLoop

### Task 3: Create `toolRegistry.ts` + `toolRegistry.test.ts`

**Files:**

- Create: `src/main/toolRegistry.ts`
- Create: `src/main/toolRegistry.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/main/toolRegistry.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'
import type { AgentTool } from '../shared/contracts/agent-tool-contract'
import { SEARCH_KNOWLEDGE_BASE_TOOL_NAME } from '../shared/contracts/agent-tool-contract'

// Mock retrievalService before importing toolRegistry
const mockSearch = vi.fn()
vi.mock('./retrievalService', () => ({
  retrievalService: { search: mockSearch },
}))

import { ToolRegistryImpl, searchKnowledgeBaseTool } from './toolRegistry'

// Use fresh registry instances in every test — avoids singleton state bleed.
// The singleton `toolRegistry` is used in production but not imported in tests.
let registry: InstanceType<typeof ToolRegistryImpl>

function makeResult(
  id: string,
  score: number,
  sourceId = 'src1',
  project = 'proj1',
): RetrievalResult {
  return {
    chunk: {
      id,
      fileId: 1,
      sourceId,
      chunkIndex: 0,
      text: `text of ${id}`,
      tokenCount: 10,
      charCount: 50,
      pageNumber: 1,
      sectionTitle: 'Section',
      sheetName: null,
      embedding: null,
      createdAt: Date.now(),
    },
    file: {
      path: `/docs/${id}.pdf`,
      name: `${id}.pdf`,
      ext: '.pdf',
      sizeBytes: 1000,
      modifiedMs: Date.now(),
      isDir: false,
      sourceId,
      project,
      discipline: null,
      docType: null,
      drawingNumber: null,
      revision: null,
      issueStatus: null,
    },
    bm25Score: score,
    vectorDistance: null,
    rrfScore: null,
    highlight: `highlight ${id}`,
  }
}

describe('ToolRegistryImpl', () => {
  // Each test gets a fresh registry instance — no singleton state bleed.
  beforeEach(() => {
    vi.clearAllMocks()
    registry = new ToolRegistryImpl()
    // searchKnowledgeBaseTool.execute() internally references the module-level
    // `toolRegistry` singleton for scope/results storage. For isolated tests we
    // patch those calls by using registry directly and registering the tool there,
    // then call the tool's execute() with registry.setScope() pre-set on the
    // fresh registry. Because searchKnowledgeBaseTool.execute() calls
    // `toolRegistry.getScope()` and `toolRegistry.addResults()` on the SINGLETON,
    // tests that exercise searchKnowledgeBaseTool use the singleton but call
    // singleton.reset() in beforeEach to clear it.
    //
    // For pure registry behaviour tests (register/getSchemas/execute dispatch)
    // we use the fresh `registry` instance with custom test tools only.
  })

  // Note: ToolRegistryImpl tests use fresh instances only — no singleton interaction,
  // so no afterEach singleton cleanup needed here.

  it('registers a tool and returns its schema with input_schema (snake_case)', () => {
    const tool: AgentTool = {
      name: 'test_tool',
      description: 'A test tool',
      inputSchema: {
        type: 'object',
        properties: { query: { type: 'string', description: 'search query' } },
        required: ['query'],
      },
      execute: vi.fn().mockResolvedValue({ content: 'result' }),
    }
    registry.register(tool)
    const schemas = registry.getSchemas()
    const schema = schemas.find((s) => s.name === 'test_tool')
    expect(schema).toBeDefined()
    expect(schema?.input_schema).toEqual(tool.inputSchema)
    expect(schema).not.toHaveProperty('inputSchema')
  })

  it('execute returns error result for unknown tool', async () => {
    const result = await registry.execute('nonexistent', {})
    expect(result.isError).toBe(true)
  })

  it('execute calls the registered tool', async () => {
    const execute = vi.fn().mockResolvedValue({ content: 'ok' })
    registry.register({
      name: 'my_tool',
      description: '',
      inputSchema: { type: 'object', properties: {} },
      execute,
    })
    await registry.execute('my_tool', { x: 1 })
    expect(execute).toHaveBeenCalledWith({ x: 1 })
  })
})

describe('searchKnowledgeBaseTool (via singleton)', () => {
  // These tests use the singleton directly because searchKnowledgeBaseTool.execute()
  // references it internally for scope and result storage.
  let singleton: InstanceType<typeof ToolRegistryImpl>

  beforeEach(async () => {
    vi.clearAllMocks()
    const mod = await import('./toolRegistry')
    singleton = mod.toolRegistry
    singleton.reset()
    singleton.register(searchKnowledgeBaseTool)
  })

  it('collectResults deduplicates by chunk.id, sorts by bm25Score desc, caps at 20', async () => {
    const results = Array.from({ length: 25 }, (_, i) => makeResult(`chunk-${i}`, 25 - i))
    mockSearch.mockResolvedValue(results)
    singleton.setScope({ sourceIds: ['src1'], projects: [] })
    await singleton.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'test' })

    const collected = singleton.collectResults()
    expect(collected).toHaveLength(20)
    expect(collected[0].bm25Score).toBeGreaterThanOrEqual(collected[1].bm25Score ?? 0)
  })

  it('reset clears all collected results', async () => {
    mockSearch.mockResolvedValue([makeResult('x', 1)])
    singleton.setScope({ sourceIds: ['src1'], projects: [] })
    await singleton.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'q' })
    expect(singleton.collectResults()).toHaveLength(1)
    singleton.reset()
    expect(singleton.collectResults()).toHaveLength(0)
  })

  it('setScope filters search results by sourceId', async () => {
    mockSearch.mockResolvedValue([makeResult('a', 2, 'src1'), makeResult('b', 1, 'src2')])
    singleton.setScope({ sourceIds: ['src1'], projects: [] })
    await singleton.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'q' })
    const collected = singleton.collectResults()
    expect(collected).toHaveLength(1)
    expect(collected[0].chunk.id).toBe('a')
  })

  it('setScope filters by project when projects is non-empty', async () => {
    mockSearch.mockResolvedValue([
      makeResult('a', 2, 'src1', 'Hospital'),
      makeResult('b', 1, 'src1', 'Civic'),
    ])
    singleton.setScope({ sourceIds: ['src1'], projects: ['Hospital'] })
    await singleton.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'q' })
    const collected = singleton.collectResults()
    expect(collected).toHaveLength(1)
    expect(collected[0].chunk.id).toBe('a')
  })

  it('deduplicates chunk.id across multiple execute calls', async () => {
    const r = makeResult('dup', 3)
    mockSearch.mockResolvedValue([r])
    singleton.setScope({ sourceIds: ['src1'], projects: [] })
    await singleton.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'q1' })
    await singleton.execute(SEARCH_KNOWLEDGE_BASE_TOOL_NAME, { query: 'q2' })
    expect(singleton.collectResults()).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
cd "C:/code/Korda studio/korda-studio"
npx vitest run src/main/toolRegistry.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `Cannot find module './toolRegistry'`

- [ ] **Step 3: Create `toolRegistry.ts`**

```typescript
// src/main/toolRegistry.ts
import { retrievalService } from './retrievalService'
import type { AgentTool, AgentToolResult } from '../shared/contracts/agent-tool-contract'
import { SEARCH_KNOWLEDGE_BASE_TOOL_NAME } from '../shared/contracts/agent-tool-contract'
import type { AnthropicToolSchema } from '../shared/contracts/tool-registry-contract'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'

interface ScopeState {
  sourceIds: string[]
  projects: string[]
}

class ToolRegistryImpl {
  private readonly tools = new Map<string, AgentTool>()
  private readonly allResults = new Map<string, RetrievalResult>()
  private currentScope: ScopeState = { sourceIds: [], projects: [] }

  register(tool: AgentTool): void {
    this.tools.set(tool.name, tool)
  }

  async execute(name: string, input: Record<string, unknown>): Promise<AgentToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return { content: `Unknown tool: ${name}`, isError: true }
    }
    return tool.execute(input)
  }

  getSchemas(): AnthropicToolSchema[] {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema,
    }))
  }

  collectResults(): RetrievalResult[] {
    return Array.from(this.allResults.values())
      .sort((a, b) => (b.bm25Score ?? 0) - (a.bm25Score ?? 0))
      .slice(0, 20)
  }

  reset(): void {
    this.allResults.clear()
  }

  setScope(scope: ScopeState): void {
    this.currentScope = scope
  }

  getScope(): ScopeState {
    return this.currentScope
  }

  addResults(results: RetrievalResult[]): void {
    for (const r of results) {
      if (!this.allResults.has(r.chunk.id)) {
        this.allResults.set(r.chunk.id, r)
      }
    }
  }
}

export { ToolRegistryImpl }

export const toolRegistry = new ToolRegistryImpl()

export const searchKnowledgeBaseTool: AgentTool = {
  name: SEARCH_KNOWLEDGE_BASE_TOOL_NAME,
  description:
    'Search the engineering knowledge base for relevant documents, specifications, drawings, and reports.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'The search query to find relevant engineering documents',
      },
    },
    required: ['query'],
  },
  async execute(input: Record<string, unknown>): Promise<AgentToolResult> {
    const query = String(input['query'] ?? '')
    const scope = toolRegistry.getScope()

    const rawResults = await retrievalService.search({ query, limit: 50 })

    const scoped = rawResults.filter((r) => {
      if (scope.sourceIds.length > 0 && !scope.sourceIds.includes(r.file.sourceId ?? '')) {
        return false
      }
      if (
        scope.projects.length > 0 &&
        r.file.project !== null &&
        !scope.projects.includes(r.file.project)
      ) {
        return false
      }
      return true
    })

    toolRegistry.addResults(scoped)

    return {
      content: scoped.slice(0, 10).map((r) => ({
        id: r.chunk.id,
        text: r.chunk.text.slice(0, 500),
        fileName: r.file.name,
        score: r.bm25Score,
      })),
    }
  },
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/main/toolRegistry.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all 8 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/toolRegistry.ts src/main/toolRegistry.test.ts
git commit -m "feat(3b): add ToolRegistry implementation + searchKnowledgeBaseTool"
```

---

### Task 4: Add `runToolLoop()` to `AnthropicClient`

**Files:**

- Modify: `src/main/llmClient.ts`
- Modify: `src/main/llmClient.anthropic.test.ts`

- [ ] **Step 1: Write failing tests for `runToolLoop`**

Add these tests to `src/main/llmClient.anthropic.test.ts` (after the existing tests):

```typescript
// ---- runToolLoop tests ----
// Add to the top of the file, extend the vi.hoisted mock:
// The existing mock has: messages = { stream: hoistedMessagesStream }
// We need to add messages.create for the tool loop tests.
// Replace the vi.hoisted block with:

const { mockAnthropic, mockMessagesStream, mockMessagesCreate } = vi.hoisted(() => {
  const hoistedMessagesStream = vi.fn()
  const hoistedMessagesCreate = vi.fn()
  const hoistedAnthropic = vi.fn(
    class {
      messages = {
        stream: hoistedMessagesStream,
        create: hoistedMessagesCreate,
      }
    },
  )
  return {
    mockAnthropic: hoistedAnthropic,
    mockMessagesStream: hoistedMessagesStream,
    mockMessagesCreate: hoistedMessagesCreate,
  }
})
```

Then add a new `describe('runToolLoop')` block:

```typescript
describe('runToolLoop', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockTool = {
    name: 'search_knowledge_base',
    description: 'search',
    input_schema: {
      type: 'object' as const,
      properties: { query: { type: 'string' } },
      required: ['query'],
    },
  }

  it('resolves immediately when stop_reason is end_turn', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'done' }],
    })

    const client = new AnthropicClient(() => 'key')
    const executeTool = vi.fn()
    const onToolCall = vi.fn()

    await client.runToolLoop(
      [{ role: 'user', content: 'hello' }],
      'claude-haiku-4-5',
      'system',
      [mockTool],
      executeTool,
      onToolCall,
    )

    expect(mockMessagesCreate).toHaveBeenCalledTimes(1)
    expect(executeTool).not.toHaveBeenCalled()
  })

  it('executes tool and continues loop on tool_use', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          {
            type: 'tool_use',
            id: 'tool-1',
            name: 'search_knowledge_base',
            input: { query: 'test' },
          },
        ],
      })
      .mockResolvedValueOnce({
        stop_reason: 'end_turn',
        content: [{ type: 'text', text: 'answer' }],
      })

    const executeTool = vi.fn().mockResolvedValue({ content: [{ text: 'results' }] })
    const onToolCall = vi.fn()
    const client = new AnthropicClient(() => 'key')

    await client.runToolLoop(
      [{ role: 'user', content: 'hello' }],
      'claude-haiku-4-5',
      'system',
      [mockTool],
      executeTool,
      onToolCall,
    )

    expect(mockMessagesCreate).toHaveBeenCalledTimes(2)
    expect(executeTool).toHaveBeenCalledWith('search_knowledge_base', { query: 'test' })
    expect(onToolCall).toHaveBeenCalledWith('search_knowledge_base', { query: 'test' })
  })

  it('appends assistant turn ONCE per response (not per tool_use block)', async () => {
    mockMessagesCreate
      .mockResolvedValueOnce({
        stop_reason: 'tool_use',
        content: [
          { type: 'tool_use', id: 'tool-a', name: 'search_knowledge_base', input: { query: 'q1' } },
          { type: 'tool_use', id: 'tool-b', name: 'search_knowledge_base', input: { query: 'q2' } },
        ],
      })
      .mockResolvedValueOnce({ stop_reason: 'end_turn', content: [] })

    const executeTool = vi.fn().mockResolvedValue({ content: [] })
    const client = new AnthropicClient(() => 'key')

    await client.runToolLoop(
      [{ role: 'user', content: 'q' }],
      'claude-haiku-4-5',
      'sys',
      [mockTool],
      executeTool,
      vi.fn(),
    )

    // Second call should have: original user msg + assistant turn (once) + single user turn with 2 tool_results
    const secondCallMessages = mockMessagesCreate.mock.calls[1][0].messages
    // original user + assistant + user(tool_results)
    expect(secondCallMessages).toHaveLength(3)
    // The user turn at index 2 should have 2 tool_result blocks
    const toolResultTurn = secondCallMessages[2]
    expect(Array.isArray(toolResultTurn.content)).toBe(true)
    expect(toolResultTurn.content).toHaveLength(2)
    expect(toolResultTurn.content[0].tool_use_id).toBe('tool-a')
    expect(toolResultTurn.content[1].tool_use_id).toBe('tool-b')
  })

  it('stops after maxToolCalls', async () => {
    mockMessagesCreate.mockResolvedValue({
      stop_reason: 'tool_use',
      content: [
        { type: 'tool_use', id: 'x', name: 'search_knowledge_base', input: { query: 'q' } },
      ],
    })

    const executeTool = vi.fn().mockResolvedValue({ content: [] })
    const client = new AnthropicClient(() => 'key')

    await client.runToolLoop(
      [{ role: 'user', content: 'q' }],
      'claude-haiku-4-5',
      'sys',
      [mockTool],
      executeTool,
      vi.fn(),
      2, // maxToolCalls
    )

    expect(mockMessagesCreate).toHaveBeenCalledTimes(2)
  })

  it('streamWithTools no longer throws and returns a valid stub', () => {
    const client = new AnthropicClient(() => 'key')
    let result: unknown
    expect(() => {
      result = (
        client as unknown as { streamWithTools: (...a: unknown[]) => unknown }
      ).streamWithTools([], [], 'claude-sonnet-4-6', 'System')
    }).not.toThrow()
    expect(result).toHaveProperty('iterable')
    expect(result).toHaveProperty('abort')
    expect(result).toHaveProperty('finalMessage')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/main/llmClient.anthropic.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: FAIL — `client.runToolLoop is not a function` + `streamWithTools` test may fail.

- [ ] **Step 3: Implement `runToolLoop` and update `streamWithTools` in `llmClient.ts`**

Replace the full content of `src/main/llmClient.ts`:

```typescript
import Anthropic from '@anthropic-ai/sdk'
import type { AgentTool } from '../shared/contracts/agent-tool-contract'
import type { AgentToolResult } from '../shared/contracts/agent-tool-contract'
import type { LLMMessage, LLMProvider, LLMStreamResult } from '../shared/contracts/llm-provider'
import type { AnthropicToolSchema } from '../shared/contracts/tool-registry-contract'

export class AnthropicClient implements LLMProvider {
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

  /**
   * Multi-turn non-streaming tool use loop.
   * Pass tools + executeTool from toolRegistry — keeps the client decoupled from the registry.
   */
  async runToolLoop(
    initialMessages: LLMMessage[],
    model: string,
    systemPrompt: string,
    tools: AnthropicToolSchema[],
    executeTool: (name: string, input: Record<string, unknown>) => Promise<AgentToolResult>,
    onToolCall: (name: string, input: Record<string, unknown>) => void,
    maxToolCalls = 4,
    signal?: AbortSignal,
  ): Promise<void> {
    const apiKey = this.getApiKey().trim()
    if (!apiKey) {
      throw new Error('Anthropic API key is not configured')
    }

    const client = new Anthropic({ apiKey })

    // Build mutable messages array
    const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = initialMessages.map(
      (m) => ({ role: m.role, content: m.content }),
    )

    let toolCallCount = 0

    while (true) {
      // eslint-disable-next-line no-await-in-loop
      const response = await client.messages.create(
        {
          model,
          max_tokens: 1024,
          system: systemPrompt,
          tools: tools as Anthropic.Tool[],
          tool_choice: { type: 'auto' },
          messages: messages as Anthropic.MessageParam[],
        },
        { signal },
      )

      if (response.stop_reason === 'end_turn' || response.stop_reason === 'max_tokens') {
        break
      }

      if (response.stop_reason === 'tool_use') {
        // Append the assistant's turn ONCE (outside per-block loop)
        messages.push({ role: 'assistant', content: response.content })

        // Collect ALL tool_result blocks for this response turn
        const toolResults: Array<{
          type: 'tool_result'
          tool_use_id: string
          content: string
        }> = []

        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const input = block.input as Record<string, unknown>
            onToolCall(block.name, input)
            // eslint-disable-next-line no-await-in-loop
            const result = await executeTool(block.name, input)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id, // required — omitting causes 400
              content: JSON.stringify(result.content),
            })
          }
        }

        // Append ALL tool_results in a single user turn
        messages.push({ role: 'user', content: toolResults })

        toolCallCount++
        if (toolCallCount >= maxToolCalls) break
      } else {
        // Unknown stop reason — break to avoid infinite loop
        break
      }
    }
  }

  streamWithTools(
    _messages: LLMMessage[],
    _tools: AgentTool[],
    _model: string,
    _systemPrompt: string,
  ): ReturnType<LLMProvider['streamWithTools']> {
    // Phase 3B: use runToolLoop() directly via groundedChatService.
    // This stub satisfies the interface contract without throwing.
    const emptyIterable: AsyncIterable<string> = {
      [Symbol.asyncIterator]: async function* () {
        /* no-op */
      },
    }
    return {
      iterable: emptyIterable,
      abort: () => {
        /* no-op */
      },
      finalMessage: async () => ({ inputTokens: 0, outputTokens: 0 }),
      onToolCall: () => {
        /* no-op */
      },
    }
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/main/llmClient.anthropic.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS (including old stream tests + new runToolLoop tests).

- [ ] **Step 5: Commit**

```bash
git add src/main/llmClient.ts src/main/llmClient.anthropic.test.ts
git commit -m "feat(3b): implement runToolLoop() on AnthropicClient with multi-turn tool use"
```

---

## Chunk 3: groundedChatService

### Task 5: Create `groundedChatService.ts` + `groundedChatService.test.ts`

**Files:**

- Create: `src/main/groundedChatService.ts`
- Create: `src/main/groundedChatService.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// src/main/groundedChatService.test.ts
// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'
import { IPC_CHANNELS } from '../shared/ipc-types'

// --- Mocks ---
const mockMessagesCreate = vi.fn()
const mockMessagesStream = vi.fn()

vi.mock('@anthropic-ai/sdk', () => ({
  default: vi.fn(
    class {
      messages = { create: mockMessagesCreate, stream: mockMessagesStream }
    },
  ),
}))

const mockRunToolLoop = vi.fn()
vi.mock('./llmClient', () => ({
  AnthropicClient: vi.fn(
    class {
      runToolLoop = mockRunToolLoop
    },
  ),
}))

const mockCollectResults = vi.fn()
vi.mock('./toolRegistry', () => ({
  toolRegistry: {
    reset: vi.fn(),
    setScope: vi.fn(),
    collectResults: mockCollectResults,
  },
}))

import { rewriteQuery, runGroundedPipeline } from './groundedChatService'

function makeResult(id: string, score = 1): RetrievalResult {
  return {
    chunk: {
      id,
      fileId: 1,
      sourceId: 'src1',
      chunkIndex: 0,
      text: `chunk text ${id}`,
      tokenCount: 10,
      charCount: 50,
      pageNumber: 1,
      sectionTitle: 'Section A',
      sheetName: null,
      embedding: null,
      createdAt: Date.now(),
    },
    file: {
      path: `/docs/${id}.pdf`,
      name: `${id}.pdf`,
      ext: '.pdf',
      sizeBytes: 1000,
      modifiedMs: Date.now(),
      isDir: false,
      sourceId: 'src1',
      project: 'HospitalExpansion',
      discipline: null,
      docType: null,
      drawingNumber: null,
      revision: null,
      issueStatus: null,
    },
    bm25Score: score,
    vectorDistance: null,
    rrfScore: null,
    highlight: `hl ${id}`,
  }
}

function makeMockWin() {
  const send = vi.fn()
  return { webContents: { send } } as unknown as BrowserWindow
}

const baseParams = {
  conversationId: 'conv-1',
  userContent: 'What is the fire rating for the corridor?',
  model: 'claude-sonnet-4-6',
  scopeSourceIds: ['src1'],
  projectFilters: [],
  assistantMessageId: 'asst-1',
  conversationMessages: [{ role: 'user' as const, content: 'What is the fire rating?' }],
  getApiKey: () => 'test-key',
  getAIConfig: () => ({
    provider: 'anthropic' as const,
    defaultModel: 'claude-sonnet-4-6',
    firmContext: 'Engineering firm',
  }),
  getPreferences: () => ({ firmName: 'TestFirm', disciplines: 'Structural' }),
}

describe('rewriteQuery', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns parsed queries from Haiku response', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '["fire rating corridor", "IBC corridor requirements"]' }],
    })
    const result = await rewriteQuery('corridor fire rating', 'test-key')
    expect(result).toEqual(['fire rating corridor', 'IBC corridor requirements'])
  })

  it('falls back to original question on parse error', async () => {
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'not valid json' }],
    })
    const result = await rewriteQuery('my question', 'test-key')
    expect(result).toEqual(['my question'])
  })

  it('falls back to original question on API error', async () => {
    mockMessagesCreate.mockRejectedValue(new Error('rate limit'))
    const result = await rewriteQuery('my question', 'test-key')
    expect(result).toEqual(['my question'])
  })
})

describe('runGroundedPipeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRunToolLoop.mockResolvedValue(undefined)
  })

  it('graceful fallback: zero results → mode=grounded_fallback, emits chat:token warning', async () => {
    mockCollectResults.mockReturnValue([])
    // Mock query rewrite
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '["query1"]' }],
    })

    // Mock plain stream fallback
    const mockStream = {
      abort: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({ usage: { input_tokens: 5, output_tokens: 10 } }),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'fallback answer' },
        }
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 10 },
        }
      },
    }
    mockMessagesStream.mockReturnValue(mockStream)

    const win = makeMockWin()
    const result = await runGroundedPipeline({ ...baseParams, win })

    expect(result.mode).toBe('grounded_fallback')
    // Amber warning was emitted
    const tokenCalls = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([ch]) => ch === IPC_CHANNELS.CHAT_TOKEN,
    )
    expect(tokenCalls[0][1]).toMatch(/No matching documents/)
  })

  it('grounded path: emits chat:citation events and returns mode=grounded', async () => {
    const results = [makeResult('chunk-a', 2), makeResult('chunk-b', 1)]
    mockCollectResults.mockReturnValue(results)
    mockMessagesCreate.mockResolvedValue({
      content: [{ type: 'text', text: '["fire corridor"]' }],
    })

    // Mock Pass 2 citations stream
    const mockCitStream = {
      abort: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'The corridor [1] requires' },
        }
        yield {
          type: 'content_block_delta',
          delta: {
            type: 'citations_delta',
            citation: {
              type: 'char_location',
              document_index: 0,
              cited_text: 'corridor assemblies shall achieve 2 hours',
              start_char_index: 0,
              end_char_index: 40,
            },
          },
        }
        yield { type: 'content_block_delta', delta: { type: 'text_delta', text: ' 2 hours.' } }
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: '\n<!--evidence:supported-->' },
        }
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 50 },
        }
      },
    }
    mockMessagesStream.mockReturnValue(mockCitStream)

    const win = makeMockWin()
    const result = await runGroundedPipeline({ ...baseParams, win })

    expect(result.mode).toBe('grounded')
    expect(result.evidenceStatus).toBe('supported')
    // Evidence marker stripped from persisted content
    expect(result.content).not.toMatch(/<!--evidence/)
    // Citations populated
    expect(result.citations).toHaveLength(1)
    expect(result.citations[0].excerpt).toBe('corridor assemblies shall achieve 2 hours')
    // chat:citation IPC fired
    const citCalls = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([ch]) => ch === IPC_CHANNELS.CHAT_CITATION,
    )
    expect(citCalls).toHaveLength(1)
    // chat:grounded-done IPC fired
    const doneCalls = (win.webContents.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([ch]) => ch === IPC_CHANNELS.CHAT_GROUNDED_DONE,
    )
    expect(doneCalls).toHaveLength(1)
    expect(doneCalls[0][1].evidenceStatus).toBe('supported')
  })

  it('defaults evidenceStatus to partial when marker not found', async () => {
    mockCollectResults.mockReturnValue([makeResult('x', 1)])
    mockMessagesCreate.mockResolvedValue({ content: [{ type: 'text', text: '["q"]' }] })

    const mockCitStream = {
      abort: vi.fn(),
      finalMessage: vi.fn().mockResolvedValue({ usage: { input_tokens: 10, output_tokens: 5 } }),
      async *[Symbol.asyncIterator]() {
        yield {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: 'answer without marker' },
        }
        yield {
          type: 'message_delta',
          delta: { stop_reason: 'end_turn' },
          usage: { output_tokens: 5 },
        }
      },
    }
    mockMessagesStream.mockReturnValue(mockCitStream)

    const win = makeMockWin()
    const result = await runGroundedPipeline({ ...baseParams, win })
    expect(result.evidenceStatus).toBe('partial')
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
npx vitest run src/main/groundedChatService.test.ts --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 3: Create `groundedChatService.ts`**

```typescript
// src/main/groundedChatService.ts
import Anthropic from '@anthropic-ai/sdk'
import type { BrowserWindow } from 'electron'
import type {
  Citation,
  EvidenceStatus,
  GroundedAnswer,
} from '../shared/contracts/citation-contract'
import type { ChunkRecord } from '../shared/contracts/chunk-record'
import type { RetrievalResult } from '../shared/contracts/retrieval-contract'
import type { FileEntry, GroundedDonePayload } from '../shared/ipc-types'
import { IPC_CHANNELS } from '../shared/ipc-types'
import { AnthropicClient } from './llmClient'
import { toolRegistry } from './toolRegistry'

const QUERY_REWRITE_MODEL = 'claude-haiku-4-5'
const TOOL_LOOP_MODEL = 'claude-haiku-4-5'
const MAX_TOOL_CALLS = 4

export interface AIConfigSnapshot {
  provider: 'anthropic'
  defaultModel: string
  firmContext: string
}

export interface PreferencesSnapshot {
  firmName: string
  disciplines: string
}

export interface GroundedPipelineParams {
  conversationId: string
  userContent: string
  model: string
  scopeSourceIds: string[]
  projectFilters: string[]
  win: BrowserWindow
  assistantMessageId: string
  conversationMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  getApiKey: () => string
  getAIConfig: () => AIConfigSnapshot
  getPreferences: () => PreferencesSnapshot
  abortSignal?: AbortSignal
}

export interface GroundedPipelineResult {
  mode: 'grounded' | 'grounded_fallback'
  content: string
  citations: Citation[]
  evidenceStatus: EvidenceStatus
  citationsJson: string | null
  groundedChunkCount: number
  inputTokens: number
  outputTokens: number
}

const EVIDENCE_MARKER_RE = /\n?<!--evidence:(supported|partial|unsupported)-->$/

export async function rewriteQuery(userContent: string, apiKey: string): Promise<string[]> {
  try {
    const client = new Anthropic({ apiKey })
    const response = await client.messages.create({
      model: QUERY_REWRITE_MODEL,
      max_tokens: 256,
      system:
        'You are a search query optimizer for an engineering document retrieval system. ' +
        'Given a question, produce 2-3 specific search queries that will find relevant ' +
        'engineering documents. Use precise technical terminology. Return ONLY a JSON ' +
        'array of strings: ["query1", "query2", "query3"]. No explanation.',
      messages: [{ role: 'user', content: userContent }],
    })
    const textBlock = response.content.find((b) => b.type === 'text')
    const text = textBlock && textBlock.type === 'text' ? textBlock.text : ''
    const parsed = JSON.parse(text) as string[]
    if (Array.isArray(parsed) && parsed.length > 0) return parsed
    return [userContent]
  } catch {
    return [userContent]
  }
}

function buildDocTitle(chunk: ChunkRecord, file: FileEntry): string {
  let title = file.name
  if (chunk.sectionTitle) title += ` — ${chunk.sectionTitle}`
  if (chunk.pageNumber) title += ` (p.${chunk.pageNumber})`
  if (chunk.sheetName) title += ` [${chunk.sheetName}]`
  return title
}

function buildSearchSystemPrompt(): string {
  return (
    'You are an engineering search assistant. Use the search_knowledge_base tool to find ' +
    'relevant documents for the question. Perform 2-3 searches using different query angles ' +
    'to ensure comprehensive coverage. Do not answer the question — your role is only to ' +
    'find relevant documents.'
  )
}

function buildAnswerSystemPrompt(
  getAIConfig: () => AIConfigSnapshot,
  getPreferences: () => PreferencesSnapshot,
): string {
  const { firmName, disciplines } = getPreferences()
  // Replace {disciplines} placeholder that may appear in firmContext template
  const firmContext = getAIConfig().firmContext.replaceAll('{disciplines}', disciplines)
  return (
    `You are an engineering assistant for ${firmName}. Answer the question based ONLY on ` +
    `the provided documents. Be precise and cite sources.\n\n${firmContext}\n\nAt the very ` +
    `end of your answer (after all prose), on its own line, append exactly one of:\n` +
    `<!--evidence:supported-->\n<!--evidence:partial-->\n<!--evidence:unsupported-->`
  )
}

export async function runGroundedPipeline(
  params: GroundedPipelineParams,
): Promise<GroundedPipelineResult> {
  const {
    userContent,
    model,
    scopeSourceIds,
    projectFilters,
    win,
    assistantMessageId,
    conversationMessages,
    getApiKey,
    getAIConfig,
    getPreferences,
    abortSignal,
  } = params

  const apiKey = getApiKey().trim()
  const anthropicClient = new AnthropicClient(getApiKey)

  // Emit initial searching signal
  win.webContents.send(IPC_CHANNELS.CHAT_SEARCHING, assistantMessageId)

  // 1. Query rewriting
  const rewrittenQueries = await rewriteQuery(userContent, apiKey)

  // 2. Tool loop setup
  toolRegistry.reset()
  toolRegistry.setScope({ sourceIds: scopeSourceIds, projects: projectFilters })

  const onToolCall = (_name: string, _input: Record<string, unknown>) => {
    win.webContents.send(IPC_CHANNELS.CHAT_SEARCHING, assistantMessageId)
  }

  // Build messages for Pass 1 — include rewritten queries as a preamble
  const pass1Messages = [
    ...conversationMessages.slice(0, -1), // conversation history minus last user msg
    {
      role: 'user' as const,
      content: `${userContent}\n\nSearch queries to use: ${rewrittenQueries.join(', ')}`,
    },
  ]

  await anthropicClient.runToolLoop(
    pass1Messages,
    TOOL_LOOP_MODEL,
    buildSearchSystemPrompt(),
    toolRegistry.getSchemas(),
    (name, input) => toolRegistry.execute(name, input),
    onToolCall,
    MAX_TOOL_CALLS,
    abortSignal,
  )

  const results = toolRegistry.collectResults()

  // 3. Graceful fallback
  if (results.length === 0) {
    const warningPrefix =
      '⚠ No matching documents found in selected scope — answering from general knowledge\n\n'
    win.webContents.send(IPC_CHANNELS.CHAT_TOKEN, warningPrefix)

    const fallbackClient = new Anthropic({ apiKey })
    const fallbackStream = fallbackClient.messages.stream({
      model,
      max_tokens: 4096,
      system: buildAnswerSystemPrompt(getAIConfig, getPreferences),
      messages: conversationMessages as Anthropic.MessageParam[],
    })

    let fallbackContent = warningPrefix
    let fallbackInput = 0
    let fallbackOutput = 0

    for await (const event of fallbackStream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        fallbackContent += event.delta.text
        win.webContents.send(IPC_CHANNELS.CHAT_TOKEN, event.delta.text)
      }
    }

    const finalMsg = await fallbackStream.finalMessage()
    fallbackInput = finalMsg.usage.input_tokens
    fallbackOutput = finalMsg.usage.output_tokens

    const payload: GroundedDonePayload = {
      messageId: assistantMessageId,
      citations: [],
      evidenceStatus: 'unsupported',
      inputTokens: fallbackInput,
      outputTokens: fallbackOutput,
      chunkCount: 0,
      finalText: fallbackContent,
    }
    win.webContents.send(IPC_CHANNELS.CHAT_GROUNDED_DONE, payload)

    return {
      mode: 'grounded_fallback',
      content: fallbackContent,
      citations: [],
      evidenceStatus: 'unsupported',
      citationsJson: null,
      groundedChunkCount: 0,
      inputTokens: fallbackInput,
      outputTokens: fallbackOutput,
    }
  }

  // 4. Pass 2 — Citations API streaming answer
  const citationsContent = results.map((r) => ({
    type: 'document' as const,
    source: {
      type: 'text' as const,
      media_type: 'text/plain' as const,
      data: r.chunk.text,
    },
    title: buildDocTitle(r.chunk, r.file),
    citations: { enabled: true },
    cache_control: { type: 'ephemeral' as const },
  }))

  const pass2Client = new Anthropic({ apiKey })
  const pass2Stream = pass2Client.messages.stream({
    model,
    max_tokens: 4096,
    system: [
      {
        type: 'text',
        text: buildAnswerSystemPrompt(getAIConfig, getPreferences),
        cache_control: { type: 'ephemeral' },
      },
    ] as Anthropic.TextBlockParam[],
    messages: [
      {
        role: 'user',
        content: [
          ...citationsContent,
          { type: 'text', text: userContent },
        ] as Anthropic.ContentBlockParam[],
      },
    ],
  })

  let fullText = ''
  const citations: Citation[] = []
  let citationIndex = 1

  for await (const event of pass2Stream) {
    if (event.type === 'content_block_delta') {
      const delta = event.delta as {
        type: string
        text?: string
        citation?: {
          type: string
          document_index: number
          cited_text: string
        }
      }

      if (delta.type === 'text_delta' && delta.text) {
        fullText += delta.text
        win.webContents.send(IPC_CHANNELS.CHAT_TOKEN, delta.text)
      } else if (delta.type === 'citations_delta' && delta.citation) {
        const { document_index, cited_text } = delta.citation
        const result = results[document_index]
        if (result) {
          const citation: Citation = {
            citationIndex,
            fileId: result.chunk.fileId,
            filePath: result.file.path,
            fileName: result.file.name,
            chunkId: result.chunk.id,
            excerpt: cited_text,
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
          citationIndex++
        }
      }
    }
  }

  const finalMsg = await pass2Stream.finalMessage()
  const inputTokens = finalMsg.usage.input_tokens
  const outputTokens = finalMsg.usage.output_tokens

  // 5. Extract evidence marker from end of fullText
  const markerMatch = EVIDENCE_MARKER_RE.exec(fullText)
  let evidenceStatus: EvidenceStatus = 'partial'
  let strippedText = fullText

  if (markerMatch) {
    evidenceStatus = markerMatch[1] as EvidenceStatus
    strippedText = fullText.slice(0, fullText.length - markerMatch[0].length)
  }

  const groundedAnswer: GroundedAnswer = {
    text: strippedText,
    citations,
    evidenceStatus,
    retrievedChunkCount: results.length,
    searchQueriesUsed: rewrittenQueries,
  }

  const payload: GroundedDonePayload = {
    messageId: assistantMessageId,
    citations,
    evidenceStatus,
    inputTokens,
    outputTokens,
    chunkCount: results.length,
    finalText: strippedText,
  }
  win.webContents.send(IPC_CHANNELS.CHAT_GROUNDED_DONE, payload)

  return {
    mode: 'grounded',
    content: strippedText,
    citations,
    evidenceStatus,
    citationsJson: JSON.stringify(groundedAnswer),
    groundedChunkCount: results.length,
    inputTokens,
    outputTokens,
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/main/groundedChatService.test.ts --reporter=verbose 2>&1 | tail -30
```

Expected: all 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/groundedChatService.ts src/main/groundedChatService.test.ts
git commit -m "feat(3b): add groundedChatService with two-pass pipeline + query rewriting"
```

---

## Chunk 4: Backend Wiring

### Task 6: Update `chatService.ts` — schema migration + `sendGrounded()`

**Files:**

- Modify: `src/main/chatService.ts`

- [ ] **Step 1: Add schema migration inside `init()` after `db.exec(SCHEMA_SQL)`**

In `chatService.ts`, after the line `db.exec(SCHEMA_SQL)`, add the migration block:

```typescript
// Phase 3B migration — each ALTER is idempotent (SQLite throws if column exists)
try {
  db.exec(`ALTER TABLE messages ADD COLUMN mode TEXT NOT NULL DEFAULT 'plain'`)
} catch {
  /* already exists */
}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN citations TEXT`)
} catch {
  /* already exists */
}
try {
  db.exec(`ALTER TABLE messages ADD COLUMN grounded_chunk_count INTEGER`)
} catch {
  /* already exists */
}
```

- [ ] **Step 2: Update `MessageRow` interface to include new columns**

Add to the `MessageRow` interface:

```typescript
mode: string
citations: string | null
groundedChunkCount: number | null
```

- [ ] **Step 3: Update `mapMessage()` to map new fields**

Replace the `mapMessage` function:

```typescript
function mapMessage(row: MessageRow): ChatMessage {
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
    citations: row.citations ? (JSON.parse(row.citations) as GroundedAnswer).citations : undefined,
    evidenceStatus: row.citations
      ? (JSON.parse(row.citations) as GroundedAnswer).evidenceStatus
      : undefined,
    groundedChunkCount: row.groundedChunkCount ?? undefined,
  }
}
```

Add the necessary imports at the top of chatService.ts:

```typescript
import type { ChatMessage } from '../shared/ipc-types'
import type { GroundedAnswer } from '../shared/contracts/citation-contract'
import { runGroundedPipeline } from './groundedChatService'
import type { GroundedPipelineParams } from './groundedChatService'
```

- [ ] **Step 4: Update `stmtGetConversationMessages` SELECT to include new columns**

In the `init()` prepared statement for `stmtGetConversationMessages`, update the SELECT:

```sql
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
```

- [ ] **Step 5: Update `stmtInsertMessage` to include new columns**

Update the INSERT statement in `init()`:

```sql
INSERT INTO messages (
  id, conversation_id, role, content, created_at, model,
  input_tokens, output_tokens, mode, citations, grounded_chunk_count
) VALUES (
  @id, @conversationId, @role, @content, @createdAt, @model,
  @inputTokens, @outputTokens, @mode, @citations, @groundedChunkCount
)
```

- [ ] **Step 6: Update all existing `stmtInsertMessage.run()` calls to include the new fields**

In the `send()` method, update the user message insert:

```typescript
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
```

In `runStream()`, update the assistant message insert:

```typescript
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
```

- [ ] **Step 7: Add `activeGroundedController` + update `stop()` + add `sendGrounded()`**

Add the module-level variable after `activeStream`:

```typescript
let activeGroundedController: AbortController | null = null
```

Update `stop()`:

```typescript
  stop(): void {
    activeStream?.abort()
    activeGroundedController?.abort()
    activeGroundedController = null
  },
```

Add `sendGrounded()` to the `chatService` object (after the existing `send()` method):

```typescript
  sendGrounded(
    conversationId: string,
    userContent: string,
    model: string,
    scopeSourceIds: string[],
    projectFilters: string[],
  ): { messageId: string } {
    requireDb()

    const now = Date.now()
    const assistantMessageId = randomUUID()
    const userMessageId = randomUUID()
    const existingUserMessages = stmtCountUserMessages.get(conversationId) as { count: number }

    // Insert user message
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
      stmtUpdateConversationModel.run({ id: conversationId, model, updatedAt: now })
    }

    // Load conversation history for Pass 1 (includes just-inserted user message)
    const conversationMessages = (stmtGetConversationMessages.all(conversationId) as MessageRow[]).map(
      (row) => ({ role: row.role as 'user' | 'assistant', content: row.content }),
    )

    // Abort controller for cancellation via chat:stop
    const controller = new AbortController()
    activeGroundedController = controller

    void runGroundedPipeline({
      conversationId,
      userContent,
      model,
      scopeSourceIds,
      projectFilters,
      win: mainWin!,
      assistantMessageId,
      conversationMessages,
      getApiKey: getApiKeyRef,
      getAIConfig: getAIConfigRef,
      getPreferences: getPreferencesRef,
      abortSignal: controller.signal,
    } as GroundedPipelineParams)
      .then((result) => {
        const now2 = Date.now()
        stmtInsertMessage.run({
          id: assistantMessageId,
          conversationId,
          role: 'assistant',
          content: result.content,
          createdAt: now2,
          model,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          mode: result.mode,
          citations: result.citationsJson,
          groundedChunkCount: result.groundedChunkCount,
        })
        stmtUpdateConversationModel.run({ id: conversationId, model, updatedAt: now2 })
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
```

- [ ] **Step 8: Run existing chatService tests**

```bash
npx vitest run src/main/chatService.test.ts --reporter=verbose 2>&1 | tail -20
```

Expected: all existing tests PASS.

- [ ] **Step 9: Commit**

```bash
git add src/main/chatService.ts
git commit -m "feat(3b): chatService schema migration + sendGrounded() method"
```

---

### Task 7: Wire `main.ts` — toolRegistry registration + IPC handler

**Files:**

- Modify: `src/main/main.ts`

- [ ] **Step 1: Add imports**

At the top of `main.ts`, add:

```typescript
import { toolRegistry, searchKnowledgeBaseTool } from './toolRegistry'
import type { GroundedSendParams } from '../shared/ipc-types'
```

- [ ] **Step 2: Register `searchKnowledgeBaseTool` on startup**

Find the `app.whenReady()` block (or wherever `chatService.init()` is called) and add after the `chatService.init(...)` call:

```typescript
toolRegistry.register(searchKnowledgeBaseTool)
```

- [ ] **Step 3: Add the `chat:send-grounded` IPC handler**

Add after the existing `ipcMain.handle(IPC_CHANNELS.CHAT_SEND, ...)` handler:

```typescript
ipcMain.handle(IPC_CHANNELS.CHAT_SEND_GROUNDED, (_event, params: GroundedSendParams) => {
  return chatService.sendGrounded(
    params.conversationId,
    params.content,
    params.model,
    params.scopeSourceIds,
    params.projectFilters,
  )
})
```

- [ ] **Step 4: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -30
```

- [ ] **Step 5: Commit**

```bash
git add src/main/main.ts
git commit -m "feat(3b): register searchKnowledgeBaseTool + chat:send-grounded IPC handler"
```

---

### Task 8: Add bridges to `preload.ts`

**Files:**

- Modify: `src/preload/preload.ts`

- [ ] **Step 1: Add imports for new types**

Update the import at the top:

```typescript
import type {
  IngestionProgressEvent,
  RetrievalParams,
  SendParams,
  GroundedSendParams,
  GroundedDonePayload,
  WindowState,
  Citation,
} from '../shared/ipc-types'
```

- [ ] **Step 2: Add 4 new bridge functions to the `contextBridge.exposeInMainWorld` call**

Add after the `onChatError` bridge:

```typescript
  chatSendGrounded: (params: GroundedSendParams) =>
    ipcRenderer.invoke(IPC_CHANNELS.CHAT_SEND_GROUNDED, params),
  onChatSearching: (cb: (messageId: string) => void) => {
    const handler = (_: Electron.IpcRendererEvent, messageId: string) => cb(messageId)
    ipcRenderer.on(IPC_CHANNELS.CHAT_SEARCHING, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_SEARCHING, handler)
  },
  onChatCitation: (
    cb: (payload: { messageId: string; index: number; citation: Citation }) => void,
  ) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      payload: { messageId: string; index: number; citation: Citation },
    ) => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.CHAT_CITATION, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_CITATION, handler)
  },
  onChatGroundedDone: (cb: (payload: GroundedDonePayload) => void) => {
    const handler = (_: Electron.IpcRendererEvent, payload: GroundedDonePayload) => cb(payload)
    ipcRenderer.on(IPC_CHANNELS.CHAT_GROUNDED_DONE, handler)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.CHAT_GROUNDED_DONE, handler)
  },
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Run all main-process tests to confirm nothing is broken**

```bash
npx vitest run src/main/ --reporter=verbose 2>&1 | tail -30
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/preload/preload.ts
git commit -m "feat(3b): add preload bridges for grounded chat IPC channels"
```

---

## Chunk 5: UI Components

### Task 9: Create `ScopeSelector.tsx` + `ScopeSelector.test.tsx`

**Files:**

- Create: `src/renderer/modules/chat/components/ScopeSelector.tsx`
- Create: `src/renderer/modules/chat/components/ScopeSelector.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/renderer/modules/chat/components/ScopeSelector.test.tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScopeSelector } from './ScopeSelector'

const mockSources = [
  { id: 'src1', name: 'Engineering Shares', type: 'local' as const, rootPath: '/eng', status: 'ok' as const },
  { id: 'src2', name: 'Project Files', type: 'local' as const, rootPath: '/proj', status: 'ok' as const },
]
const mockProjects = ['Hospital Expansion', 'Civic Centre']

beforeEach(() => {
  vi.stubGlobal('kordaAPI', {
    fileIndexSourcesList: vi.fn().mockResolvedValue(mockSources),
    fileIndexProjectsList: vi.fn().mockResolvedValue(mockProjects),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('ScopeSelector', () => {
  it('renders scope button', () => {
    render(
      <ScopeSelector
        selectedSourceIds={[]}
        selectedProjects={[]}
        onSourcesChange={vi.fn()}
        onProjectsChange={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: /scope/i })).toBeInTheDocument()
  })

  it('shows teal dot when sources are selected', () => {
    render(
      <ScopeSelector
        selectedSourceIds={['src1']}
        selectedProjects={[]}
        onSourcesChange={vi.fn()}
        onProjectsChange={vi.fn()}
      />,
    )
    expect(screen.getByTestId('scope-active-dot')).toBeInTheDocument()
  })

  it('opens popover on click and loads sources', async () => {
    render(
      <ScopeSelector
        selectedSourceIds={[]}
        selectedProjects={[]}
        onSourcesChange={vi.fn()}
        onProjectsChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /scope/i }))
    await waitFor(() => {
      expect(screen.getByText('Engineering Shares')).toBeInTheDocument()
      expect(screen.getByText('Project Files')).toBeInTheDocument()
    })
  })

  it('calls onSourcesChange when a source checkbox is toggled', async () => {
    const onSourcesChange = vi.fn()
    render(
      <ScopeSelector
        selectedSourceIds={[]}
        selectedProjects={[]}
        onSourcesChange={onSourcesChange}
        onProjectsChange={vi.fn()}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /scope/i }))
    await waitFor(() => screen.getByText('Engineering Shares'))
    fireEvent.click(screen.getByLabelText('Engineering Shares'))
    expect(onSourcesChange).toHaveBeenCalledWith(['src1'])
  })

  it('clears all selections on clear button', async () => {
    const onSourcesChange = vi.fn()
    const onProjectsChange = vi.fn()
    render(
      <ScopeSelector
        selectedSourceIds={['src1']}
        selectedProjects={['Hospital Expansion']}
        onSourcesChange={onSourcesChange}
        onProjectsChange={onProjectsChange}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: /scope/i }))
    await waitFor(() => screen.getByRole('button', { name: /clear scope/i }))
    fireEvent.click(screen.getByRole('button', { name: /clear scope/i }))
    expect(onSourcesChange).toHaveBeenCalledWith([])
    expect(onProjectsChange).toHaveBeenCalledWith([])
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```bash
npx vitest run src/renderer/modules/chat/components/ScopeSelector.test.tsx --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 3: Create `ScopeSelector.tsx`**

```typescript
// src/renderer/modules/chat/components/ScopeSelector.tsx
import { useEffect, useRef, useState } from 'react'
import { Search } from 'lucide-react'
import type { FileSource } from '../../../../shared/file-sources'

interface ScopeSelectorProps {
  selectedSourceIds: string[]
  selectedProjects: string[]
  onSourcesChange: (ids: string[]) => void
  onProjectsChange: (projects: string[]) => void
}

export function ScopeSelector({
  selectedSourceIds,
  selectedProjects,
  onSourcesChange,
  onProjectsChange,
}: ScopeSelectorProps) {
  const [open, setOpen] = useState(false)
  const [sources, setSources] = useState<FileSource[]>([])
  const [projects, setProjects] = useState<string[]>([])
  const popoverRef = useRef<HTMLDivElement>(null)
  const isActive = selectedSourceIds.length > 0

  useEffect(() => {
    if (!open) return
    void window.kordaAPI.fileIndexSourcesList().then(setSources)
    void window.kordaAPI.fileIndexProjectsList().then(setProjects)
  }, [open])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const toggleSource = (id: string) => {
    onSourcesChange(
      selectedSourceIds.includes(id)
        ? selectedSourceIds.filter((s) => s !== id)
        : [...selectedSourceIds, id],
    )
  }

  const toggleProject = (p: string) => {
    onProjectsChange(
      selectedProjects.includes(p)
        ? selectedProjects.filter((s) => s !== p)
        : [...selectedProjects, p],
    )
  }

  const clearAll = () => {
    onSourcesChange([])
    onProjectsChange([])
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-label="Scope selector"
        onClick={() => setOpen((v) => !v)}
        className={`relative inline-flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs transition-colors ${
          isActive
            ? 'border-teal-500/50 bg-teal-500/10 text-teal-300'
            : 'border-border bg-surface-base text-text-secondary hover:border-accent hover:text-text-primary'
        }`}
      >
        <Search size={12} />
        <span>Scope</span>
        {isActive && (
          <span
            data-testid="scope-active-dot"
            className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-teal-400"
          />
        )}
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-xl border border-border bg-surface-raised shadow-xl"
        >
          <div className="p-3">
            <p className="mb-2 text-[11px] font-medium uppercase tracking-widest text-text-secondary">
              Sources
            </p>
            {sources.map((src) => (
              <label
                key={src.id}
                className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-text-primary hover:bg-white/5"
              >
                <input
                  type="checkbox"
                  aria-label={src.name}
                  checked={selectedSourceIds.includes(src.id)}
                  onChange={() => toggleSource(src.id)}
                  className="accent-teal-400"
                />
                {src.name}
              </label>
            ))}

            {projects.length > 0 && (
              <>
                <p className="mb-2 mt-3 text-[11px] font-medium uppercase tracking-widest text-text-secondary">
                  Projects
                </p>
                {projects.map((p) => (
                  <label
                    key={p}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm text-text-primary hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      aria-label={p}
                      checked={selectedProjects.includes(p)}
                      onChange={() => toggleProject(p)}
                      className="accent-teal-400"
                    />
                    {p}
                  </label>
                ))}
              </>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              <button
                type="button"
                aria-label="Clear scope"
                onClick={clearAll}
                className="text-xs text-text-secondary underline hover:text-text-primary"
              >
                Clear scope
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded bg-teal-600 px-2 py-1 text-xs font-medium text-white hover:bg-teal-500"
              >
                Search these ▶
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/renderer/modules/chat/components/ScopeSelector.test.tsx --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/chat/components/ScopeSelector.tsx src/renderer/modules/chat/components/ScopeSelector.test.tsx
git commit -m "feat(3b): add ScopeSelector component with source+project filtering"
```

---

### Task 10: Create `CitationMarker.tsx` + `CitationMarker.test.tsx`

**Files:**

- Create: `src/renderer/modules/chat/components/CitationMarker.tsx`
- Create: `src/renderer/modules/chat/components/CitationMarker.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/renderer/modules/chat/components/CitationMarker.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import { CitationMarker } from './CitationMarker'

describe('CitationMarker', () => {
  it('renders [N] superscript', () => {
    render(<CitationMarker index={3} onCitationClick={vi.fn()} />)
    expect(screen.getByText('[3]')).toBeInTheDocument()
  })

  it('calls onCitationClick with index when clicked', () => {
    const onCitationClick = vi.fn()
    render(<CitationMarker index={2} onCitationClick={onCitationClick} />)
    fireEvent.click(screen.getByText('[2]'))
    expect(onCitationClick).toHaveBeenCalledWith(2)
  })
})
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
npx vitest run src/renderer/modules/chat/components/CitationMarker.test.tsx --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 3: Create `CitationMarker.tsx`**

```typescript
// src/renderer/modules/chat/components/CitationMarker.tsx
interface CitationMarkerProps {
  index: number
  onCitationClick: (index: number) => void
}

export function CitationMarker({ index, onCitationClick }: CitationMarkerProps) {
  return (
    <sup
      className="citation-marker cursor-pointer text-[10px] font-medium text-teal-400 hover:underline"
      onClick={() => onCitationClick(index)}
    >
      [{index}]
    </sup>
  )
}
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/renderer/modules/chat/components/CitationMarker.test.tsx --reporter=verbose 2>&1 | tail -10
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/chat/components/CitationMarker.tsx src/renderer/modules/chat/components/CitationMarker.test.tsx
git commit -m "feat(3b): add CitationMarker inline [N] superscript component"
```

---

### Task 11: Create `CitationPanel.tsx` + `CitationPanel.test.tsx`

**Files:**

- Create: `src/renderer/modules/chat/components/CitationPanel.tsx`
- Create: `src/renderer/modules/chat/components/CitationPanel.test.tsx`

- [ ] **Step 1: Write failing tests**

```typescript
// src/renderer/modules/chat/components/CitationPanel.test.tsx
import { fireEvent, render, screen } from '@testing-library/react'
import type { Citation } from '../../../../shared/contracts/citation-contract'
import type { EvidenceStatus } from '../../../../shared/contracts/citation-contract'
import { CitationPanel } from './CitationPanel'

const mockCitations: Citation[] = [
  {
    citationIndex: 1,
    fileId: 1,
    filePath: '/docs/fire-spec.pdf',
    fileName: 'fire-spec.pdf',
    chunkId: 'chunk-1',
    excerpt: 'Corridor assemblies shall achieve 2 hours.',
    pageNumber: 14,
    sectionTitle: 'Section 4.2',
    sourceId: 'src1',
  },
  {
    citationIndex: 2,
    fileId: 2,
    filePath: '/docs/code-report.pdf',
    fileName: 'code-report.pdf',
    chunkId: 'chunk-2',
    excerpt: 'Sprinkler exemption does not apply.',
    pageNumber: 3,
    sectionTitle: null,
    sourceId: 'src1',
  },
]

beforeEach(() => {
  vi.stubGlobal('kordaAPI', {
    fileIndexOpen: vi.fn().mockResolvedValue(undefined),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('CitationPanel', () => {
  it('renders collapsed by default showing source count', () => {
    render(<CitationPanel citations={mockCitations} evidenceStatus="supported" />)
    expect(screen.getByText(/2 sources/i)).toBeInTheDocument()
    expect(screen.queryByText('fire-spec.pdf')).not.toBeInTheDocument()
  })

  it('expands when toggle is clicked', () => {
    render(<CitationPanel citations={mockCitations} evidenceStatus="supported" />)
    fireEvent.click(screen.getByRole('button', { name: /2 sources/i }))
    expect(screen.getByText('fire-spec.pdf')).toBeInTheDocument()
    expect(screen.getByText('code-report.pdf')).toBeInTheDocument()
  })

  it('shows excerpt text when expanded', () => {
    render(<CitationPanel citations={mockCitations} evidenceStatus="partial" />)
    fireEvent.click(screen.getByRole('button', { name: /2 sources/i }))
    expect(screen.getByText(/Corridor assemblies shall achieve 2 hours/i)).toBeInTheDocument()
  })

  it('shows supported evidence badge in green', () => {
    render(<CitationPanel citations={mockCitations} evidenceStatus="supported" />)
    fireEvent.click(screen.getByRole('button', { name: /2 sources/i }))
    expect(screen.getByText(/Fully supported/i)).toBeInTheDocument()
  })

  it('shows partial badge in amber', () => {
    render(<CitationPanel citations={mockCitations} evidenceStatus="partial" />)
    fireEvent.click(screen.getByRole('button', { name: /2 sources/i }))
    expect(screen.getByText(/Partially supported/i)).toBeInTheDocument()
  })

  it('opens on scrollToIndex call via ref', () => {
    const ref = { current: null as { scrollToIndex: (i: number) => void } | null }
    render(<CitationPanel citations={mockCitations} evidenceStatus="supported" ref={ref} />)
    ref.current?.scrollToIndex(0)
    expect(screen.getByText('fire-spec.pdf')).toBeInTheDocument()
  })

  it('calls fileIndexOpen when Open File is clicked', () => {
    render(<CitationPanel citations={mockCitations} evidenceStatus="supported" />)
    fireEvent.click(screen.getByRole('button', { name: /2 sources/i }))
    fireEvent.click(screen.getAllByRole('button', { name: /open file/i })[0])
    expect(window.kordaAPI.fileIndexOpen).toHaveBeenCalledWith('/docs/fire-spec.pdf')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

```bash
npx vitest run src/renderer/modules/chat/components/CitationPanel.test.tsx --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 3: Create `CitationPanel.tsx`**

```typescript
// src/renderer/modules/chat/components/CitationPanel.tsx
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, ExternalLink } from 'lucide-react'
import type { Citation, EvidenceStatus } from '../../../../shared/contracts/citation-contract'

interface CitationPanelProps {
  citations: Citation[]
  evidenceStatus: EvidenceStatus | undefined
}

export interface CitationPanelHandle {
  scrollToIndex: (index: number) => void
}

const EVIDENCE_BADGE: Record<EvidenceStatus, { label: string; className: string }> = {
  supported: { label: '✓ Fully supported by documents', className: 'text-green-400' },
  partial: { label: '◑ Partially supported', className: 'text-amber-400' },
  unsupported: { label: '✗ Not found in documents', className: 'text-red-400' },
}

export const CitationPanel = forwardRef<CitationPanelHandle, CitationPanelProps>(
  function CitationPanel({ citations, evidenceStatus }, ref) {
    const [open, setOpen] = useState(false)
    const itemRefs = useRef<Array<HTMLDivElement | null>>([])

    useImperativeHandle(ref, () => ({
      scrollToIndex(index: number) {
        setOpen(true)
        setTimeout(() => {
          itemRefs.current[index]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
        }, 50)
      },
    }))

    if (citations.length === 0) return null

    const badge = evidenceStatus ? EVIDENCE_BADGE[evidenceStatus] : null

    return (
      <div className="mt-3 rounded-xl border border-border bg-surface-base/60">
        <button
          type="button"
          aria-label={`${citations.length} sources`}
          onClick={() => setOpen((v) => !v)}
          className="flex w-full items-center justify-between px-3 py-2 text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          <span>{citations.length} source{citations.length !== 1 ? 's' : ''}</span>
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {open && (
          <div className="border-t border-border px-3 pb-3">
            <div className="space-y-3 pt-3">
              {citations.map((citation, i) => (
                <div
                  key={citation.chunkId}
                  ref={(el) => { itemRefs.current[i] = el }}
                  className="text-xs"
                >
                  <div className="font-medium text-text-primary">
                    [{citation.citationIndex}] {citation.fileName}
                  </div>
                  <div className="text-text-secondary">
                    {[
                      citation.sectionTitle,
                      citation.pageNumber != null ? `Page ${citation.pageNumber}` : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                  {citation.excerpt && (
                    <blockquote className="mt-1 border-l-2 border-teal-500/40 pl-2 text-text-secondary italic">
                      "{citation.excerpt}"
                    </blockquote>
                  )}
                  <div className="mt-1 flex gap-2">
                    <button
                      type="button"
                      aria-label="Open file"
                      onClick={() => void window.kordaAPI.fileIndexOpen(citation.filePath)}
                      className="inline-flex items-center gap-1 text-teal-400 hover:underline"
                    >
                      <ExternalLink size={10} />
                      Open File
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {badge && (
              <div className={`mt-3 border-t border-border pt-2 text-xs ${badge.className}`}>
                {badge.label}
              </div>
            )}
          </div>
        )}
      </div>
    )
  },
)
```

- [ ] **Step 4: Run tests — expect PASS**

```bash
npx vitest run src/renderer/modules/chat/components/CitationPanel.test.tsx --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/modules/chat/components/CitationPanel.tsx src/renderer/modules/chat/components/CitationPanel.test.tsx
git commit -m "feat(3b): add CitationPanel collapsible component with evidence status badge"
```

---

## Chunk 6: Chat Module Integration

### Task 12: Update `ChatInput.tsx` with `ScopeSelector`

**Files:**

- Modify: `src/renderer/modules/chat/components/ChatInput.tsx`

- [ ] **Step 1: Update `ChatInputProps` and integrate `ScopeSelector`**

Replace `src/renderer/modules/chat/components/ChatInput.tsx`:

```typescript
import { forwardRef, useEffect, useRef } from 'react'
import { Send, Square } from 'lucide-react'
import { CHAT_MODEL_OPTIONS, getModelCostHint } from '../chatModels'
import { ScopeSelector } from './ScopeSelector'

interface ChatInputProps {
  draft: string
  isStreaming: boolean
  model: string
  selectedSourceIds: string[]
  selectedProjects: string[]
  onDraftChange: (value: string) => void
  onModelChange: (model: string) => void
  onSend: () => void
  onStop: () => void
  onSourcesChange: (ids: string[]) => void
  onProjectsChange: (projects: string[]) => void
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput(
  {
    draft, isStreaming, model,
    selectedSourceIds, selectedProjects,
    onDraftChange, onModelChange, onSend, onStop,
    onSourcesChange, onProjectsChange,
  },
  forwardedRef,
) {
  const localRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const textarea = localRef.current
    if (!textarea) return
    textarea.style.height = 'auto'
    textarea.style.height = `${Math.min(textarea.scrollHeight, 24 * 6)}px`
  }, [draft])

  return (
    <div className="border-t border-border bg-surface-raised/60 p-4">
      <div className="mb-2 flex items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-text-secondary">
          <span>Model</span>
          <select
            aria-label="Model"
            value={model}
            onChange={(event) => onModelChange(event.target.value)}
            className="rounded border border-border bg-surface-base px-2 py-1 text-sm normal-case tracking-normal text-text-primary outline-none focus:border-accent"
          >
            {CHAT_MODEL_OPTIONS.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="text-xs text-text-secondary">~{Math.ceil(draft.length / 4)} tokens</div>
      </div>

      <div className="rounded-xl border border-border bg-surface-base p-3 shadow-sm">
        <textarea
          ref={(node) => {
            localRef.current = node
            if (typeof forwardedRef === 'function') {
              forwardedRef(node)
            } else if (forwardedRef) {
              forwardedRef.current = node
            }
          }}
          value={draft}
          rows={1}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              if (!isStreaming && draft.trim()) {
                onSend()
              }
            }
          }}
          placeholder="Ask about standards, specifications, calculations, or coordination..."
          className="max-h-36 min-h-6 w-full resize-none bg-transparent text-sm text-text-primary outline-none placeholder:text-text-secondary"
        />

        <div className="mt-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="text-xs text-text-secondary">
              {getModelCostHint(model)} model selected
            </div>
            <ScopeSelector
              selectedSourceIds={selectedSourceIds}
              selectedProjects={selectedProjects}
              onSourcesChange={onSourcesChange}
              onProjectsChange={onProjectsChange}
            />
          </div>
          {isStreaming ? (
            <button
              type="button"
              aria-label="Stop response"
              onClick={onStop}
              className="inline-flex items-center gap-2 rounded bg-red-500/90 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500"
            >
              <Square size={14} />
              Stop
            </button>
          ) : (
            <button
              type="button"
              aria-label="Send message"
              onClick={onSend}
              disabled={!draft.trim()}
              className="inline-flex items-center gap-2 rounded bg-brand px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Send size={14} />
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
})
```

- [ ] **Step 2: Run ChatInput tests**

```bash
npx vitest run src/renderer/modules/chat/components/ChatInput.test.tsx --reporter=verbose 2>&1 | tail -20
```

The existing tests will fail because the `ChatInput` component now requires new props. Update `ChatInput.test.tsx` to pass the new required props:

In each `render(<ChatInput .../>)` call, add:

```typescript
selectedSourceIds={[]}
selectedProjects={[]}
onSourcesChange={vi.fn()}
onProjectsChange={vi.fn()}
```

- [ ] **Step 3: Run ChatInput tests again — expect PASS**

```bash
npx vitest run src/renderer/modules/chat/components/ChatInput.test.tsx --reporter=verbose 2>&1 | tail -20
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/chat/components/ChatInput.tsx src/renderer/modules/chat/components/ChatInput.test.tsx
git commit -m "feat(3b): integrate ScopeSelector into ChatInput"
```

---

### Task 13: Update `ChatModule.tsx` — scope state + grounded routing

**Files:**

- Modify: `src/renderer/modules/chat/ChatModule.tsx`

- [ ] **Step 1: Add scope state, grounded IPC handlers, and routing**

Add these imports at the top:

```typescript
import type { Citation, GroundedDonePayload } from '../../../shared/ipc-types'
```

Add new state variables (after existing state declarations):

```typescript
const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([])
const [selectedProjects, setSelectedProjects] = useState<string[]>([])
const [isSearching, setIsSearching] = useState(false)
const [pendingCitations, setPendingCitations] = useState<Citation[]>([])
```

**Reset scope on conversation change** — add to `loadConversation`:

```typescript
// No change needed to loadConversation; scope is intentionally sticky per conversation
```

**Register grounded IPC handlers** — add to the `useEffect` that registers `onChatToken`, `onChatDone`, `onChatError`:

```typescript
const unsubscribeSearching = window.kordaAPI.onChatSearching((messageId) => {
  setPendingAssistantId(messageId)
  setIsSearching(true)
  setIsStreaming(true)
})

const unsubscribeCitation = window.kordaAPI.onChatCitation((payload) => {
  setPendingCitations((prev) => [...prev, payload.citation])
})

const unsubscribeGroundedDone = window.kordaAPI.onChatGroundedDone(
  (payload: GroundedDonePayload) => {
    setIsSearching(false)
    setIsStreaming(false)
    setStreamError(null)
    setPendingAssistantId(null)
    setPendingAssistantContent('')
    setPendingCitations([])

    // Use payload.finalText to immediately correct the streamed content
    // (removes evidence marker that may have been streamed before extraction).
    // Then reload from DB to hydrate the full persisted state.
    setMessages((prev) =>
      prev.map((m) =>
        m.id === payload.messageId
          ? {
              ...m,
              content: payload.finalText,
              citations: payload.citations,
              evidenceStatus: payload.evidenceStatus,
              groundedChunkCount: payload.chunkCount,
            }
          : m,
      ),
    )

    const currentConversationId = activeConversationIdRef.current
    if (currentConversationId) {
      void loadConversation(currentConversationId)
    }
    void reloadConversations(currentConversationId)
  },
)
```

Return the cleanup functions: add `unsubscribeSearching()`, `unsubscribeCitation()`, `unsubscribeGroundedDone()` to the return cleanup.

**Update `sendMessage`** to route grounded vs plain:

```typescript
const sendMessage = useCallback(
  async (content: string, conversationIdArg?: string) => {
    const trimmedContent = content.trim()
    if (!trimmedContent) return

    let conversationId = conversationIdArg ?? activeConversationIdRef.current
    if (!conversationId) {
      conversationId = await createConversation()
    }

    setIsStreaming(true)
    setStreamError(null)
    setPendingAssistantContent('')
    setPendingCitations([])

    const isGrounded = selectedSourceIds.length > 0

    if (isGrounded) {
      const { messageId } = await window.kordaAPI.chatSendGrounded({
        conversationId,
        content: trimmedContent,
        model,
        scopeSourceIds: selectedSourceIds,
        projectFilters: selectedProjects,
      })
      const snapshot = await window.kordaAPI.chatConversationGet(conversationId)
      setMessages(snapshot.messages)
      setPendingAssistantId(messageId)
      await reloadConversations(conversationId)
    } else {
      const { messageId } = await window.kordaAPI.chatSend({
        conversationId,
        content: trimmedContent,
        model,
      })
      const snapshot = await window.kordaAPI.chatConversationGet(conversationId)
      setMessages(snapshot.messages)
      setPendingAssistantId(messageId)
      await reloadConversations(conversationId)
    }
  },
  [createConversation, model, reloadConversations, selectedSourceIds, selectedProjects],
)
```

**Pass scope props to `ChatInput`**:

```typescript
        <ChatInput
          ref={inputRef}
          draft={draft}
          isStreaming={isStreaming}
          model={model}
          selectedSourceIds={selectedSourceIds}
          selectedProjects={selectedProjects}
          onDraftChange={setDraft}
          onModelChange={setModel}
          onSend={() => void handleSend()}
          onStop={() => {
            void window.kordaAPI.chatStop()
            setIsStreaming(false)
            setIsSearching(false)
          }}
          onSourcesChange={setSelectedSourceIds}
          onProjectsChange={setSelectedProjects}
        />
```

**Pass `isSearching` and `pendingCitations` to `MessageThread`** (if it renders the pending bubble):
Add `isSearching` and `pendingCitations` as props to `MessageThread`. For now, pass them through so `MessageThread` can display a searching indicator. (The minimal implementation: `isSearching` toggles a "Searching documents…" label in the pending bubble area.)

- [ ] **Step 2: Update ChatModule test mock and add routing test**

In `src/renderer/modules/chat/ChatModule.test.tsx`, add to the `kordaAPI` mock object:

```typescript
    chatSendGrounded: vi.fn(async () => ({ messageId: 'assistant-grounded' })),
    onChatSearching: vi.fn(() => vi.fn()),
    onChatCitation: vi.fn(() => vi.fn()),
    onChatGroundedDone: vi.fn(() => vi.fn()),
```

Also add this new test at the end of the `describe('ChatModule')` block:

```typescript
  it('routes to chatSendGrounded when scope sources are selected', async () => {
    render(
      <MemoryRouter>
        <ChatModule />
      </MemoryRouter>,
    )

    // Wait for initial load
    await waitFor(() => expect(chatConversationsList).toHaveBeenCalled())

    // Create a conversation first
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /new conversation/i }))
    })

    // Open scope selector and select a source
    await act(async () => {
      window.kordaAPI.fileIndexSourcesList = vi.fn().mockResolvedValue([
        { id: 'src1', name: 'Engineering Shares', type: 'local', rootPath: '/eng', status: 'ok' },
      ])
      window.kordaAPI.fileIndexProjectsList = vi.fn().mockResolvedValue([])
      fireEvent.click(screen.getByRole('button', { name: /scope/i }))
    })

    await waitFor(() => screen.getByText('Engineering Shares'))
    fireEvent.click(screen.getByLabelText('Engineering Shares'))
    fireEvent.click(screen.getByRole('button', { name: /search these/i }))

    // Type and send a message
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'fire rating corridor' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(window.kordaAPI.chatSendGrounded).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'fire rating corridor',
          scopeSourceIds: ['src1'],
        }),
      ),
    )
    expect(window.kordaAPI.chatSend).not.toHaveBeenCalled()
  })

  it('routes to chatSend (plain) when no scope sources are selected', async () => {
    render(
      <MemoryRouter>
        <ChatModule />
      </MemoryRouter>,
    )
    await waitFor(() => expect(chatConversationsList).toHaveBeenCalled())
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /new conversation/i }))
    })

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'hello' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(chatSend).toHaveBeenCalled())
    expect(window.kordaAPI.chatSendGrounded).not.toHaveBeenCalled()
  })
```

- [ ] **Step 3: Run tests — expect PASS**

```bash
npx vitest run src/renderer/modules/chat/ChatModule.test.tsx --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/modules/chat/ChatModule.tsx src/renderer/modules/chat/ChatModule.test.tsx
git commit -m "feat(3b): ChatModule scope state + grounded/plain routing + grounded IPC handlers"
```

---

### Task 14: Update `MessageBubble.tsx` — citation rendering + amber fallback notice

**Files:**

- Modify: `src/renderer/modules/chat/components/MessageBubble.tsx`

- [ ] **Step 1: Add citation rendering and amber fallback notice**

Add imports at the top:

```typescript
import { useRef } from 'react'
import { CitationMarker } from './CitationMarker'
import { CitationPanel } from './CitationPanel'
import type { CitationPanelHandle } from './CitationPanel'
```

**Replace the assistant content rendering section** (the `isAssistant ? <ReactMarkdown ...> : ...` block) with a version that:

1. Injects `[N]` citation markers into text
2. Shows amber fallback notice for `grounded_fallback` mode
3. Renders `CitationPanel` below grounded messages

```typescript
  const panelRef = useRef<CitationPanelHandle | null>(null)

  const renderAssistantContent = () => {
    const content = message.content
    const isGroundedFallback = message.mode === 'grounded_fallback'

    // Split text on [N] citation markers and inject CitationMarker components
    const parts = content.split(/(\[\d+\])/g)
    const renderedText = parts.map((part, i) => {
      const match = /^\[(\d+)\]$/.exec(part)
      if (match) {
        return (
          <CitationMarker
            key={i}
            index={parseInt(match[1], 10)}
            onCitationClick={() => panelRef.current?.scrollToIndex(parseInt(match[1], 10) - 1)}
          />
        )
      }
      return part
    })

    return (
      <>
        {isGroundedFallback && (
          <div className="mb-2 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            ⚠ No matching documents found in selected scope — answering from general knowledge
          </div>
        )}
        <div className="prose prose-invert max-w-none text-sm prose-p:my-2 prose-pre:my-0 prose-code:text-[13px]">
          <ReactMarkdown
            components={{
              // ... keep existing code component renderer unchanged ...
              p({ children }) {
                // Inject CitationMarkers into paragraph text
                return <p>{children}</p>
              },
              text({ children }) {
                if (typeof children !== 'string') return <>{children}</>
                const textParts = children.split(/(\[\d+\])/g)
                return (
                  <>
                    {textParts.map((part, i) => {
                      const m = /^\[(\d+)\]$/.exec(part)
                      if (m) {
                        return (
                          <CitationMarker
                            key={i}
                            index={parseInt(m[1], 10)}
                            onCitationClick={(idx) =>
                              panelRef.current?.scrollToIndex(idx - 1)
                            }
                          />
                        )
                      }
                      return <span key={i}>{part}</span>
                    })}
                  </>
                )
              },
            }}
          >
            {content}
          </ReactMarkdown>
        </div>
        {message.role === 'assistant' &&
          (message.mode === 'grounded' || message.mode === 'grounded_fallback') &&
          message.citations &&
          message.citations.length > 0 && (
            <CitationPanel
              ref={panelRef}
              citations={message.citations}
              evidenceStatus={message.evidenceStatus}
            />
          )}
      </>
    )
  }
```

Then in the JSX, replace:

```typescript
        ) : isAssistant ? (
          <div className="prose ...">
            <ReactMarkdown ...>{message.content}</ReactMarkdown>
          </div>
```

with:

```typescript
        ) : isAssistant ? (
          renderAssistantContent()
```

- [ ] **Step 2: Run all renderer tests**

```bash
npx vitest run src/renderer/ --reporter=verbose 2>&1 | tail -30
```

- [ ] **Step 3: Fix any TypeScript or test failures**

If `ReactMarkdown` doesn't support a `text` component renderer, use a simpler approach: inject markers after the full render using a post-process utility function on the raw string before passing to `ReactMarkdown`.

Alternative simpler approach if the above causes issues:

```typescript
function injectCitationMarkers(text: string, onCitationClick: (idx: number) => void): React.ReactNode[] {
  return text.split(/(\[\d+\])/g).map((part, i) => {
    const m = /^\[(\d+)\]$/.exec(part)
    if (m) {
      return <CitationMarker key={i} index={parseInt(m[1], 10)} onCitationClick={onCitationClick} />
    }
    return <span key={i}>{part}</span>
  })
}
```

Then render grounded messages without `ReactMarkdown` for simplicity:

```typescript
<div className="text-sm text-text-primary leading-relaxed">
  {injectCitationMarkers(content, (idx) => panelRef.current?.scrollToIndex(idx - 1))}
</div>
```

- [ ] **Step 4: Run all tests**

```bash
npx vitest run --reporter=verbose 2>&1 | tail -40
```

Expected: all tests PASS.

- [ ] **Step 5: Verify TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/renderer/modules/chat/components/MessageBubble.tsx
git commit -m "feat(3b): MessageBubble citation markers, CitationPanel, amber fallback notice"
```

---

## Final Verification

- [ ] **Run full test suite**

```bash
cd "C:/code/Korda studio/korda-studio"
npx vitest run --reporter=verbose 2>&1 | tail -50
```

Expected: all tests PASS. Note any failures and fix before merging.

- [ ] **TypeScript check**

```bash
npx tsc --noEmit 2>&1
```

Expected: no errors.

- [ ] **Final commit**

```bash
git log --oneline -15
```

Review that all 14 tasks have commits. Then:

```bash
git tag phase-3b-complete
```

---

## Appendix: Manual Test Checklist

After running the app with `npm start`:

1. **Plain chat** — No scope selected → send a message → Claude answers normally, no citation panel.
2. **Scope selector** — Click Scope button → sources and projects load → select a source → teal dot appears.
3. **Grounded chat (zero results)** — Select source with no relevant content → send question → amber notice appears, answer comes from general knowledge.
4. **Grounded chat (with results)** — Select a source with indexed content → ask relevant question → "Searching…" spinner appears → answer streams with `[1]`, `[2]` markers → citation panel expands showing excerpts and file names.
5. **Evidence badge** — `✓ Fully supported` / `◑ Partially supported` / `✗ Not found` appears at bottom of citation panel.
6. **Stop mid-grounded** — Click Stop during Pass 1 → stream halts.
7. **Conversation reload** — Navigate away and back → grounded message retains citations and evidence badge (hydrated from DB).
