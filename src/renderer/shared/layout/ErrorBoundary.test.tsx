import { render, screen } from '@testing-library/react'
import { ModuleErrorBoundary } from './ErrorBoundary'

function ThrowingChild(): never {
  throw new Error('test error')
}

describe('ModuleErrorBoundary', () => {
  // Suppress expected error console output
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  it('renders children when no error', () => {
    render(
      <ModuleErrorBoundary moduleName="Test">
        <div>Child content</div>
      </ModuleErrorBoundary>,
    )
    expect(screen.getByText('Child content')).toBeInTheDocument()
  })

  it('renders fallback with module name when child throws', () => {
    render(
      <ModuleErrorBoundary moduleName="Settings">
        <ThrowingChild />
      </ModuleErrorBoundary>,
    )
    expect(screen.getByText(/something went wrong in Settings/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /try reloading/i })).toBeInTheDocument()
  })
})
