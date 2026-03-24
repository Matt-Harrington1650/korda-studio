interface CitationMarkerProps {
  index: number
  onCitationClick: (index: number) => void
}

export function CitationMarker({ index, onCitationClick }: CitationMarkerProps) {
  return (
    <button
      type="button"
      onClick={() => onCitationClick(index)}
      className="mx-0.5 align-super text-xs font-semibold text-accent transition-colors hover:text-accent/80 hover:underline"
    >
      [{index}]
    </button>
  )
}
