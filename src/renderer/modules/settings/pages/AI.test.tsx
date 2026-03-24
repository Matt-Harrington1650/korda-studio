import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePreferencesStore } from '@shared/state/preferencesStore'
import { STORE_KEYS } from '../../../../shared/electron-store-keys'
import { DEFAULT_AI_CONFIG, DEFAULT_FIRM_CONTEXT } from '../../../../shared/ai-config'
import { Component } from './AI'

const mockStoreGet = vi.fn()
const mockStoreSet = vi.fn()
const mockChatApiKeySource = vi.fn()
const mockChatTestConnection = vi.fn()

describe('AI settings page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockStoreGet.mockImplementation(async (key: string) => {
      if (key === STORE_KEYS.AI) {
        return {
          ...DEFAULT_AI_CONFIG,
          anthropicApiKey: 'stored-key',
          defaultModel: 'claude-3-5-haiku-20241022',
          firmContext: 'Stored firm context',
          voyageApiKey: 'voyage-stored',
          cohereApiKey: 'cohere-stored',
          contextualEnrichment: true,
        }
      }
      return null
    })
    mockStoreSet.mockResolvedValue(undefined)
    mockChatApiKeySource.mockResolvedValue('store')
    mockChatTestConnection.mockResolvedValue({ ok: true })

    vi.stubGlobal('kordaAPI', {
      storeGet: mockStoreGet,
      storeSet: mockStoreSet,
      chatApiKeySource: mockChatApiKeySource,
      chatTestConnection: mockChatTestConnection,
    })
    vi.stubGlobal('confirm', vi.fn().mockReturnValue(true))

    usePreferencesStore.setState({
      displayName: '',
      firmName: 'KORDA Studio',
      disciplines: 'Civil, Structural',
      sidebarCollapsed: false,
      bookmarks: [],
    })
  })

  it('disables the API key input when the environment variable is active', async () => {
    mockChatApiKeySource.mockResolvedValue('env')

    render(<Component />)

    expect(await screen.findByText(/using environment variable/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/anthropic api key/i)).toBeDisabled()
  })

  it('enables the API key input when the key comes from stored settings', async () => {
    render(<Component />)

    await waitFor(() =>
      expect(screen.getByLabelText(/anthropic api key/i)).toHaveValue('stored-key'),
    )
    expect(screen.getByLabelText(/anthropic api key/i)).not.toBeDisabled()
  })

  it('saves the API key and default model to the ai store entry', async () => {
    render(<Component />)

    await waitFor(() =>
      expect(screen.getByLabelText(/anthropic api key/i)).toHaveValue('stored-key'),
    )
    fireEvent.change(screen.getByLabelText(/anthropic api key/i), {
      target: { value: 'updated-key' },
    })
    fireEvent.change(screen.getByLabelText(/default model/i), {
      target: { value: 'claude-opus-4-6' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save ai settings/i }))
    })

    await waitFor(() =>
      expect(mockStoreSet).toHaveBeenCalledWith(
        STORE_KEYS.AI,
        expect.objectContaining({
          anthropicApiKey: 'updated-key',
          defaultModel: 'claude-opus-4-6',
        }),
      ),
    )
    expect(await screen.findByText(/ai settings saved/i)).toBeInTheDocument()
  })

  it('loads and saves retrieval provider settings', async () => {
    render(<Component />)

    await waitFor(() =>
      expect(screen.getByLabelText(/voyage ai api key/i)).toHaveValue('voyage-stored'),
    )
    expect(screen.getByLabelText(/cohere api key/i)).toHaveValue('cohere-stored')
    expect(screen.getByRole('checkbox', { name: /contextual retrieval/i })).toBeChecked()
    expect(screen.getByText(/semantic search enabled/i)).toBeInTheDocument()
    expect(screen.getByText(/reranking enabled/i)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText(/voyage ai api key/i), {
      target: { value: 'voyage-updated' },
    })
    fireEvent.change(screen.getByLabelText(/cohere api key/i), {
      target: { value: 'cohere-updated' },
    })
    fireEvent.click(screen.getByRole('checkbox', { name: /contextual retrieval/i }))
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /save ai settings/i }))
    })

    await waitFor(() =>
      expect(mockStoreSet).toHaveBeenCalledWith(
        STORE_KEYS.AI,
        expect.objectContaining({
          voyageApiKey: 'voyage-updated',
          cohereApiKey: 'cohere-updated',
          contextualEnrichment: false,
        }),
      ),
    )
    expect(screen.getByText(/requires re-indexing all files/i)).toBeInTheDocument()
  })

  it('tests the Anthropic connection and shows success feedback', async () => {
    render(<Component />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /test connection/i }))
    })

    await waitFor(() => expect(mockChatTestConnection).toHaveBeenCalled())
    expect(await screen.findByText(/connected successfully/i)).toBeInTheDocument()
  })

  it('shows the returned connection error when the test fails', async () => {
    mockChatTestConnection.mockResolvedValue({ ok: false, error: 'Unauthorized' })

    render(<Component />)

    fireEvent.click(screen.getByRole('button', { name: /test connection/i }))

    expect(await screen.findByText(/unauthorized/i)).toBeInTheDocument()
  })

  it('saves firm name, disciplines, and firm context', async () => {
    render(<Component />)

    await screen.findByDisplayValue('Stored firm context')
    fireEvent.change(screen.getByLabelText(/firm name/i), {
      target: { value: 'KORDA Consulting' },
    })
    fireEvent.change(screen.getByLabelText(/disciplines/i), {
      target: { value: 'Civil, Structural, Mechanical' },
    })
    fireEvent.change(screen.getByLabelText(/engineering conventions & firm context/i), {
      target: { value: 'Custom engineering guidance' },
    })
    fireEvent.click(screen.getByRole('button', { name: /save firm context/i }))

    await waitFor(() =>
      expect(mockStoreSet).toHaveBeenCalledWith(
        STORE_KEYS.AI,
        expect.objectContaining({
          firmContext: 'Custom engineering guidance',
        }),
      ),
    )
    expect(usePreferencesStore.getState().firmName).toBe('KORDA Consulting')
    expect(usePreferencesStore.getState().disciplines).toBe('Civil, Structural, Mechanical')
    expect(screen.getByText(/firm context saved/i)).toBeInTheDocument()
  })

  it('resets the firm context to the default text after confirmation', async () => {
    render(<Component />)

    await screen.findByDisplayValue('Stored firm context')
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /reset to default/i }))
    })

    await waitFor(() =>
      expect(mockStoreSet).toHaveBeenCalledWith(
        STORE_KEYS.AI,
        expect.objectContaining({
          firmContext: DEFAULT_FIRM_CONTEXT,
        }),
      ),
    )
    expect(window.confirm).toHaveBeenCalled()
    await waitFor(() =>
      expect(screen.getByLabelText(/engineering conventions & firm context/i)).toHaveValue(
        DEFAULT_FIRM_CONTEXT,
      ),
    )
  })

  describe('Knowledge Retrieval section', () => {
    it('renders useReranking checkbox unchecked by default', async () => {
      render(<Component />)

      const checkbox = await screen.findByRole('checkbox', { name: /use cohere reranking/i })
      expect(checkbox).not.toBeChecked()
    })

    it('reranking checkbox is disabled when no Cohere key', async () => {
      mockStoreGet.mockImplementation(async (key: string) => {
        if (key === STORE_KEYS.AI) {
          return {
            ...DEFAULT_AI_CONFIG,
            anthropicApiKey: 'stored-key',
          }
        }
        return null
      })

      render(<Component />)

      const checkbox = await screen.findByRole('checkbox', { name: /use cohere reranking/i })
      expect(checkbox).toBeDisabled()
    })

    it('auto retrieval mode is selected by default', async () => {
      render(<Component />)

      const autoRadio = await screen.findByRole('radio', {
        name: /auto \(recommended - hybrid when ready, keyword otherwise\)/i,
      })
      expect(autoRadio).toBeChecked()
    })

    it('ProviderPriorityHint shows no embedding provider when no keys', async () => {
      mockStoreGet.mockImplementation(async (key: string) => {
        if (key === STORE_KEYS.AI) {
          return {
            ...DEFAULT_AI_CONFIG,
            anthropicApiKey: 'stored-key',
          }
        }
        return null
      })

      render(<Component />)

      expect(await screen.findByText(/no embedding provider/i)).toBeInTheDocument()
    })
  })
})
