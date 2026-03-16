import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import HomeModule from './HomeModule'

vi.mock('@shared/state/preferencesStore', () => ({
  usePreferencesStore: () => ({ displayName: '' }),
}))

describe('HomeModule', () => {
  it('shows greeting with default name when no display name set', () => {
    render(
      <MemoryRouter>
        <HomeModule />
      </MemoryRouter>,
    )
    expect(screen.getByText(/engineer/i)).toBeInTheDocument()
  })

  it('shows quick action cards', () => {
    render(
      <MemoryRouter>
        <HomeModule />
      </MemoryRouter>,
    )
    expect(screen.getByText(/command palette/i)).toBeInTheDocument()
  })

  it('shows activity feed placeholder', () => {
    render(
      <MemoryRouter>
        <HomeModule />
      </MemoryRouter>,
    )
    expect(screen.getByText(/activity feed coming soon/i)).toBeInTheDocument()
  })
})
