import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import SettingsModule from './SettingsModule'

describe('SettingsModule', () => {
  it('renders settings sub-navigation', () => {
    render(
      <MemoryRouter>
        <SettingsModule />
      </MemoryRouter>,
    )
    expect(screen.getByText('Appearance')).toBeInTheDocument()
    expect(screen.getByText('Profile')).toBeInTheDocument()
    expect(screen.getByText('Connections')).toBeInTheDocument()
    expect(screen.getByText('About')).toBeInTheDocument()
  })
})
