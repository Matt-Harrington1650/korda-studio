import { fireEvent, render, screen } from '@testing-library/react'
import type { Conversation } from '../../../../shared/ipc-types'
import { ConversationList } from './ConversationList'

const conversations: Conversation[] = [
  {
    id: 'conv-1',
    title: 'IFC checklist',
    model: 'claude-sonnet-4-6',
    createdAt: Date.now() - 60_000,
    updatedAt: Date.now() - 30_000,
  },
  {
    id: 'conv-2',
    title: 'Drawing revision notes',
    model: 'claude-3-5-haiku-20241022',
    createdAt: Date.now() - 120_000,
    updatedAt: Date.now() - 90_000,
  },
]

describe('ConversationList', () => {
  it('renders conversation titles and relative timestamps', () => {
    render(
      <ConversationList
        conversations={conversations}
        activeConversationId="conv-1"
        onDeleteConversation={vi.fn()}
        onNewConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
      />,
    )

    expect(screen.getByText('IFC checklist')).toBeInTheDocument()
    expect(screen.getByText('Drawing revision notes')).toBeInTheDocument()
    expect(screen.getAllByText(/ago|just now/i).length).toBeGreaterThan(0)
  })

  it('calls delete after confirmation', () => {
    const onDeleteConversation = vi.fn()
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    render(
      <ConversationList
        conversations={conversations}
        activeConversationId="conv-1"
        onDeleteConversation={onDeleteConversation}
        onNewConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText(/delete conversation ifc checklist/i))

    expect(onDeleteConversation).toHaveBeenCalledWith('conv-1')
  })

  it('calls rename on Enter', () => {
    const onRenameConversation = vi.fn()

    render(
      <ConversationList
        conversations={conversations}
        activeConversationId="conv-1"
        onDeleteConversation={vi.fn()}
        onNewConversation={vi.fn()}
        onRenameConversation={onRenameConversation}
        onSelectConversation={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByLabelText(/rename conversation ifc checklist/i))
    const input = screen.getByDisplayValue('IFC checklist')
    fireEvent.change(input, { target: { value: 'Updated title' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(onRenameConversation).toHaveBeenCalledWith('conv-1', 'Updated title')
  })

  it('filters conversations by search query', () => {
    render(
      <ConversationList
        conversations={conversations}
        activeConversationId="conv-1"
        onDeleteConversation={vi.fn()}
        onNewConversation={vi.fn()}
        onRenameConversation={vi.fn()}
        onSelectConversation={vi.fn()}
      />,
    )

    fireEvent.change(screen.getByPlaceholderText(/search conversations/i), {
      target: { value: 'revision' },
    })

    expect(screen.queryByText('IFC checklist')).not.toBeInTheDocument()
    expect(screen.getByText('Drawing revision notes')).toBeInTheDocument()
  })
})
