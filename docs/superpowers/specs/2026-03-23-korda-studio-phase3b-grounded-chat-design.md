# KORDA Studio Phase 3B — Grounded Chat Design Spec

**Date:** 2026-03-23
**Status:** Ready for implementation
**Scope:** Two-pass grounded chat · Citations API · Agentic tool loop · Scope selector · Citation rendering · Tool registry (extensible)

---

## 1. Context and Goals

### Current state

Phase 3A delivered a complete RAG foundation:

- `chunks` table with FTS5/BM25 keyword retrieval
- `retrievalService` with `search()` returning `RetrievalResult[]`
- `LLMProvider.streamWithTools()` stub (throws `NotImplementedError`)
- `Citation`, `GroundedAnswer`, `AgentTool`, `ToolRegistry` contracts locked
- `SEARCH_KNOWLEDGE_BASE_TOOL_NAME` constant defined in `agent-tool-contract.ts`
- Knowledge Search module for non-generative document search

Chat remains entirely disconnected from the knowledge base. Engineers ask questions and Claude answers from training data alone.

### What Phase 3B delivers

Grounded chat — Claude searches indexed engineering documents before answering, cites the exact sentences it drew from, and engineers can verify every claim back to the source file:

1. **Per-message scope selector** — engineers choose which sources and projects to search for each message
2. **Two-pass grounded chat** — Pass 1: agentic multi-hop retrieval (tool use loop); Pass 2: Citations API streaming answer with sentence-level citations
3. **Extensible tool registry** — `search_knowledge_base` is the first tool; custom engineering tools register identically in a future phase
4. **Citation rendering** — inline `[N]` superscripts in the answer, collapsible citation panel below each grounded message
5. **Four 2026 enhancements** — model routing, prompt caching, query rewriting, evidence status badge

### What Phase 3B explicitly defers

- Custom engineering tools (unit converters, load calculators, spec lookups) — Phase 3D
- Voyage AI embeddings and vector search (hybrid BM25 + vector retrieval) — Phase 3C
- Cohere reranking activation — Phase 3C (key-gated stub already in `retrievalService`)
- Conversation export (PDF/Word with citations) — future phase
- Follow-up question suggestions — future phase

---

## 2. Architecture Overview

```
User message + scope selection (sourceIds[], projectFilters[])
        │
        ▼
chatService.sendGrounded()
        │
        ├─ scopeSourceIds.length === 0 → chatService.send() [plain mode, unchanged]
        │
        └─ scopeSourceIds.length > 0 → groundedChatService.sendGrounded()
                │
                ▼
        ┌───────────────────────────────────────────────────────────────┐
        │ PASS 1 — Query rewriting + Agentic retrieval (non-streaming)  │
        │                                                               │
        │  1. Haiku call: rewrite question → 2-3 search queries         │
        │  2. AnthropicClient.runToolLoop()                             │
        │     Tool registry: search_knowledge_base (+ future tools)     │
        │     Claude calls search 1–4 times with rewritten queries      │
        │     Each call → retrievalService.search() + scope filters     │
        │     Loop ends: stop_reason = end_turn OR maxToolCalls hit     │
        │  3. Collect unique chunks (dedup by id, rank by bm25Score)    │
        │     0 chunks → graceful fallback path                         │
        │     > 0 chunks → Pass 2                                       │
        │                                                               │
        │  emit: chat:searching IPC → renderer shows spinner            │
        └───────────────────────────────────────────────────────────────┘
                │
                ▼
        ┌───────────────────────────────────────────────────────────────┐
        │ PASS 2 — Citations API streaming answer                       │
        │                                                               │
        │  Top 20 chunks (by bm25Score) → Citation documents           │
        │  cache_control: ephemeral on system prompt + documents        │
        │  Sonnet streaming request with citations.enabled = true       │
        │                                                               │
        │  text_delta  → chat:token IPC (streams answer progressively)  │
        │  citations_delta → chat:citation IPC (panel builds live)      │
        │  end_turn    → chat:grounded-done IPC                         │
        │                                                               │
        │  Citations persisted as JSON on messages row                  │
        └───────────────────────────────────────────────────────────────┘
                │
                ▼
        Renderer: inline [N] markers + collapsible CitationPanel
```

**Graceful fallback path** (zero chunks from Pass 1):

