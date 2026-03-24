import { fireEvent, render, screen } from '@testing-library/react'
import type { ChatMessage } from '../../../../shared/ipc-types'
import { MessageBubble } from './MessageBubble'

describe('MessageBubble', () => {
  beforeEach(() => {
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    })
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    })
    vi.stubGlobal('kordaAPI', {
      fileIndexOpen: vi.fn().mockResolvedValue('opened'),
    })
  })

  it('renders citation markers and opens the citation panel for grounded assistant messages', () => {
    const message: ChatMessage = {
      id: 'assistant-1',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'The corridor requires a 2 hour rating [1].',
      createdAt: Date.now(),
      mode: 'grounded',
      citations: [
        {
          citationIndex: 1,
          fileId: 7,
          filePath: '/docs/fire-rating.pdf',
          fileName: 'fire-rating.pdf',
          chunkId: 'chunk-1',
          excerpt: 'corridor assemblies shall achieve 2 hours',
          pageNumber: 5,
          sectionTitle: 'Fire Rating',
          sourceId: 'src1',
        },
      ],
      evidenceStatus: 'supported',
    }

    render(
      <MessageBubble
        message={message}
        editValue=""
        isEditing={false}
        isLastAssistant
        onBeginEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onEditValueChange={vi.fn()}
        onRegenerate={vi.fn()}
        onSaveEdit={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '[1]' }))

    expect(screen.getByText(/fully supported by documents/i)).toBeInTheDocument()
    expect(screen.getByText('fire-rating.pdf')).toBeInTheDocument()
  })

  it('shows the grounded fallback notice when documents do not support the answer', () => {
    const message: ChatMessage = {
      id: 'assistant-2',
      conversationId: 'conv-1',
      role: 'assistant',
      content: 'General answer without document support.',
      createdAt: Date.now(),
      mode: 'grounded_fallback',
    }

    render(
      <MessageBubble
        message={message}
        editValue=""
        isEditing={false}
        isLastAssistant
        onBeginEdit={vi.fn()}
        onCancelEdit={vi.fn()}
        onEditValueChange={vi.fn()}
        onRegenerate={vi.fn()}
        onSaveEdit={vi.fn()}
      />,
    )

    expect(screen.getByText(/no matching documents found in selected scope/i)).toBeInTheDocument()
  })
})
