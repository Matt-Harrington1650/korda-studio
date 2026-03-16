import { render, screen, fireEvent } from '@testing-library/react'
import BookmarksModule from './BookmarksModule'
import { usePreferencesStore } from '@shared/state/preferencesStore'

// Mock openExternal since window.kordaAPI is not available in tests
vi.stubGlobal('kordaAPI', { openExternal: vi.fn() })

describe('BookmarksModule', () => {
  beforeEach(() => {
    usePreferencesStore.setState({
      bookmarks: [],
      displayName: '',
      sidebarCollapsed: false,
    })
  })

  it('shows empty state when no bookmarks', () => {
    render(<BookmarksModule />)
    expect(screen.getByText(/no bookmarks yet/i)).toBeInTheDocument()
  })

  it('renders bookmarks when they exist', () => {
    usePreferencesStore.setState({
      bookmarks: [
        { id: '1', title: 'NEC Codes', url: 'https://example.com/nec', category: 'Standards', description: '' },
      ],
    })
    render(<BookmarksModule />)
    expect(screen.getByText('NEC Codes')).toBeInTheDocument()
  })

  it('shows add form when Add button clicked', () => {
    usePreferencesStore.setState({
      bookmarks: [{ id: '1', title: 'Test', url: 'https://example.com', category: 'General', description: '' }],
    })
    render(<BookmarksModule />)
    fireEvent.click(screen.getByText('Add'))
    expect(screen.getByPlaceholderText('Title')).toBeInTheDocument()
  })

  it('filters bookmarks by search query', () => {
    usePreferencesStore.setState({
      bookmarks: [
        { id: '1', title: 'NEC Codes', url: 'https://example.com/nec', category: 'Standards', description: '' },
        { id: '2', title: 'ASHRAE', url: 'https://example.com/ashrae', category: 'Standards', description: '' },
      ],
    })
    render(<BookmarksModule />)
    fireEvent.change(screen.getByPlaceholderText('Filter bookmarks...'), { target: { value: 'NEC' } })
    expect(screen.getByText('NEC Codes')).toBeInTheDocument()
    expect(screen.queryByText('ASHRAE')).not.toBeInTheDocument()
  })
})