- Skip Pass 2 entirely
- Run `chatService.send()` with same conversation/message context
- Prepend amber notice to streamed answer: _"⚠ No matching documents found in selected scope — answering from general knowledge"_
- Message stored with `mode = 'grounded_fallback'`, `citations = null`

---

## 3. Query Rewriting (pre-Pass 1)

Before the tool loop runs, a single lightweight Haiku call rewrites the engineer's natural language question into 2–3 optimised search queries using domain terminology.

**System prompt:**

```
You are a search query optimizer for an engineering document retrieval system.
Given a question, produce 2-3 specific search queries that will find relevant
engineering documents. Use precise technical terminology. Return ONLY a JSON
array of strings: ["query1", "query2", "query3"]. No explanation.
```

**Example:**

- Input: _"what's the load limit for that corridor from last week's review?"_
- Output: `["corridor structural live load capacity", "egress corridor load requirements IBC", "corridor live load design criteria"]`

Each query runs as a separate `search_knowledge_base` tool call in Pass 1. The tool loop starts with the rewritten queries; Claude may add further queries of its own.

**Implementation:** `groundedChatService.rewriteQuery(userContent, model)` — standalone async function, called once before `runToolLoop()`. Uses `claude-haiku-4-5` (hardcoded, not user-configurable). On any error (rate limit, timeout), falls back to passing the original question unchanged. Never blocks the grounded chat flow.

---

## 4. Tool Registry

### 4.1 `tool-registry-contract.ts` (new contract file)

```typescript
import type { AgentTool, AgentToolResult } from './agent-tool-contract'
import type { RetrievalResult } from './retrieval-contract'

export interface ToolRegistry {
  /** Register a tool. Called at init time. */
  register(tool: AgentTool): void

  /** Execute a named tool with given input. Called by the tool loop. */
  execute(name: string, input: Record<string, unknown>): Promise<AgentToolResult>

  /**
   * All registered tools converted to Anthropic SDK format.
   * Maps AgentTool.inputSchema (camelCase) → input_schema (snake_case required by API).
   * getSchemas() performs this mapping: { input_schema: tool.inputSchema }
   */
  getSchemas(): AnthropicToolSchema[]

  /**
   * All unique RetrievalResults from search_knowledge_base calls this session.
   * Each RetrievalResult contains both ChunkRecord AND FileEntry — required for
   * buildDocTitle() in Pass 2. Deduped by chunk.id, sorted by bm25Score desc, capped at 20.
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
 * Extends AgentTool with optional trigger patterns (command strings
 * like /loads or context keywords that auto-activate the tool).
 * Not implemented in Phase 3B — locked here for future registration.
 */
export interface EngineeringTool extends AgentTool {
  /** Slash command triggers: ['/loads', '/units'] */
  commandTriggers?: string[]
  /** Context keywords that suggest this tool is relevant */
  contextKeywords?: string[]
}
```

### 4.2 `toolRegistry.ts` (new main-process file)

Responsibilities:

- Holds a `Map<string, AgentTool>` of registered tools
- `getSchemas()`: converts each `AgentTool` to `AnthropicToolSchema` by mapping `tool.inputSchema` → `input_schema` (snake_case). This is the only place the camelCase→snake_case translation happens.
- On `execute('search_knowledge_base', input)`: calls `retrievalService.search()` with scope filters injected from `currentScope` — Claude never needs to know about scope, it just searches and gets scoped results
- Tracks all unique `RetrievalResult` objects (not just chunks) — preserves `result.file: FileEntry` needed for `buildDocTitle()` in Pass 2
- `collectResults()`: deduplicates by `result.chunk.id`, sorts by `bm25Score` descending, caps at 20
- `currentScope`: mutable, set by `groundedChatService` via `setScope()` before each `sendGrounded()` call

**`searchKnowledgeBaseTool` definition lives in `toolRegistry.ts`** as a module-level `const` that wraps `retrievalService.search()`. It is registered in `main.ts` via `toolRegistry.register(searchKnowledgeBaseTool)` on init. This is the canonical home for the `AgentTool` object implementation — `agent-tool-contract.ts` only defines the interface and the name constant.

---

## 5. `AnthropicClient.streamWithTools()` — Implementation

Replaces the `NotImplementedError` stub in `llmClient.ts`.

### 5.1 Multi-turn tool loop

