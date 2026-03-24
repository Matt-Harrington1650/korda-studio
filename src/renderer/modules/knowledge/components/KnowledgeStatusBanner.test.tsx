import { render, screen } from '@testing-library/react'
import type { EmbeddingStats } from '../../../../shared/contracts/embedding-provider-contract'
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

const embeddingInProgress: EmbeddingStats = {
  embedded: 320,
  total: 1000,
  percent: 32,
  isReady: false,
  hasProvider: true,
}

const embeddingComplete: EmbeddingStats = {
  embedded: 1000,
  total: 1000,
  percent: 100,
  isReady: true,
  hasProvider: true,
}

const noProvider: EmbeddingStats = {
  embedded: 0,
  total: 100,
  percent: 0,
  isReady: false,
  hasProvider: false,
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

  describe('embedding states', () => {
    it('shows embedding progress when in progress', () => {
      render(
        <KnowledgeStatusBanner
          status={null}
          onRetry={() => {}}
          embeddingStats={embeddingInProgress}
        />,
      )

      expect(screen.getByText(/embedding knowledge base/i)).toBeInTheDocument()
      expect(screen.getByText(/320/i)).toBeInTheDocument()
      expect(screen.getByText(/1,000/i)).toBeInTheDocument()
    })

    it('hides banner when embeddings complete and there is no ingestion status', () => {
      const { container } = render(
        <KnowledgeStatusBanner
          status={null}
          onRetry={() => {}}
          embeddingStats={embeddingComplete}
        />,
      )

      expect(container.firstChild).toBeNull()
    })

    it('shows keyword search only info when no provider is configured', () => {
      render(<KnowledgeStatusBanner status={null} onRetry={() => {}} embeddingStats={noProvider} />)

      expect(screen.getByText(/keyword search only/i)).toBeInTheDocument()
    })

    it('keeps ingestion banner higher priority than embedding banner', () => {
      render(
        <KnowledgeStatusBanner
          status={{
            queued: 5,
            extracting: 2,
            chunking: 0,
            contextualizing: 0,
            new: 0,
            indexed: 10,
            failed: 0,
            skipped: 0,
            total: 17,
            totalChunks: 50,
            avgChunksPerFile: 5,
          }}
          onRetry={() => {}}
          embeddingStats={embeddingInProgress}
        />,
      )

      expect(screen.getByText(/indexing/i)).toBeInTheDocument()
      expect(screen.queryByText(/embedding knowledge base/i)).not.toBeInTheDocument()
    })
  })
})
