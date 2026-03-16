import { Minus, Square, X } from 'lucide-react'

export function TitleBar() {
  return (
    <div
      className="h-9 bg-surface-raised flex items-center justify-between border-b border-border select-none"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Left: Branding */}
      <div className="flex items-center gap-1 pl-4">
        <span className="text-sm font-bold text-text-primary tracking-wide">KORDA</span>
        <span className="text-sm font-light text-text-secondary">Studio</span>
      </div>

      {/* Center: Project name */}
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span className="opacity-40">·</span>
        <span>No Project</span>
      </div>

      {/* Right: Window controls */}
      <div
        className="flex items-center h-full"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <button
          aria-label="Minimize"
          className="h-full px-3 hover:bg-white/5 transition-colors duration-150"
          onClick={() => (window as Window & { kordaAPI?: typeof window.kordaAPI }).kordaAPI?.minimizeWindow?.()}
        >
          <Minus size={14} className="text-text-secondary" />
        </button>
        <button
          aria-label="Maximize"
          className="h-full px-3 hover:bg-white/5 transition-colors duration-150"
          onClick={() => (window as Window & { kordaAPI?: typeof window.kordaAPI }).kordaAPI?.maximizeWindow?.()}
        >
          <Square size={12} className="text-text-secondary" />
        </button>
        <button
          aria-label="Close"
          className="h-full px-3 hover:bg-error/80 transition-colors duration-150"
          onClick={() => (window as Window & { kordaAPI?: typeof window.kordaAPI }).kordaAPI?.closeWindow?.()}
        >
          <X size={14} className="text-text-secondary" />
        </button>
      </div>
    </div>
  )
}