```typescript
// Reads tool schemas from toolRegistry.getSchemas() — not a parameter.
// toolRegistry.setScope() must be called before invoking this.
// Results collected via toolRegistry.collectResults() after this resolves.
async runToolLoop(
  messages: LLMMessage[],
  model: string,
  systemPrompt: string,
  onToolCall: (name: string, input: Record<string, unknown>) => void,
  maxToolCalls = 4
): Promise<void>
```

Loop:

```
1. Build Anthropic messages array from LLMMessage[]
2. Call client.messages.create({
     model,
     max_tokens: 1024,
     system: systemPrompt,
     tools: toolRegistry.getSchemas(),
     tool_choice: { type: 'auto' },
     messages
   })
3. If response.stop_reason === 'tool_use':
     // Append the assistant's tool_use turn ONCE per response (outside the per-block loop):
     messages.push({ role: 'assistant', content: response.content })
     // Collect all tool_result blocks for this response turn:
     const toolResults = []
     For each tool_use block in response.content where block.type === 'tool_use':
       onToolCall(block.name, block.input)  ← emits chat:searching IPC
       result = await toolRegistry.execute(block.name, block.input)
       toolResults.push({
         type: 'tool_result',
         tool_use_id: block.id,        // ← non-optional; omitting causes 400
         content: JSON.stringify(result.content)
       })
     // Append ALL tool_results in a single user turn:
     messages.push({ role: 'user', content: toolResults })
     toolCallCount++
     If toolCallCount < maxToolCalls: goto 2
     Else: break (max reached)
4. If response.stop_reason === 'end_turn': break
```

**Cancellation:** `runToolLoop()` accepts an `AbortSignal`. When `chat:stop` IPC fires, the signal is aborted. Each `client.messages.create()` call passes the signal via the SDK's `signal` option. This allows Pass 1 to be interrupted between tool call round-trips. Mid-round-trip interruption is not possible (SDK does not support it for non-streaming calls), so cancellation takes effect at the next iteration boundary — acceptable latency since each round-trip is <2s.

Pass 1 uses `claude-haiku-4-5` — fast, cheap, adequate for search orchestration. The loop does not stream. The renderer shows a spinner throughout.

### 5.2 `streamWithTools()` interface compliance

The `LLMProvider.streamWithTools()` signature returns `LLMStreamResult & { onToolCall(...) }`. In Phase 3B this is satisfied by `groundedChatService` — which calls `runToolLoop()` directly rather than going through the `LLMProvider` interface for Pass 1. The interface stub in `llmClient.ts` is updated to no longer throw but instead delegates to `runToolLoop()` so it compiles cleanly and is available for future use.

---

## 6. `groundedChatService.ts`

New file alongside `chatService.ts`. Handles the full two-pass flow.

```typescript
export const groundedChatService = {
  async sendGrounded(
    conversationId: string,
    userContent: string,
    model: string,           // Pass 2 model (Sonnet) — from user's AI config
    scopeSourceIds: string[],
    projectFilters: string[],
    win: BrowserWindow,
    getApiKey: () => string,
    getAIConfig: () => AIConfigSnapshot,
    getPreferences: () => PreferencesSnapshot,
  ): Promise<{ messageId: string }>
}
```

**Sequence inside `sendGrounded()`:**

```
1. Insert user message into messages table (mode = 'grounded')
2. Generate assistantMessageId = randomUUID()
3. Emit chat:searching { messageId: assistantMessageId }

4. rewrittenQueries = await rewriteQuery(userContent, haiku)
   → on error: rewrittenQueries = [userContent]

5. toolRegistry.reset()
   toolRegistry.setScope({ sourceIds: scopeSourceIds, projects: projectFilters })

6. await anthropicClient.runToolLoop(
     messages:      conversation history + user message,
     model:         'claude-haiku-4-5',
     systemPrompt:  buildSearchSystemPrompt(),
     onToolCall:    (name, input) => win.webContents.send(CHAT_SEARCHING, assistantMessageId),
     maxToolCalls:  4
   )

7. results = toolRegistry.collectResults()  // unique RetrievalResult[], ranked by bm25Score, capped at 20

8. If results.length === 0:
     emit chat:token "⚠ No matching documents found in selected scope — answering from general knowledge\n\n"
     run plain stream (chatService internal stream helper)
     store message with mode = 'grounded_fallback'
     return { messageId: assistantMessageId }

9. Pass 2: buildCitationsRequest(results, userContent, systemPrompt)
   stream = anthropicClient.streamCitations(request)

10. For each event in stream:
      text_delta      → emit chat:token { token }
      citations_delta → build Citation from document_index → chunks[i]
                        assign next [N] index
                        emit chat:citation { messageId, index, citation }

11. On stream end:
      emit chat:grounded-done { messageId, citations, evidenceStatus, inputTokens, outputTokens, chunkCount }
      const groundedAnswer: GroundedAnswer = {
        text: fullText,
        citations,
        evidenceStatus,
        retrievedChunkCount: results.length,
        searchQueriesUsed: rewrittenQueries,
      }
      persist assistant message: { mode: 'grounded', citations: JSON.stringify(groundedAnswer), grounded_chunk_count: results.length }
```

