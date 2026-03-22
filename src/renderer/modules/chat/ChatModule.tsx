import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { ChatMessage, Conversation } from '../../../shared/ipc-types'
import { ChatInput } from './components/ChatInput'
import { ConversationList } from './components/ConversationList'
import { MessageThread } from './components/MessageThread'
import { CHAT_MODEL_OPTIONS } from './chatModels'

type ApiKeySource = 'env' | 'store' | 'none'

export default function ChatModule() {
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const activeConversationIdRef = useRef<string | null>(null)

  const [activeConversationId, setActiveConversationId] = useState<string | null>(null)
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [draft, setDraft] = useState('')
  const [model, setModel] = useState(CHAT_MODEL_OPTIONS[1].id)
  const [pendingAssistantId, setPendingAssistantId] = useState<string | null>(null)
  const [pendingAssistantContent, setPendingAssistantContent] = useState('')
  const [isStreaming, setIsStreaming] = useState(false)
  const [streamError, setStreamError] = useState<string | null>(null)
  const [apiKeySource, setApiKeySource] = useState<ApiKeySource>('none')

  useEffect(() => {
    activeConversationIdRef.current = activeConversationId
  }, [activeConversationId])

  const loadConversation = useCallback(async (conversationId: string) => {
    const snapshot = await window.kordaAPI.chatConversationGet(conversationId)
    setMessages(snapshot.messages)
    setModel(snapshot.conversation.model)
  }, [])

  const reloadConversations = useCallback(async (preferredConversationId?: string | null) => {
    const nextConversations = await window.kordaAPI.chatConversationsList()
    setConversations(nextConversations)

    const activeId = preferredConversationId ?? activeConversationIdRef.current
    const nextActiveConversationId =
      (activeId && nextConversations.some((conversation) => conversation.id === activeId)
        ? activeId
        : nextConversations[0]?.id) ?? null

    setActiveConversationId(nextActiveConversationId)

    if (!nextActiveConversationId) {
      setMessages([])
    }
  }, [])

  useEffect(() => {
    void reloadConversations()
    void window.kordaAPI
      .chatApiKeySource()
      .then(setApiKeySource)
      .catch(() => setApiKeySource('none'))

    const unsubscribeToken = window.kordaAPI.onChatToken((token) => {
      setPendingAssistantContent((current) => current + token)
      setIsStreaming(true)
    })
    const unsubscribeDone = window.kordaAPI.onChatDone(() => {
      const currentConversationId = activeConversationIdRef.current
      setIsStreaming(false)
      setStreamError(null)
      setPendingAssistantId(null)
      setPendingAssistantContent('')
      if (currentConversationId) {
        void loadConversation(currentConversationId)
      }
      void reloadConversations(currentConversationId)
    })
    const unsubscribeError = window.kordaAPI.onChatError((message) => {
      if (message.toLowerCase().includes('abort')) {
        setIsStreaming(false)
        return
      }
      setIsStreaming(false)
      setStreamError(message)
    })

    return () => {
      unsubscribeToken()
      unsubscribeDone()
      unsubscribeError()
    }
  }, [loadConversation, reloadConversations])

  useEffect(() => {
    if (activeConversationId) {
      void loadConversation(activeConversationId)
    }
  }, [activeConversationId, loadConversation])

  const createConversation = useCallback(async () => {
    const conversation = await window.kordaAPI.chatConversationNew()
    setConversations((current) => [conversation, ...current])
    setActiveConversationId(conversation.id)
    setMessages([])
    setModel(conversation.model)
    setPendingAssistantId(null)
    setPendingAssistantContent('')
    setStreamError(null)
    inputRef.current?.focus()
    return conversation.id
  }, [])

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

      const { messageId } = await window.kordaAPI.chatSend({
        conversationId,
        content: trimmedContent,
        model,
      })

      const snapshot = await window.kordaAPI.chatConversationGet(conversationId)
      setMessages(snapshot.messages)
      setPendingAssistantId(messageId)
      await reloadConversations(conversationId)
    },
    [createConversation, model, reloadConversations],
  )

  const handleSend = useCallback(async () => {
    const nextDraft = draft
    setDraft('')
    await sendMessage(nextDraft)
  }, [draft, sendMessage])

  const handleDeleteConversation = useCallback(
    async (conversationId: string) => {
      const wasActive = activeConversationIdRef.current === conversationId
      await window.kordaAPI.chatConversationDelete(conversationId)
      setPendingAssistantId(null)
      setPendingAssistantContent('')
      setStreamError(null)
      await reloadConversations(wasActive ? null : activeConversationIdRef.current)
    },
    [reloadConversations],
  )

  const handleRenameConversation = useCallback(async (conversationId: string, title: string) => {
    await window.kordaAPI.chatConversationRename(conversationId, title)
    setConversations((current) =>
      current.map((conversation) =>
        conversation.id === conversationId ? { ...conversation, title } : conversation,
      ),
    )
  }, [])

  const handleEditMessage = useCallback(
    async (messageId: string, content: string) => {
      const conversationId = activeConversationIdRef.current
      if (!conversationId) return

      await window.kordaAPI.chatMessagesDeleteFrom(conversationId, messageId)
      setPendingAssistantId(null)
      setPendingAssistantContent('')
      setStreamError(null)
      await loadConversation(conversationId)
      await reloadConversations(conversationId)
      await sendMessage(content, conversationId)
    },
    [loadConversation, reloadConversations, sendMessage],
  )

  const handleRegenerate = useCallback(async () => {
    const conversationId = activeConversationIdRef.current
    if (!conversationId) return

    const lastUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    if (!lastUserMessage) return

    const lastAssistantMessage = [...messages].reverse().find(
      (message) => message.role === 'assistant',
    )
    const fromMessageId =
      streamError || !lastAssistantMessage ? lastUserMessage.id : lastAssistantMessage.id

    await window.kordaAPI.chatMessagesDeleteFrom(conversationId, fromMessageId)
    setPendingAssistantId(null)
    setPendingAssistantContent('')
    setStreamError(null)
    await loadConversation(conversationId)
    await reloadConversations(conversationId)
    await sendMessage(lastUserMessage.content, conversationId)
  }, [loadConversation, messages, reloadConversations, sendMessage, streamError])

  const showApiKeyBanner =
    apiKeySource === 'none' || /api key|authentication|unauthorized/i.test(streamError ?? '')

  return (
    <div className="flex h-full">
      <ConversationList
        conversations={conversations}
        activeConversationId={activeConversationId}
        onDeleteConversation={handleDeleteConversation}
        onNewConversation={() => {
          void createConversation()
        }}
        onRenameConversation={handleRenameConversation}
        onSelectConversation={setActiveConversationId}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        {showApiKeyBanner && (
          <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-3 text-sm text-amber-100">
            <div className="flex flex-wrap items-center gap-2">
              <span>
                {apiKeySource === 'none'
                  ? 'Anthropic API key missing.'
                  : 'Anthropic API key issue detected.'}
              </span>
              <Link to="/settings/ai" className="font-medium underline hover:text-white">
                Open Settings → AI
              </Link>
            </div>
          </div>
        )}

        <div className="min-h-0 flex-1">
          <MessageThread
            isStreaming={isStreaming}
            messages={messages}
            pendingAssistantContent={pendingAssistantContent}
            pendingAssistantId={pendingAssistantId}
            streamError={streamError}
            onEditMessage={handleEditMessage}
            onRegenerate={handleRegenerate}
          />
        </div>

        <ChatInput
          ref={inputRef}
          draft={draft}
          isStreaming={isStreaming}
          model={model}
          onDraftChange={setDraft}
          onModelChange={setModel}
          onSend={() => void handleSend()}
          onStop={() => {
            void window.kordaAPI.chatStop()
            setIsStreaming(false)
          }}
        />
      </section>
    </div>
  )
}
