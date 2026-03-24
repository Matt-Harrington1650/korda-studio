import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ScopeSelector } from './ScopeSelector'

describe('ScopeSelector', () => {
  beforeEach(() => {
    vi.stubGlobal('kordaAPI', {
      fileIndexSourcesList: vi.fn().mockResolvedValue([
        {
          id: 'src1',
          displayName: 'Engineering Shares',
          path: '/eng',
          type: 'local',
          enabled: true,
        },
        {
          id: 'src2',
          displayName: 'Project Files',
          path: '/proj',
          type: 'local',
          enabled: true,
        },
      ]),
      fileIndexProjectsList: vi.fn().mockResolvedValue(['Hospital Expansion', 'Civic Centre']),
    })
  })

  it('loads sources and projects when opened and updates selections', async () => {
    const onSourcesChange = vi.fn()
    const onProjectsChange = vi.fn()

    render(
      <ScopeSelector
        selectedSourceIds={[]}
        selectedProjects={[]}
        onSourcesChange={onSourcesChange}
        onProjectsChange={onProjectsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /scope/i }))

    expect(await screen.findByLabelText('Engineering Shares')).toBeInTheDocument()
    expect(screen.getByLabelText('Hospital Expansion')).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Engineering Shares'))
    fireEvent.click(screen.getByLabelText('Hospital Expansion'))

    expect(onSourcesChange).toHaveBeenCalledWith(['src1'])
    expect(onProjectsChange).toHaveBeenCalledWith(['Hospital Expansion'])
  })

  it('clears the selected scope', async () => {
    const onSourcesChange = vi.fn()
    const onProjectsChange = vi.fn()

    render(
      <ScopeSelector
        selectedSourceIds={['src1']}
        selectedProjects={['Hospital Expansion']}
        onSourcesChange={onSourcesChange}
        onProjectsChange={onProjectsChange}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /scope/i }))
    await waitFor(() => expect(screen.getByRole('button', { name: /clear scope/i })).toBeVisible())

    fireEvent.click(screen.getByRole('button', { name: /clear scope/i }))

    expect(onSourcesChange).toHaveBeenCalledWith([])
    expect(onProjectsChange).toHaveBeenCalledWith([])
  })
})