**`buildCitationsRequest(results, question, systemPrompt)`:**

`results` is `RetrievalResult[]` from `toolRegistry.collectResults()` — each entry contains both `result.chunk: ChunkRecord` AND `result.file: FileEntry`. No additional DB lookup is required.

```typescript
{
  model: sonnetModel,  // from AI config
  max_tokens: 4096,
  system: [
    {
      type: 'text',
      text: systemPrompt,
      cache_control: { type: 'ephemeral' }  // prompt caching on system prompt
    }
  ],
  messages: [{
    role: 'user',
    content: [
      // Citation documents — cache_control: ephemeral on each document block
      // (Anthropic supports cache_control on document-type content blocks in user messages)
      ...results.map((result) => ({
        type: 'document',
        source: {
          type: 'text',
          media_type: 'text/plain',   // required field for PlainTextSource
          data: result.chunk.text
        },
        title: buildDocTitle(result.chunk, result.file),
        citations: { enabled: true },
        cache_control: { type: 'ephemeral' }
      })),
      // The question last
      { type: 'text', text: question }
    ]
  }]
}
```

**`buildDocTitle(chunk, file)`:**
`"${file.name}${chunk.sectionTitle ? ` — ${chunk.sectionTitle}` : ''}${chunk.pageNumber ? ` (p.${chunk.pageNumber})` : ''}${chunk.sheetName ? ` [${chunk.sheetName}]` : ''}"`

---

## 7. Evidence Status

`GroundedAnswer.evidenceStatus` is already typed in `citation-contract.ts` as `'supported' | 'partial' | 'unsupported'`. Phase 3B surfaces it.

**Determination:** The Pass 2 system prompt instructs Claude to include a structured marker at the very end of its answer (after all prose), on its own line:

```
<!--evidence:supported-->
```

One of: `<!--evidence:supported-->`, `<!--evidence:partial-->`, `<!--evidence:unsupported-->`

**Streaming extraction strategy:** Because `text_delta` events deliver tokens in arbitrary chunk sizes, the marker cannot be detected per-token. Instead:

1. All `text_delta` strings are accumulated into a `fullText` buffer throughout Pass 2
2. Rendered text is streamed normally via `chat:token` — the marker may briefly appear at the very end if the stream ends before extraction (see step 4)
3. On stream `end_turn`, extract the marker from `fullText` using `/<!--evidence:(supported|partial|unsupported)-->$/`:
   - If found: strip from `fullText`, set `evidenceStatus`, emit corrected final text via `chat:grounded-done`
   - If not found: `evidenceStatus = 'partial'` (safe default)
4. The persisted `content` on the messages row is always the stripped `fullText` (no marker). The rendered text in the renderer is updated on `chat:grounded-done` to replace the streamed content, ensuring the marker is never visible to the user.

On `chat:grounded-done`, `evidenceStatus` is included in the payload alongside `citations[]`.

**UI badge on grounded messages:**

| Status        | Badge                                                       |
| ------------- | ----------------------------------------------------------- |
| `supported`   | `✓ Fully supported by documents` (green)                    |
| `partial`     | `◑ Partially supported` (amber)                             |
| `unsupported` | `✗ Not found in documents` (red, same as graceful fallback) |

Badge appears below the answer text, above the citation panel. Stored in `citations` JSON on the message row (as part of `GroundedAnswer`).

---

## 8. New IPC Channels

| Channel              | Direction       | Payload                                                    | Notes                                                    |
| -------------------- | --------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| `chat:send-grounded` | renderer → main | `GroundedSendParams`                                       | triggers two-pass flow                                   |
| `chat:searching`     | main → renderer | `{ messageId: string }`                                    | spinner on; may fire multiple times (once per tool call) |
| `chat:citation`      | main → renderer | `{ messageId: string; index: number; citation: Citation }` | streams as Pass 2 runs; delivered as single object arg   |
| `chat:grounded-done` | main → renderer | `GroundedDonePayload`                                      | replaces chat:done for grounded messages                 |

