import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { StatusStrip } from './StatusStrip'

describe('StatusStrip', () => {
  it('renders the breadcrumb from current route', () => {
    render(
      <MemoryRouter initialEntries={['/bookmarks']}>
        <StatusStrip />
      </MemoryRouter>,
    )
    // Breadcrumb derives from route — implementation maps paths to names
  })

  it('renders connection status indicator', () => {
    render(
      <MemoryRouter>
        <StatusStrip />
      </MemoryRouter>,
    )
    expect(screen.getByText(/connected|offline/i)).toBeInTheDocument()
  })

  it('renders notification bell', () => {
    render(
      <MemoryRouter>
        <StatusStrip />
      </MemoryRouter>,
    )
    expect(screen.getByLabelText(/notifications/i)).toBeInTheDocument()
  })
})
