import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { Sidebar } from './Sidebar'
import type { ModuleDefinition } from '@shared/types'
import { Home, Star } from 'lucide-react'

const mockModules: ModuleDefinition[] = [
  { id: 'home', name: 'Home', icon: Home, path: '/', group: 'work', order: 0 },
  { id: 'bookmarks', name: 'Bookmarks', icon: Star, path: '/bookmarks', group: 'work', order: 1 },
]

describe('Sidebar', () => {
  it('renders module navigation items', () => {
    render(
      <MemoryRouter>
        <Sidebar modules={mockModules} />
      </MemoryRouter>,
    )
    expect(screen.getByText('Home')).toBeInTheDocument()
    expect(screen.getByText('Bookmarks')).toBeInTheDocument()
  })

  it('renders group labels', () => {
    render(
      <MemoryRouter>
        <Sidebar modules={mockModules} />
      </MemoryRouter>,
    )
    expect(screen.getByText('WORK')).toBeInTheDocument()
  })

  it('has accessible navigation role', () => {
    render(
      <MemoryRouter>
        <Sidebar modules={mockModules} />
      </MemoryRouter>,
    )
    expect(screen.getByRole('navigation', { name: /module navigation/i })).toBeInTheDocument()
  })
})