Existing channels `chat:token`, `chat:error`, `chat:stop` reused unchanged.

```typescript
// New types in ipc-types.ts:

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
}

// Extended ChatMessage:
export interface ChatMessage {
  // ...existing fields...
  mode?: 'plain' | 'grounded' | 'grounded_fallback'
  citations?: Citation[]
  evidenceStatus?: EvidenceStatus // populated from GroundedDonePayload on grounded messages
  groundedChunkCount?: number
}
```

**KordaAPI additions:**

```typescript
chatSendGrounded(params: GroundedSendParams): { messageId: string }
onChatSearching(cb: (messageId: string) => void): () => void
// Single object payload — Electron IPC delivers one argument per event
onChatCitation(cb: (payload: { messageId: string; index: number; citation: Citation }) => void): () => void
onChatGroundedDone(cb: (payload: GroundedDonePayload) => void): () => void
```

---

## 9. Schema Changes

**`messages` table — 3 additive columns (idempotent):**

```sql
-- Each column wrapped in its own try/catch — same pattern as fileIndexService.ts
try { db.exec(`ALTER TABLE messages ADD COLUMN mode TEXT NOT NULL DEFAULT 'plain'`) } catch {}
-- 'plain' | 'grounded' | 'grounded_fallback'

try { db.exec(`ALTER TABLE messages ADD COLUMN citations TEXT`) } catch {}
-- JSON: GroundedAnswer | null  (full GroundedAnswer object: { citations: Citation[], evidenceStatus: EvidenceStatus, ... })

try { db.exec(`ALTER TABLE messages ADD COLUMN grounded_chunk_count INTEGER`) } catch {}
-- Pass 1 result collection count (observability)
```

Each `ALTER TABLE` is in its own try/catch block. SQLite throws if the column already exists — the catch silently swallows it, making the migration safe on every startup. A single `db.exec()` with all three statements would fail entirely on the second startup. Migration runs inside `chatService.init()`.

---

## 10. Per-Message Scope Selector

### 10.1 UI

Compact icon button `[🔍 Scope]` to the left of the send button in `ChatInput.tsx`. When no scope is selected: button is subdued, sending triggers plain chat. When scope is active: button has a teal dot indicator, sending triggers grounded chat.

Clicking opens a popover (`ScopeSelector.tsx`):

```
┌─────────────────────────────────────────┐
│  Sources                                │
│  ☑ Engineering Shares                   │
│  ☑ Project Files                        │
│  ☐ Legacy Archive                       │
│                                         │
│  Projects (optional — filters sources)  │
│  ☐ Hospital Expansion                   │
│  ☐ Civic Centre                         │
│  ☑ All projects                         │
│                                         │
│  [Clear scope]          [Search these ▶]│
└─────────────────────────────────────────┘
```

- Sources list: `window.kordaAPI.fileIndexSourcesList()` (existing IPC)
- Projects list: `window.kordaAPI.fileIndexProjectsList()` (existing IPC)
- Default: all projects selected, no sources selected (= plain chat)
- **Sticky:** scope persists across messages within the same conversation, stored in component state (not persisted to DB — intentional, resets on conversation change)
- **"Search these ▶"** closes the popover and focuses the message input

### 10.2 Send routing in `ChatModule.tsx`

```typescript
const isGrounded = scopeSourceIds.length > 0

if (isGrounded) {
  window.kordaAPI.chatSendGrounded({
    conversationId,
    content,
    model,
    scopeSourceIds,
    projectFilters,
  })
} else {
  window.kordaAPI.chatSend({ conversationId, content, model })
}
```

---

## 11. Citation Rendering

### 11.1 `CitationMarker.tsx`

Inline `[N]` superscript rendered inside answer text:

```typescript
// Answer text is stored as plain text with [N] markers inline.
// Renderer splits on /\[(\d+)\]/g and replaces with CitationMarker components.
<sup
  className="citation-marker text-accent cursor-pointer hover:underline"
  onClick={() => panelRef.current?.scrollToIndex(n - 1)}
>
  [{n}]
</sup>
```

### 11.2 `CitationPanel.tsx`

Collapsible panel below the assistant message bubble. Closed by default. Opens when a `[N]` marker is clicked or via the _"N sources ▶"_ toggle.

