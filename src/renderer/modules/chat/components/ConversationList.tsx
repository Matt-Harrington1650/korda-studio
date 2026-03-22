import { useMemo, useState } from 'react'
import { Pencil, Search, Trash2 } from 'lucide-react'
import { humanizeAge } from '@shared/utils/humanizeAge'
import type { Conversation } from '../../../../shared/ipc-types'
import { getModelLabel } from '../chatModels'

interface ConversationListProps {
  conversations: Conversation[]
  activeConversationId: string | null
  onDeleteConversation: (id: string) => void | Promise<void>
  onNewConversation: () => void | Promise<void>
  onRenameConversation: (id: string, title: string) => void | Promise<void>
  onSelectConversation: (id: string) => void
}

export function ConversationList({
  conversations,
  activeConversationId,
  onDeleteConversation,
  onNewConversation,
  onRenameConversation,
  onSelectConversation,
}: ConversationListProps) {
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState('')

  const filteredConversations = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    if (!normalized) return conversations
    return conversations.filter((conversation) =>
      conversation.title.toLowerCase().includes(normalized),
    )
  }, [conversations, query])

  const submitRename = (id: string) => {
    const nextTitle = editingTitle.trim()
    if (nextTitle) {
      void onRenameConversation(id, nextTitle)
    }
    setEditingId(null)
    setEditingTitle('')
  }

  return (
    <aside className="flex h-full w-80 flex-col border-r border-border bg-surface-raised/60">
      <div className="border-b border-border p-4">
        <button
          type="button"
          onClick={() => void onNewConversation()}
          className="w-full rounded bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover"
        >
          New Chat
        </button>

        <label className="mt-3 flex items-center gap-2 rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-secondary">
          <Search size={14} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            className="w-full bg-transparent text-text-primary outline-none placeholder:text-text-secondary"
          />
        </label>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {filteredConversations.length === 0 ? (
          <div className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-text-secondary">
            No conversations yet
          </div>
        ) : (
          <ul className="space-y-1">
            {filteredConversations.map((conversation) => {
              const isActive = conversation.id === activeConversationId

              return (
                <li key={conversation.id}>
                  <div
                    className={`group rounded-lg border px-3 py-2 transition-colors ${
                      isActive
                        ? 'border-brand bg-brand-muted/60'
                        : 'border-transparent hover:border-border hover:bg-surface-base/70'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <button
                        type="button"
                        onClick={() => onSelectConversation(conversation.id)}
                        className="min-w-0 flex-1 text-left"
                      >
                        {editingId === conversation.id ? (
                          <input
                            autoFocus
                            value={editingTitle}
                            onBlur={() => submitRename(conversation.id)}
                            onChange={(event) => setEditingTitle(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                submitRename(conversation.id)
                              }
                              if (event.key === 'Escape') {
                                setEditingId(null)
                                setEditingTitle('')
                              }
                            }}
                            className="w-full rounded border border-brand bg-surface-base px-2 py-1 text-sm text-text-primary outline-none"
                          />
                        ) : (
                          <>
                            <div className="truncate text-sm font-medium text-text-primary">
                              {conversation.title}
                            </div>
                            <div className="mt-1 flex items-center gap-2 text-[11px] text-text-secondary">
                              <span>
                                {humanizeAge(Math.max(0, Date.now() - conversation.updatedAt))}
                              </span>
                              <span className="rounded border border-border px-1.5 py-0.5">
                                {getModelLabel(conversation.model)}
                              </span>
                            </div>
                          </>
                        )}
                      </button>

                      <div className="flex shrink-0 items-center gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                        <button
                          type="button"
                          aria-label={`Rename conversation ${conversation.title}`}
                          onClick={() => {
                            setEditingId(conversation.id)
                            setEditingTitle(conversation.title)
                          }}
                          className="rounded p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          aria-label={`Delete conversation ${conversation.title}`}
                          onClick={() => {
                            if (confirm(`Delete "${conversation.title}"?`)) {
                              void onDeleteConversation(conversation.id)
                            }
                          }}
                          className="rounded p-1 text-text-secondary transition-colors hover:bg-white/5 hover:text-red-300"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </aside>
  )
}
