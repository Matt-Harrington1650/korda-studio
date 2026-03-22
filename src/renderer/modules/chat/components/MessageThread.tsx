import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChatMessage } from '../../../../shared/ipc-types'
import { MessageBubble } from './MessageBubble'

interface MessageThreadProps {
  isStreaming: boolean
  messages: ChatMessage[]
  pendingAssistantContent: string
  pendingAssistantId: string | null
  streamError: string | null
  onEditMessage: (messageId: string, content: string) => void | Promise<void>
  onRegenerate: () => void | Promise<void>
}

export function MessageThread({
  isStreaming,
  messages,
  pendingAssistantContent,
  pendingAssistantId,
  streamError,
  onEditMessage,
  onRegenerate,
}: MessageThreadProps) {
  const threadRef = useRef<HTMLDivElement | null>(null)
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true)
  const [showScrollPill, setShowScrollPill] = useState(false)
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')

  const pendingMessage = useMemo<ChatMessage | null>(() => {
    if (!pendingAssistantId) return null
    return {
      id: pendingAssistantId,
      conversationId: messages[0]?.conversationId ?? 'pending-conversation',
      role: 'assistant',
      content: pendingAssistantContent,
      createdAt: Date.now(),
    }
  }, [messages, pendingAssistantContent, pendingAssistantId])

  useEffect(() => {
    const container = threadRef.current
    if (!container) return

    const isNearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < 100

    if (autoScrollEnabled || isNearBottom) {
      if (typeof container.scrollTo === 'function') {
        container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
      } else {
        container.scrollTop = container.scrollHeight
      }
      setShowScrollPill(false)
      setAutoScrollEnabled(true)
    } else if (isStreaming || pendingAssistantContent) {
      setShowScrollPill(true)
    }
  }, [autoScrollEnabled, isStreaming, messages, pendingAssistantContent])

  const lastAssistantId = [...messages].reverse().find((message) => message.role === 'assistant')?.id
  const showEmptyState = messages.length === 0 && !pendingMessage

  return (
    <div className="relative flex h-full flex-col">
      <div
        ref={threadRef}
        onScroll={(event) => {
          const target = event.currentTarget
          const isNearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 100
          setAutoScrollEnabled(isNearBottom)
          if (isNearBottom) {
            setShowScrollPill(false)
          }
        }}
        className="flex-1 space-y-4 overflow-y-auto px-6 py-6"
      >
        {showEmptyState ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-2xl font-semibold text-text-primary">How can I help you today?</p>
            <p className="max-w-xl text-sm text-text-secondary">
              Ask KORDA&apos;s engineering assistant about specifications, calculations, document
              conventions, or project coordination.
            </p>
          </div>
        ) : null}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            editValue={editingValue}
            isEditing={editingMessageId === message.id}
            isLastAssistant={message.id === lastAssistantId}
            onBeginEdit={(nextMessage) => {
              setEditingMessageId(nextMessage.id)
              setEditingValue(nextMessage.content)
            }}
            onCancelEdit={() => {
              setEditingMessageId(null)
              setEditingValue('')
            }}
            onEditValueChange={setEditingValue}
            onRegenerate={() => void onRegenerate()}
            onSaveEdit={() => {
              if (editingMessageId && editingValue.trim()) {
                void onEditMessage(editingMessageId, editingValue)
              }
              setEditingMessageId(null)
              setEditingValue('')
            }}
          />
        ))}

        {pendingMessage && (
          <MessageBubble
            key={pendingMessage.id}
            message={pendingMessage}
            editValue=""
            errorMessage={streamError}
            isLastAssistant={false}
            isPending
            isEditing={false}
            onBeginEdit={() => {}}
            onCancelEdit={() => {}}
            onEditValueChange={() => {}}
            onRegenerate={() => void onRegenerate()}
            onSaveEdit={() => {}}
          />
        )}

        {isStreaming && !pendingAssistantContent && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-border bg-surface-raised/70 px-4 py-3 text-text-secondary">
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-secondary" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-secondary [animation-delay:120ms]" />
                <span className="h-2 w-2 animate-pulse rounded-full bg-text-secondary [animation-delay:240ms]" />
              </div>
            </div>
          </div>
        )}

        {streamError && !pendingMessage && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            <div>{streamError}</div>
            <button
              type="button"
              onClick={() => void onRegenerate()}
              className="mt-2 rounded border border-red-400/40 px-3 py-1 text-xs font-medium transition-colors hover:bg-red-500/10"
            >
              Retry
            </button>
          </div>
        )}
      </div>

      {showScrollPill && (
        <button
          type="button"
          onClick={() => {
            const container = threadRef.current
            if (!container) return
            if (typeof container.scrollTo === 'function') {
              container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' })
            } else {
              container.scrollTop = container.scrollHeight
            }
            setAutoScrollEnabled(true)
            setShowScrollPill(false)
          }}
          className="absolute bottom-5 left-1/2 -translate-x-1/2 rounded-full border border-border bg-surface-overlay px-4 py-2 text-sm text-text-primary shadow-lg"
        >
          ↓ New content
        </button>
      )}
    </div>
  )
}
