import { render, screen } from '@testing-library/react'
import type { IngestionStatus } from '../../../../shared/ipc-types'
import { KnowledgeStatusBanner } from './KnowledgeStatusBanner'

const idle: IngestionStatus = {
  new: 0,
  queued: 0,
  extracting: 0,
  chunking: 0,
  contextualizing: 0,
  indexed: 100,
  failed: 0,
  skipped: 5,
  total: 105,
  totalChunks: 2000,
  avgChunksPerFile: 20,
}

const active: IngestionStatus = {
  ...idle,
  queued: 10,
  extracting: 2,
  indexed: 50,
  total: 67,
}

const withFailed: IngestionStatus = {
  ...idle,
  failed: 3,
}

describe('KnowledgeStatusBanner', () => {
  it('renders nothing when idle with no failures', () => {
    const { container } = render(<KnowledgeStatusBanner status={idle} onRetry={() => {}} />)

    expect(container.firstChild).toBeNull()
  })

  it('shows indexing progress when files are in-flight', () => {
    render(<KnowledgeStatusBanner status={active} onRetry={() => {}} />)

    expect(screen.getByText(/indexing/i)).toBeInTheDocument()
  })

  it('shows retry button when there are failures', () => {
    render(<KnowledgeStatusBanner status={withFailed} onRetry={() => {}} />)

    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument()
  })
})
