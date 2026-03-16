import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { CommandPalette } from './CommandPalette'
import { useAppStore } from '@shared/state/appStore'

describe('CommandPalette', () => {
  beforeEach(() => {
    useAppStore.setState({ commandPaletteOpen: true })
  })

  it('renders when open', () => {
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    )
    expect(screen.getByPlaceholderText('Search or jump to...')).toBeInTheDocument()
  })

  it('does not render when closed', () => {
    useAppStore.setState({ commandPaletteOpen: false })
    render(
      <MemoryRouter>
        <CommandPalette />
      </MemoryRouter>,
    )
    expect(screen.queryByPlaceholderText('Search or jump to...')).not.toBeInTheDocument()
  })
})
