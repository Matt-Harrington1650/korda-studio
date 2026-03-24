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
  onSourcesChange: (sourceIds: string[]) => void
  onProjectsChange: (projects: string[]) => void
  onSend: () => void
  onStop: () => void
}

export const ChatInput = forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput(
  {
    draft,
    isStreaming,
    model,
    selectedSourceIds,
    selectedProjects,
    onDraftChange,
    onModelChange,
    onSourcesChange,
    onProjectsChange,
    onSend,
    onStop,
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
          aria-label="Message input"
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
              onApply={() => {
                localRef.current?.focus()
              }}
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
