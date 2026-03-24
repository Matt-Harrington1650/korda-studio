import { fireEvent, render, screen } from '@testing-library/react'
import { CitationMarker } from './CitationMarker'

describe('CitationMarker', () => {
  it('renders a citation index and notifies on click', () => {
    const onCitationClick = vi.fn()

    render(<CitationMarker index={2} onCitationClick={onCitationClick} />)

    fireEvent.click(screen.getByRole('button', { name: '[2]' }))

    expect(onCitationClick).toHaveBeenCalledWith(2)
  })
})
