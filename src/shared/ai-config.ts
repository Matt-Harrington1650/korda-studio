export interface AIConfig {
  provider: 'anthropic'
  anthropicApiKey: string
  defaultModel: string
  firmContext: string
}

export const DEFAULT_AI_MODEL = 'claude-sonnet-4-6'

export const DEFAULT_FIRM_CONTEXT = `Engineering document conventions:
- Drawing numbers follow the pattern [X-NNN] where X is the discipline code
  (C=Civil, S=Structural, E=Electrical, M=Mechanical, P=Plumbing, A=Architectural)
- Issue statuses: IFC (Issued for Construction), IFB (Issued for Bid),
  IFR (Issued for Review), AFC (Approved for Construction), SD (Schematic Design),
  DD (Design Development), CD (Construction Documents)
- Revisions: Rev A, Rev B... through Rev FINAL
- Disciplines practiced by this firm: {disciplines}

Be precise, technically accurate, and concise. When referencing standards,
cite them by name. Prefer bullet points and tables for technical information.`

export const DEFAULT_AI_CONFIG: AIConfig = {
  provider: 'anthropic',
  anthropicApiKey: '',
  defaultModel: DEFAULT_AI_MODEL,
  firmContext: DEFAULT_FIRM_CONTEXT,
}
