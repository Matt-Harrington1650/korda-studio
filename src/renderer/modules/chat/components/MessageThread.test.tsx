import { fireEvent, render, screen } from '@testing-library/react'
import type { ChatMessage } from '../../../../shared/ipc-types'
import { MessageThread } from './MessageThread'

const messages: ChatMessage[] = [
  {
    id: 'user-1',
    conversationId: 'conv-1',
    role: 'user',
    content: 'Please explain this.',
    createdAt: Date.now() - 20_000,
  },
  {
    id: 'assistant-1',
    conversationId: 'conv-1',
    role: 'assistant',
    content: '```ts\nconst answer = 42\n```',
    createdAt: Date.now() - 10_000,
    model: 'claude-sonnet-4-6',
    inputTokens: 10,
    outputTokens: 20,
  },
]

describe('MessageThread', () => {
  beforeEach(() => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
  })

  it('renders markdown code blocks and token counts', () => {
    render(
      <MessageThread
        isStreaming={false}
        messages={messages}
        pendingAssistantContent=""
        pendingAssistantId={null}
        streamError={null}
        onEditMessage={vi.fn()}
        onRegenerate={vi.fn()}
      />,
    )

    expect(
      screen.getAllByText((_, element) => element?.textContent?.trim() === 'const answer = 42'),
    ).not.toHaveLength(0)
    expect(screen.getByText(/↑ 10 ↓ 20/i)).toBeInTheDocument()
  })

  it('copies assistant content and regenerates the last assistant response', async () => {
    const onRegenerate = vi.fn()

    render(
      <MessageThread
        isStreaming={false}
        messages={messages}
        pendingAssistantContent=""
        pendingAssistantId={null}
        streamError={null}
        onEditMessage={vi.fn()}
        onRegenerate={onRegenerate}
      />,
    )

    fireEvent.click(screen.getByLabelText(/copy assistant message/i))
    fireEvent.click(screen.getByLabelText(/regenerate response/i))

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('```ts\nconst answer = 42\n```')
    expect(onRegenerate).toHaveBeenCalled()
  })

  it('edits a user message inline and saves it', () => {
    const onEditMessage = vi.fn()

    render(
      <MessageThread
        isStreaming={false}
        messages={messages}
        pendingAssistantContent=""
        pendingAssistantId={null}
        streamError={null}
        onEditMessage={onEditMessage}
        onRegenerate={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText(/edit user message/i))
    fireEvent.change(screen.getByDisplayValue('Please explain this.'), {
      target: { value: 'Please explain this in detail.' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save edit/i }))

    expect(onEditMessage).toHaveBeenCalledWith('user-1', 'Please explain this in detail.')
  })
})
