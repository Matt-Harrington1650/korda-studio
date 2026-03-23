import { useEffect, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { usePreferencesStore } from '@shared/state/preferencesStore'
import { CHAT_MODEL_OPTIONS } from '../../chat/chatModels'
import {
  DEFAULT_AI_CONFIG,
  DEFAULT_FIRM_CONTEXT,
  type AIConfig,
} from '../../../../shared/ai-config'
import { STORE_KEYS } from '../../../../shared/electron-store-keys'

type ApiKeySource = 'env' | 'store' | 'none'
type FeedbackTone = 'success' | 'error'

interface FeedbackState {
  tone: FeedbackTone
  message: string
}

function getFeedbackClassName(tone: FeedbackTone): string {
  return tone === 'success' ? 'text-green-400' : 'text-red-300'
}

function parseAIConfig(raw: AIConfig | string | null): AIConfig {
  if (!raw) {
    return { ...DEFAULT_AI_CONFIG }
  }

  if (typeof raw === 'string') {
    try {
      return {
        ...DEFAULT_AI_CONFIG,
        ...(JSON.parse(raw) as Partial<AIConfig>),
      }
    } catch {
      return { ...DEFAULT_AI_CONFIG }
    }
  }

  return {
    ...DEFAULT_AI_CONFIG,
    ...raw,
  }
}

export function Component() {
  const { firmName, disciplines, setFirmName, setDisciplines } = usePreferencesStore()
  const [firmNameDraft, setFirmNameDraft] = useState(firmName)
  const [disciplinesDraft, setDisciplinesDraft] = useState(disciplines)
  const [aiConfig, setAiConfig] = useState<AIConfig>({ ...DEFAULT_AI_CONFIG })
  const [apiKeySource, setApiKeySource] = useState<ApiKeySource>('none')
  const [showApiKey, setShowApiKey] = useState(false)
  const [savingAI, setSavingAI] = useState(false)
  const [savingContext, setSavingContext] = useState(false)
  const [testingConnection, setTestingConnection] = useState(false)
  const [aiFeedback, setAiFeedback] = useState<FeedbackState | null>(null)
  const [contextFeedback, setContextFeedback] = useState<FeedbackState | null>(null)
  const [connectionFeedback, setConnectionFeedback] = useState<FeedbackState | null>(null)

  useEffect(() => {
    setFirmNameDraft(firmName)
  }, [firmName])

  useEffect(() => {
    setDisciplinesDraft(disciplines)
  }, [disciplines])

  useEffect(() => {
    let cancelled = false

    async function loadSettings() {
      try {
        const [source, storedAI] = await Promise.all([
          window.kordaAPI.chatApiKeySource(),
          window.kordaAPI.storeGet<AIConfig | string>(STORE_KEYS.AI),
        ])

        if (cancelled) return

        setApiKeySource(source)
        setAiConfig(parseAIConfig(storedAI))
      } catch {
        if (cancelled) return
        setApiKeySource('none')
        setAiConfig({ ...DEFAULT_AI_CONFIG })
      }
    }

    void loadSettings()

    return () => {
      cancelled = true
    }
  }, [])

  const handleSaveAISettings = async () => {
    setSavingAI(true)
    setAiFeedback(null)

    try {
      const nextConfig: AIConfig = {
        ...aiConfig,
        anthropicApiKey:
          apiKeySource === 'env' ? aiConfig.anthropicApiKey : aiConfig.anthropicApiKey.trim(),
      }

      await window.kordaAPI.storeSet(STORE_KEYS.AI, nextConfig)
      setAiConfig(nextConfig)
      setAiFeedback({ tone: 'success', message: 'AI settings saved.' })
    } catch (error) {
      setAiFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save AI settings.',
      })
    } finally {
      setSavingAI(false)
    }
  }

  const handleTestConnection = async () => {
    setTestingConnection(true)
    setConnectionFeedback(null)

    try {
      const result = await window.kordaAPI.chatTestConnection()
      setConnectionFeedback(
        result.ok
          ? { tone: 'success', message: 'Connected successfully.' }
          : { tone: 'error', message: result.error ?? 'Connection failed.' },
      )
    } catch (error) {
      setConnectionFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Connection failed.',
      })
    } finally {
      setTestingConnection(false)
    }
  }

  const handleSaveContext = async () => {
    setSavingContext(true)
    setContextFeedback(null)

    try {
      const nextConfig: AIConfig = {
        ...aiConfig,
        firmContext: aiConfig.firmContext,
      }

      await window.kordaAPI.storeSet(STORE_KEYS.AI, nextConfig)
      setAiConfig(nextConfig)
      setFirmName(firmNameDraft.trim())
      setDisciplines(disciplinesDraft.trim())
      setContextFeedback({ tone: 'success', message: 'Firm context saved.' })
    } catch (error) {
      setContextFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to save firm context.',
      })
    } finally {
      setSavingContext(false)
    }
  }

  const handleResetContext = async () => {
    const shouldReset = window.confirm(
      'Reset the firm context back to the default KORDA engineering conventions?',
    )
    if (!shouldReset) return

    const nextConfig: AIConfig = {
      ...aiConfig,
      firmContext: DEFAULT_FIRM_CONTEXT,
    }

    setAiConfig(nextConfig)
    setSavingContext(true)
    setContextFeedback(null)

    try {
      await window.kordaAPI.storeSet(STORE_KEYS.AI, nextConfig)
      setContextFeedback({ tone: 'success', message: 'Firm context reset to default.' })
    } catch (error) {
      setContextFeedback({
        tone: 'error',
        message: error instanceof Error ? error.message : 'Unable to reset firm context.',
      })
    } finally {
      setSavingContext(false)
    }
  }

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <h2 className="text-lg font-medium text-text-primary">AI</h2>
        <p className="max-w-3xl text-sm text-text-secondary">
          Configure KORDA&apos;s engineering assistant, connection settings, and the firm context
          injected into every new conversation.
        </p>
      </div>

      <section className="space-y-4">
        <h3 className="text-sm font-medium uppercase tracking-widest text-text-secondary">
          Provider
        </h3>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="rounded-xl border border-brand/30 bg-brand-muted/40 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text-primary">Anthropic (direct)</div>
                <p className="mt-1 text-sm text-text-secondary">
                  Active provider for live chat streaming and connection testing.
                </p>
              </div>
              <span className="rounded-full border border-brand/40 px-2 py-1 text-[11px] font-medium uppercase tracking-widest text-text-primary">
                Active
              </span>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface-raised/50 p-4 opacity-70">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-text-primary">AWS Bedrock</div>
                <p className="mt-1 text-sm text-text-secondary">
                  Provider abstraction is ready, but the Bedrock client ships in a later phase.
                </p>
              </div>
              <span className="rounded-full border border-border px-2 py-1 text-[11px] font-medium uppercase tracking-widest text-text-secondary">
                Coming soon
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface-raised/40 p-5">
        <div className="space-y-1">
          <h3 className="text-sm font-medium uppercase tracking-widest text-text-secondary">
            API Access
          </h3>
          <p className="text-sm text-text-secondary">
            Save a user-level Anthropic key, pick the default model, and verify connectivity from
            inside the desktop app.
          </p>
        </div>

        {apiKeySource === 'env' && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
            Using environment variable - key field disabled.
          </div>
        )}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_240px]">
          <div className="space-y-2">
            <label htmlFor="anthropic-api-key" className="text-sm text-text-primary">
              Anthropic API Key
            </label>
            <div className="flex gap-2">
              <input
                id="anthropic-api-key"
                type={showApiKey ? 'text' : 'password'}
                value={aiConfig.anthropicApiKey}
                disabled={apiKeySource === 'env'}
                onChange={(event) => {
                  setAiConfig((current) => ({
                    ...current,
                    anthropicApiKey: event.target.value,
                  }))
                  setAiFeedback(null)
                  setConnectionFeedback(null)
                }}
                className="flex-1 rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent disabled:cursor-not-allowed disabled:opacity-60"
              />
              <button
                type="button"
                onClick={() => setShowApiKey((current) => !current)}
                className="inline-flex items-center gap-2 rounded border border-border px-3 py-2 text-sm text-text-secondary transition-colors hover:bg-white/5 hover:text-text-primary"
              >
                {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                <span>{showApiKey ? 'Hide' : 'Show'}</span>
              </button>
            </div>
          </div>

          <div className="space-y-2">
            <label htmlFor="default-model" className="text-sm text-text-primary">
              Default Model
            </label>
            <select
              id="default-model"
              value={aiConfig.defaultModel}
              onChange={(event) => {
                setAiConfig((current) => ({
                  ...current,
                  defaultModel: event.target.value,
                }))
                setAiFeedback(null)
              }}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            >
              {CHAT_MODEL_OPTIONS.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} - {option.costHint}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="voyage-api-key" className="text-sm text-text-primary">
              Voyage AI API Key
            </label>
            <input
              id="voyage-api-key"
              type="password"
              value={aiConfig.voyageApiKey ?? ''}
              onChange={(event) => {
                setAiConfig((current) => ({
                  ...current,
                  voyageApiKey: event.target.value,
                }))
                setAiFeedback(null)
              }}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            {aiConfig.voyageApiKey?.trim() ? (
              <p className="text-sm text-green-400">Semantic search enabled (voyage-3)</p>
            ) : (
              <p className="text-sm text-text-secondary">
                Add a Voyage key to enable semantic retrieval in a later phase.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <label htmlFor="cohere-api-key" className="text-sm text-text-primary">
              Cohere API Key
            </label>
            <input
              id="cohere-api-key"
              type="password"
              value={aiConfig.cohereApiKey ?? ''}
              onChange={(event) => {
                setAiConfig((current) => ({
                  ...current,
                  cohereApiKey: event.target.value,
                }))
                setAiFeedback(null)
              }}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
            {aiConfig.cohereApiKey?.trim() ? (
              <p className="text-sm text-green-400">Reranking enabled (rerank-v3.5)</p>
            ) : (
              <p className="text-sm text-text-secondary">
                Add a Cohere key to unlock reranking in a later phase.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-surface-base/60 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <label htmlFor="contextual-enrichment" className="text-sm text-text-primary">
                Contextual Retrieval
              </label>
              <p className="text-sm text-text-secondary">
                Uses Claude to generate a context sentence for each chunk during ingestion.
              </p>
            </div>
            <input
              id="contextual-enrichment"
              type="checkbox"
              checked={Boolean(aiConfig.contextualEnrichment)}
              onChange={(event) => {
                setAiConfig((current) => ({
                  ...current,
                  contextualEnrichment: event.target.checked,
                }))
                setAiFeedback(null)
              }}
              className="mt-1 h-4 w-4 rounded border-border bg-surface-base text-accent focus:ring-accent"
            />
          </div>
          <p className="text-sm text-text-secondary">
            Estimated cost: ~$0.04 per 1,000 chunks (Haiku) / ~$0.40 (Sonnet).
          </p>
          <p className="text-sm text-amber-200">Requires re-indexing all files after enabling.</p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSaveAISettings()}
            disabled={savingAI}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingAI ? 'Saving...' : 'Save AI Settings'}
          </button>
          <button
            type="button"
            onClick={() => void handleTestConnection()}
            disabled={testingConnection}
            className="rounded border border-border px-4 py-2 text-sm text-text-primary transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {testingConnection ? 'Testing...' : 'Test Connection'}
          </button>
          {aiFeedback && (
            <span className={`text-sm ${getFeedbackClassName(aiFeedback.tone)}`}>
              {aiFeedback.message}
            </span>
          )}
          {connectionFeedback && (
            <span className={`text-sm ${getFeedbackClassName(connectionFeedback.tone)}`}>
              {connectionFeedback.message}
            </span>
          )}
        </div>
      </section>

      <section className="space-y-4 rounded-2xl border border-border bg-surface-raised/40 p-5">
        <div className="space-y-1">
          <h3 className="text-sm font-medium uppercase tracking-widest text-text-secondary">
            Firm Context
          </h3>
          <p className="text-sm text-text-secondary">
            These details shape the system prompt for every new chat conversation.
          </p>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <div className="space-y-2">
            <label htmlFor="firm-name" className="text-sm text-text-primary">
              Firm Name
            </label>
            <input
              id="firm-name"
              type="text"
              value={firmNameDraft}
              onChange={(event) => {
                setFirmNameDraft(event.target.value)
                setContextFeedback(null)
              }}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="disciplines" className="text-sm text-text-primary">
              Disciplines
            </label>
            <input
              id="disciplines"
              type="text"
              value={disciplinesDraft}
              onChange={(event) => {
                setDisciplinesDraft(event.target.value)
                setContextFeedback(null)
              }}
              className="w-full rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
            />
          </div>
        </div>

        <div className="space-y-2">
          <label htmlFor="firm-context" className="text-sm text-text-primary">
            Engineering conventions &amp; firm context (injected into every conversation)
          </label>
          <textarea
            id="firm-context"
            rows={8}
            value={aiConfig.firmContext}
            onChange={(event) => {
              setAiConfig((current) => ({
                ...current,
                firmContext: event.target.value,
              }))
              setContextFeedback(null)
            }}
            className="min-h-48 w-full resize-y rounded border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none focus:border-accent"
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void handleSaveContext()}
            disabled={savingContext}
            className="rounded bg-brand px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingContext ? 'Saving...' : 'Save Firm Context'}
          </button>
          <button
            type="button"
            onClick={() => void handleResetContext()}
            disabled={savingContext}
            className="rounded border border-border px-4 py-2 text-sm text-text-primary transition-colors hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Reset to Default
          </button>
          <span className="text-sm text-text-secondary">
            Changes take effect on the next new conversation.
          </span>
        </div>

        {contextFeedback && (
          <div className={`text-sm ${getFeedbackClassName(contextFeedback.tone)}`}>
            {contextFeedback.message}
          </div>
        )}
      </section>
    </div>
  )
}