```
┌─ 2 sources ─────────────────────────────────────── [▲] ─┐
│                                                           │
│  [1] Fire Protection Specification                        │
│      Section 4.2 · Page 14 · Hospital Expansion          │
│      "…corridor assemblies shall achieve a minimum        │
│       fire rating of 2 hours per IBC 1020.1…"            │
│      [Open File]  [View in Knowledge]                     │
│                                                           │
│  [2] Building Code Compliance Report                      │
│      Section 7.1 · Page 3                                 │
│      "…sprinkler exemption does not apply to              │
│       occupancies classified as I-2…"                     │
│      [Open File]  [View in Knowledge]                     │
│                                                           │
│  ✓ Fully supported by documents                          │
└───────────────────────────────────────────────────────────┘
```

- `cited_text` from the Citations API response is shown as the excerpt (the exact sentence Claude drew from)
- **[Open File]** → `window.kordaAPI.fileIndexOpen(citation.filePath)`
- **[View in Knowledge]** → emits a custom event that `KnowledgeModule` listens to, navigating there with the chunk pre-selected in `ChunkPreview`
- Evidence status badge shown at the bottom of the panel
- Panel builds live as `chat:citation` events stream in — citations appear one by one
- On conversation reload, citations are hydrated from the JSON stored on the message row

### 11.3 `ChatMessage.tsx` modifications

```typescript
// After answer text, if message.mode === 'grounded' or 'grounded_fallback':
{message.citations && message.citations.length > 0 && (
  <CitationPanel
    citations={message.citations}
    evidenceStatus={message.evidenceStatus}
    ref={panelRef}
  />
)}
```

Streaming state: during Pass 2, `citations` accumulates via `onChatCitation` into local component state. On `onChatGroundedDone`, the final `citations` array replaces the accumulated state (same content, now complete).

---

## 12. Model Routing + Prompt Caching Summary

| Pass             | Model                                                  | Caching                                                              |
| ---------------- | ------------------------------------------------------ | -------------------------------------------------------------------- |
| Query rewriting  | `claude-haiku-4-5`                                     | None (tiny call)                                                     |
| Pass 1 tool loop | `claude-haiku-4-5`                                     | None (dynamic per search)                                            |
| Pass 2 answer    | User's configured model (default: `claude-sonnet-4-6`) | `cache_control: ephemeral` on system prompt + all Citation documents |

**Prompt caching benefit:** In a conversation where an engineer asks 5 consecutive questions about the same project, the system prompt (~500 tokens) and Citation documents (~10,000 tokens) are identical across turns. Cache hits reduce Pass 2 input cost by ~90% on turns 2–5.

**Model constants** (in `groundedChatService.ts`):

```typescript
const QUERY_REWRITE_MODEL = 'claude-haiku-4-5'
const TOOL_LOOP_MODEL = 'claude-haiku-4-5'
const MAX_TOOL_CALLS = 4
const MAX_CITATION_CHUNKS = 20
```

---

## 13. Testing Strategy

- `toolRegistry.test.ts` — register/execute/collectResults/reset, scope injection, dedup logic, inputSchema→input_schema mapping in getSchemas()
- `groundedChatService.test.ts` — mock Anthropic client; verify Pass 1 → chunk collection → Pass 2 call sequence; zero-chunk fallback path; query rewrite error fallback; evidence status extraction
- `llmClient.anthropic.test.ts` — `runToolLoop()` multi-turn mocked responses; max tool call cap; `streamWithTools()` no longer throws
- `ScopeSelector.test.tsx` — renders sources/projects, selection state, clear, sticky behaviour
- `CitationPanel.test.tsx` — renders citations, collapses/expands, live streaming additions, evidence badge
- `CitationMarker.test.tsx` — renders [N], click scrolls panel
- `ChatModule.test.tsx` (extend) — send routing (plain vs grounded), scope state management
- `ChatMessage.test.tsx` (extend) — grounded message renders CitationPanel; plain message does not; grounded_fallback shows amber notice

---

## 14. Complete File Map

### Create

```
src/main/
  groundedChatService.ts
  groundedChatService.test.ts
  toolRegistry.ts                   (includes searchKnowledgeBaseTool AgentTool definition)
  toolRegistry.test.ts

src/shared/contracts/
  tool-registry-contract.ts         (ToolRegistry interface + AnthropicToolSchema + EngineeringTool stub)

src/renderer/modules/chat/components/
  ScopeSelector.tsx
  ScopeSelector.test.tsx
  CitationPanel.tsx
  CitationPanel.test.tsx
  CitationMarker.tsx
  CitationMarker.test.tsx
```

