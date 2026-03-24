import { fireEvent, render, screen } from '@testing-library/react'
import { ChatInput } from './ChatInput'

describe('ChatInput', () => {
  beforeEach(() => {
    vi.stubGlobal('kordaAPI', {
      fileIndexSourcesList: vi.fn().mockResolvedValue([]),
      fileIndexProjectsList: vi.fn().mockResolvedValue([]),
    })
  })

  it('sends on Enter and not on Shift+Enter', () => {
    const onSend = vi.fn()

    render(
      <ChatInput
        draft="Hello"
        isStreaming={false}
        model="claude-sonnet-4-6"
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        selectedSourceIds={[]}
        selectedProjects={[]}
        onSourcesChange={vi.fn()}
        onProjectsChange={vi.fn()}
        onSend={onSend}
        onStop={vi.fn()}
      />,
    )

    const input = screen.getByRole('textbox')
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true })

    expect(onSend).toHaveBeenCalledTimes(1)
  })

  it('calls stop when streaming', () => {
    const onStop = vi.fn()

    render(
      <ChatInput
        draft=""
        isStreaming
        model="claude-sonnet-4-6"
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        selectedSourceIds={[]}
        selectedProjects={[]}
        onSourcesChange={vi.fn()}
        onProjectsChange={vi.fn()}
        onSend={vi.fn()}
        onStop={onStop}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /stop response/i }))

    expect(onStop).toHaveBeenCalled()
  })

  it('shows a soft token estimate and updates the model', () => {
    const onModelChange = vi.fn()

    render(
      <ChatInput
        draft="12345678"
        isStreaming={false}
        model="claude-sonnet-4-6"
        onDraftChange={vi.fn()}
        onModelChange={onModelChange}
        selectedSourceIds={[]}
        selectedProjects={[]}
        onSourcesChange={vi.fn()}
        onProjectsChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(screen.getByText(/~2 tokens/i)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/model/i), {
      target: { value: 'claude-opus-4-6' },
    })

    expect(onModelChange).toHaveBeenCalledWith('claude-opus-4-6')
  })

  it('shows the active scope count', () => {
    render(
      <ChatInput
        draft=""
        isStreaming={false}
        model="claude-sonnet-4-6"
        onDraftChange={vi.fn()}
        onModelChange={vi.fn()}
        selectedSourceIds={['src1']}
        selectedProjects={['Hospital Expansion']}
        onSourcesChange={vi.fn()}
        onProjectsChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: /scope/i })).toHaveTextContent('1 source')
  })
})
