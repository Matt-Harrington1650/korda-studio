import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import type {
  ChatMessage,
  Conversation,
  GroundedDonePayload,
  GroundedSendParams,
  SendParams,
} from '../../../shared/ipc-types'
import ChatModule from './ChatModule'

describe('ChatModule', () => {
  let conversations: Conversation[]
  let messagesByConversation: Record<string, ChatMessage[]>
  let tokenHandler: ((token: string) => void) | undefined
  let searchingHandler: ((messageId: string) => void) | undefined
  let groundedDoneHandler: ((payload: GroundedDonePayload) => void) | undefined
  let doneHandler:
    | ((data: { messageId: string; inputTokens: number; outputTokens: number }) => void)
    | undefined
  let errorHandler: ((message: string) => void) | undefined
  let sendCount: number

  const chatConversationsList = vi.fn(async () => conversations)
  const chatConversationGet = vi.fn(async (id: string) => ({
    conversation: conversations.find((conversation) => conversation.id === id)!,
    messages: messagesByConversation[id] ?? [],
  }))
  const chatConversationNew = vi.fn(async () => {
    const conversation: Conversation = {
      id: `conv-${conversations.length + 1}`,
      title: 'New Conversation',
      model: 'claude-sonnet-4-6',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    conversations = [conversation, ...conversations]
    messagesByConversation[conversation.id] = []
    return conversation
  })
  const chatSend = vi.fn(async ({ conversationId, content, model }: SendParams) => {
    sendCount += 1
    const userMessage: ChatMessage = {
      id: `user-${sendCount}`,
      conversationId,
      role: 'user',
      content,
      createdAt: Date.now(),
    }
    const conversation = conversations.find((entry) => entry.id === conversationId)
    if (conversation) {
      conversation.title = content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New Conversation'
      conversation.model = model
      conversation.updatedAt = Date.now()
    }
    messagesByConversation[conversationId] = [
      ...(messagesByConversation[conversationId] ?? []),
      userMessage,
    ]
    return { messageId: `assistant-${sendCount}` }
  })
  const chatSendGrounded = vi.fn(async ({ conversationId, content, model }: GroundedSendParams) => {
    sendCount += 1
    const userMessage: ChatMessage = {
      id: `user-${sendCount}`,
      conversationId,
      role: 'user',
      content,
      createdAt: Date.now(),
      mode: 'grounded',
    }
    const conversation = conversations.find((entry) => entry.id === conversationId)
    if (conversation) {
      conversation.title = content.replace(/\s+/g, ' ').trim().slice(0, 60) || 'New Conversation'
      conversation.model = model
      conversation.updatedAt = Date.now()
    }
    messagesByConversation[conversationId] = [
      ...(messagesByConversation[conversationId] ?? []),
      userMessage,
    ]
    return { messageId: `assistant-grounded-${sendCount}` }
  })
  const chatStop = vi.fn().mockResolvedValue(undefined)
  const chatConversationDelete = vi.fn(async (id: string) => {
    conversations = conversations.filter((conversation) => conversation.id !== id)
    delete messagesByConversation[id]
  })
  const chatConversationRename = vi.fn(async (id: string, title: string) => {
    const conversation = conversations.find((entry) => entry.id === id)
    if (conversation) {
      conversation.title = title
    }
  })
  const chatMessagesDeleteFrom = vi.fn(async (conversationId: string, fromMessageId: string) => {
    const items = messagesByConversation[conversationId] ?? []
    const index = items.findIndex((message) => message.id === fromMessageId)
    if (index >= 0) {
      messagesByConversation[conversationId] = items.slice(0, index)
    }
  })

  beforeEach(() => {
    sendCount = 0
    conversations = [
      {
        id: 'conv-1',
        title: 'Existing conversation',
        model: 'claude-sonnet-4-6',
        createdAt: Date.now() - 60_000,
        updatedAt: Date.now() - 30_000,
      },
    ]
    messagesByConversation = {
      'conv-1': [],
    }
    tokenHandler = undefined
    searchingHandler = undefined
    groundedDoneHandler = undefined
    doneHandler = undefined
    errorHandler = undefined

    vi.stubGlobal('kordaAPI', {
      chatConversationsList,
      chatConversationGet,
      chatConversationNew,
      chatConversationDelete,
      chatConversationRename,
      chatMessagesDeleteFrom,
      chatSend,
      chatSendGrounded,
      chatStop,
      chatTestConnection: vi.fn().mockResolvedValue({ ok: true }),
      chatApiKeySource: vi.fn().mockResolvedValue('store'),
      fileIndexSourcesList: vi.fn().mockResolvedValue([
        {
          id: 'src1',
          displayName: 'Engineering Shares',
          path: '/eng',
          type: 'local',
          enabled: true,
        },
      ]),
      fileIndexProjectsList: vi.fn().mockResolvedValue(['Hospital Expansion']),
      onChatToken: vi.fn((cb: (token: string) => void) => {
        tokenHandler = cb
        return () => {}
      }),
      onChatDone: vi.fn(
        (cb: (data: { messageId: string; inputTokens: number; outputTokens: number }) => void) => {
          doneHandler = cb
          return () => {}
        },
      ),
      onChatSearching: vi.fn((cb: (messageId: string) => void) => {
        searchingHandler = cb
        return () => {}
      }),
      onChatCitation: vi.fn(() => () => {}),
      onChatGroundedDone: vi.fn((cb: (payload: GroundedDonePayload) => void) => {
        groundedDoneHandler = cb
        return () => {}
      }),
      onChatError: vi.fn((cb: (message: string) => void) => {
        errorHandler = cb
        return () => {}
      }),
    })

    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  function renderModule() {
    return render(
      <MemoryRouter>
        <ChatModule />
      </MemoryRouter>,
    )
  }

  it('renders the conversation list from chatConversationsList', async () => {
    renderModule()

    expect(await screen.findByText('Existing conversation')).toBeInTheDocument()
  })

  it('creates a new conversation and shows the empty thread', async () => {
    conversations = []
    renderModule()

    fireEvent.click(screen.getByRole('button', { name: /new chat/i }))

    await waitFor(() => expect(chatConversationNew).toHaveBeenCalled())
    expect(screen.getByText(/how can i help you today/i)).toBeInTheDocument()
  })

  it('sends a message, streams tokens, and appends the final assistant reply', async () => {
    conversations = []
    renderModule()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Explain the revision history.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(chatSend).toHaveBeenCalled())

    await act(async () => {
      tokenHandler?.('Draft ')
      tokenHandler?.('reply')
    })
    await waitFor(() => expect(screen.getByText('Draft reply')).toBeInTheDocument())

    messagesByConversation['conv-1'] = [
      {
        id: 'user-1',
        conversationId: 'conv-1',
        role: 'user',
        content: 'Explain the revision history.',
        createdAt: Date.now(),
      },
      {
        id: 'assistant-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Draft reply',
        createdAt: Date.now(),
        model: 'claude-sonnet-4-6',
        inputTokens: 12,
        outputTokens: 24,
      },
    ]
    await act(async () => {
      doneHandler?.({ messageId: 'assistant-1', inputTokens: 12, outputTokens: 24 })
    })

    expect(await screen.findByText(/↑ 12 ↓ 24/i)).toBeInTheDocument()
    expect(screen.getByText('Draft reply')).toBeInTheDocument()
  })

  it('calls chatStop while streaming', async () => {
    conversations = []
    renderModule()

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Stop this response' },
    })
    fireEvent.click(screen.getByRole('button', { name: /send message/i }))

    await waitFor(() => expect(chatSend).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /stop response/i }))

    expect(chatStop).toHaveBeenCalled()
  })

  it('copies assistant content to the clipboard', async () => {
    messagesByConversation['conv-1'] = [
      {
        id: 'assistant-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Copied answer',
        createdAt: Date.now(),
        model: 'claude-sonnet-4-6',
        inputTokens: 3,
        outputTokens: 4,
      },
    ]

    renderModule()

    fireEvent.click(await screen.findByLabelText(/copy assistant message/i))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('Copied answer')
  })

  it('edits a user message, deletes downstream messages, and re-sends it', async () => {
    messagesByConversation['conv-1'] = [
      {
        id: 'user-1',
        conversationId: 'conv-1',
        role: 'user',
        content: 'Old request',
        createdAt: Date.now() - 2_000,
      },
      {
        id: 'assistant-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Old answer',
        createdAt: Date.now() - 1_000,
        model: 'claude-sonnet-4-6',
        inputTokens: 8,
        outputTokens: 9,
      },
    ]

    renderModule()

    fireEvent.click(await screen.findByLabelText(/edit user message/i))
    fireEvent.change(screen.getByDisplayValue('Old request'), {
      target: { value: 'Updated request' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save edit/i }))

    await waitFor(() => {
      expect(chatMessagesDeleteFrom).toHaveBeenCalledWith('conv-1', 'user-1')
      expect(chatSend).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        content: 'Updated request',
        model: 'claude-sonnet-4-6',
      })
    })
  })

  it('shows inline stream errors', async () => {
    renderModule()

    await waitFor(() => expect(window.kordaAPI.onChatError).toHaveBeenCalled())

    await act(async () => {
      errorHandler?.('Network error')
    })

    expect(await screen.findByText(/network error/i)).toBeInTheDocument()
  })

  it('routes to chatSendGrounded when scope sources are selected', async () => {
    renderModule()

    await waitFor(() => expect(chatConversationsList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /scope/i }))
    fireEvent.click(await screen.findByLabelText('Engineering Shares'))
    fireEvent.click(screen.getByRole('button', { name: /search these/i }))

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'fire rating corridor' },
    })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    await waitFor(() =>
      expect(chatSendGrounded).toHaveBeenCalledWith(
        expect.objectContaining({
          content: 'fire rating corridor',
          scopeSourceIds: ['src1'],
        }),
      ),
    )
    expect(chatSend).not.toHaveBeenCalled()
  })

  it('uses grounded completion events to replace streamed content with the stripped final text', async () => {
    renderModule()

    await waitFor(() => expect(chatConversationsList).toHaveBeenCalled())

    fireEvent.click(screen.getByRole('button', { name: /scope/i }))
    fireEvent.click(await screen.findByLabelText('Engineering Shares'))
    fireEvent.click(screen.getByRole('button', { name: /search these/i }))

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'fire rating corridor' },
    })
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    await waitFor(() => expect(chatSendGrounded).toHaveBeenCalled())

    await act(async () => {
      searchingHandler?.('assistant-grounded-1')
      tokenHandler?.('Draft answer <!--evidence:supported-->')
    })

    expect(screen.getByText(/draft answer/i)).toBeInTheDocument()

    messagesByConversation['conv-1'] = [
      {
        id: 'user-1',
        conversationId: 'conv-1',
        role: 'user',
        content: 'fire rating corridor',
        createdAt: Date.now(),
        mode: 'grounded',
      },
      {
        id: 'assistant-grounded-1',
        conversationId: 'conv-1',
        role: 'assistant',
        content: 'Draft answer',
        createdAt: Date.now(),
        mode: 'grounded',
        evidenceStatus: 'supported',
        groundedChunkCount: 1,
        inputTokens: 12,
        outputTokens: 34,
      },
    ]

    await act(async () => {
      groundedDoneHandler?.({
        messageId: 'assistant-grounded-1',
        citations: [],
        evidenceStatus: 'supported',
        inputTokens: 12,
        outputTokens: 34,
        chunkCount: 1,
        finalText: 'Draft answer',
      })
    })

    expect(await screen.findByText('Draft answer')).toBeInTheDocument()
    expect(screen.queryByText(/evidence:supported/i)).not.toBeInTheDocument()
  })
})