### Modify

```
src/main/llmClient.ts
  — implement runToolLoop() (replaces NotImplementedError stub)
  — streamWithTools() delegates to runToolLoop() (compiles, available for future use)

src/main/chatService.ts
  — schema migration (mode, citations, grounded_chunk_count columns)
  — sendGrounded() method: delegates to groundedChatService.sendGrounded()
  — mapMessage() includes mode, citations, groundedChunkCount fields

src/main/main.ts
  — chat:send-grounded IPC handler → chatService.sendGrounded()
  — toolRegistry.register(searchKnowledgeBaseTool) on init
  — toolRegistry registered as singleton, injected into groundedChatService

src/shared/ipc-types.ts
  — import { EvidenceStatus } from './contracts/citation-contract'  ← add this import
  — GroundedSendParams, GroundedDonePayload types
  — ChatMessage extended: mode?, citations?, evidenceStatus?, groundedChunkCount?
  — KordaAPI: chatSendGrounded, onChatSearching, onChatCitation, onChatGroundedDone
  — IPC_CHANNELS: CHAT_SEND_GROUNDED, CHAT_SEARCHING, CHAT_CITATION, CHAT_GROUNDED_DONE

src/preload/preload.ts
  — chatSendGrounded invoke bridge
  — onChatSearching, onChatCitation, onChatGroundedDone listener bridges

src/renderer/modules/chat/ChatModule.tsx
  — scope state (scopeSourceIds, projectFilters)
  — send routing: plain vs grounded
  — onChatSearching → spinner state
  — onChatCitation → accumulate citations in streaming state
  — onChatGroundedDone → finalise citations

src/renderer/modules/chat/components/ChatInput.tsx
  — ScopeSelector integration
  — scope active indicator (teal dot on scope button)

src/renderer/modules/chat/components/ChatMessage.tsx
  — [N] marker injection via CitationMarker
  — CitationPanel below grounded messages
  — amber fallback notice for grounded_fallback mode
  — evidence status from GroundedDonePayload
```

### No new dependencies

Anthropic SDK 0.80 already supports:

- Tool use (`tools`, `tool_choice`, `tool_use` / `tool_result` content blocks)
- Citations API (`citations: { enabled: true }` on document content blocks, `citations_delta` stream events)
- Prompt caching (`cache_control: { type: 'ephemeral' }` on content blocks)

No `npm install` required.

---

## 15. Phase Boundaries

| Phase              | Deliverable                                                               | Depends on           |
| ------------------ | ------------------------------------------------------------------------- | -------------------- |
| **3A**             | Contracts · ingestion pipeline · FTS5 retrieval · Knowledge Search        | —                    |
| **3B** (this spec) | Two-pass grounded chat · Citations API · Scope selector · Tool registry   | 3A retrieval working |
| **3C**             | Voyage AI embeddings · sqlite-vec · hybrid BM25+vector · Cohere reranking | 3A + 3B stable       |
| **3D**             | Custom engineering tools (load calc, unit converter, spec lookup)         | 3B tool registry     |

---

## 16. Open Questions (resolved)

| Question                   | Decision                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Tool use vs Citations API  | Both: tool use for multi-hop retrieval (Pass 1), Citations API for final answer (Pass 2)  |
| Scope activation           | Per-message selector; no scope = plain chat                                               |
| Spinner vs live search log | Simple spinner during Pass 1                                                              |
| Zero results behaviour     | Graceful fallback: amber notice + plain stream                                            |
| Model for tool loop        | `claude-haiku-4-5` (fast + cheap; Sonnet for Pass 2 only)                                 |
| Prompt caching             | `cache_control: ephemeral` on system prompt + Citation documents in Pass 2                |
| Query rewriting            | Pre-Pass 1 Haiku call → 2-3 optimised queries                                             |
| Evidence status            | Extracted from hidden marker in Pass 2 answer; shown as badge in citation panel           |
| Custom tools               | `EngineeringTool` interface + `ToolRegistry` contract locked now; implemented in Phase 3D |
| Citations API SDK support  | Confirmed in `@anthropic-ai/sdk` 0.80 (already installed)                                 |
