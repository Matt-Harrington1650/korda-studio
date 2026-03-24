import { useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { Copy, Pencil, RefreshCcw } from 'lucide-react'
import { humanizeAge } from '@shared/utils/humanizeAge'
import type { ChatMessage } from '../../../../shared/ipc-types'
import { CitationMarker } from './CitationMarker'
import { CitationPanel, type CitationPanelHandle } from './CitationPanel'

interface MessageBubbleProps {
  message: ChatMessage
  editValue: string
  isEditing: boolean
  isLastAssistant: boolean
  isPending?: boolean
  errorMessage?: string | null
  onBeginEdit: (message: ChatMessage) => void
  onCancelEdit: () => void
  onEditValueChange: (value: string) => void
  onRegenerate: () => void
  onSaveEdit: () => void
}

export function MessageBubble({
  message,
  editValue,
  isEditing,
  isLastAssistant,
  isPending = false,
  errorMessage,
  onBeginEdit,
  onCancelEdit,
  onEditValueChange,
  onRegenerate,
  onSaveEdit,
}: MessageBubbleProps) {
  const isAssistant = message.role === 'assistant'
  const panelRef = useRef<CitationPanelHandle | null>(null)

  const renderCitationText = (content: string) =>
    content.split(/(\[\d+\])/g).map((part, index) => {
      const match = /^\[(\d+)\]$/.exec(part)
      if (!match) {
        return <span key={`text-${index}`}>{part}</span>
      }

      const citationIndex = Number(match[1])
      return (
        <CitationMarker
          key={`citation-${index}`}
          index={citationIndex}
          onCitationClick={() => panelRef.current?.scrollToIndex(citationIndex - 1)}
        />
      )
    })

  const renderPlainAssistantContent = () => (
    <div className="prose prose-invert max-w-none text-sm prose-p:my-2 prose-pre:my-0 prose-code:text-[13px]">
      <ReactMarkdown
        components={{
          code(props) {
            const { className, children } = props
            const match = /language-(\w+)/.exec(className || '')

            if (match) {
              const codeText = String(children).replace(/\n$/, '')

              return (
                <div className="my-3 overflow-hidden rounded-xl border border-border bg-surface-base">
                  <div className="flex items-center justify-between border-b border-border px-3 py-2 text-[11px] uppercase tracking-widest text-text-secondary">
                    <span>{match[1]}</span>
                    <button
                      type="button"
                      aria-label="Copy code block"
                      onClick={() => void navigator.clipboard.writeText(codeText)}
                      className="rounded px-2 py-1 transition-colors hover:bg-white/5 hover:text-text-primary"
                    >
                      Copy
                    </button>
                  </div>
                  <SyntaxHighlighter
                    PreTag="div"
                    language={match[1]}
                    style={oneDark}
                    customStyle={{ margin: 0, borderRadius: 0, background: 'transparent' }}
                  >
                    {codeText}
                  </SyntaxHighlighter>
                </div>
              )
            }

            return <code className={className}>{children}</code>
          },
        }}
      >
        {message.content}
      </ReactMarkdown>
    </div>
  )

  const renderGroundedAssistantContent = () => (
    <div className="space-y-3">
      {message.mode === 'grounded_fallback' && (
        <div className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
          No matching documents found in selected scope - answering from general knowledge
        </div>
      )}
      <div className="whitespace-pre-wrap text-sm leading-7 text-text-primary">
        {renderCitationText(message.content)}
      </div>
      {message.citations && message.citations.length > 0 && (
        <CitationPanel
          ref={panelRef}
          citations={message.citations}
          evidenceStatus={message.evidenceStatus}
        />
      )}
    </div>
  )

  return (
    <article
      className={`group flex ${isAssistant ? 'justify-start' : 'justify-end'}`}
      title={new Date(message.createdAt).toLocaleString()}
    >
      <div
        className={`max-w-[90%] rounded-2xl border px-4 py-3 shadow-sm ${
          isAssistant
            ? 'w-full border-border bg-surface-raised/70 text-text-primary'
            : 'border-brand/30 bg-brand-muted/80 text-text-primary'
        }`}
      >
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="text-[11px] font-medium uppercase tracking-widest text-text-secondary">
            {isAssistant ? 'Assistant' : 'You'}
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden text-[11px] text-text-secondary sm:group-hover:inline">
              {humanizeAge(Math.max(0, Date.now() - message.createdAt))}
            </span>
            {isAssistant ? (
              <>
                <button
                  type="button"
                  aria-label="Copy assistant message"
                  onClick={() => void navigator.clipboard.writeText(message.content)}
                  className="rounded p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
                >
                  <Copy size={14} />
                </button>
                {isLastAssistant && !isPending && (
                  <button
                    type="button"
                    aria-label="Regenerate response"
                    onClick={onRegenerate}
                    className="rounded p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
                  >
                    <RefreshCcw size={14} />
                  </button>
                )}
              </>
            ) : (
              !isEditing && (
                <button
                  type="button"
                  aria-label="Edit user message"
                  onClick={() => onBeginEdit(message)}
                  className="rounded p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
                >
                  <Pencil size={14} />
                </button>
              )
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="space-y-3">
            <textarea
              value={editValue}
              rows={4}
              onChange={(event) => onEditValueChange(event.target.value)}
              className="w-full rounded border border-brand bg-surface-base px-3 py-2 text-sm text-text-primary outline-none"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={onCancelEdit}
                className="rounded border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={onSaveEdit}
                className="rounded bg-brand px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
              >
                Save Edit
              </button>
            </div>
          </div>
        ) : isAssistant ? (
          message.mode === 'grounded' || message.mode === 'grounded_fallback' ? (
            renderGroundedAssistantContent()
          ) : (
            renderPlainAssistantContent()
          )
        ) : (
          <div className="whitespace-pre-wrap text-sm">{message.content}</div>
        )}

        {isAssistant &&
          !isPending &&
          message.inputTokens !== undefined &&
          message.outputTokens !== undefined && (
            <div className="mt-3 text-xs text-text-secondary">
              ↑ {message.inputTokens} ↓ {message.outputTokens}
            </div>
          )}

        {errorMessage && <div className="mt-3 text-sm text-red-300">{errorMessage}</div>}
      </div>
    </article>
  )
}
