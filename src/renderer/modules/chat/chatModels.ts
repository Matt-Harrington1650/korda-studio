export interface ChatModelOption {
  id: string
  label: string
  costHint: string
}

export const CHAT_MODEL_OPTIONS: ChatModelOption[] = [
  {
    id: 'claude-3-5-haiku-20241022',
    label: 'Haiku 3.5',
    costHint: 'Fastest',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Sonnet 4.6',
    costHint: 'Balanced',
  },
  {
    id: 'claude-opus-4-6',
    label: 'Opus 4.6',
    costHint: 'Highest quality',
  },
]

export function getModelLabel(modelId: string): string {
  return CHAT_MODEL_OPTIONS.find((option) => option.id === modelId)?.label ?? modelId
}

export function getModelCostHint(modelId: string): string {
  return CHAT_MODEL_OPTIONS.find((option) => option.id === modelId)?.costHint ?? 'Custom'
}
