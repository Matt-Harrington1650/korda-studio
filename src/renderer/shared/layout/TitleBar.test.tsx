import { render, screen } from '@testing-library/react'
import { TitleBar } from './TitleBar'

describe('TitleBar', () => {
  it('renders KORDA Studio branding', () => {
    render(<TitleBar />)
    expect(screen.getByText('KORDA')).toBeInTheDocument()
    expect(screen.getByText('Studio')).toBeInTheDocument()
  })

  it('shows "No Project" when no project selected', () => {
    render(<TitleBar />)
    expect(screen.getByText('No Project')).toBeInTheDocument()
  })

  it('renders window control buttons', () => {
    render(<TitleBar />)
    expect(screen.getByLabelText('Minimize')).toBeInTheDocument()
    expect(screen.getByLabelText('Maximize')).toBeInTheDocument()
    expect(screen.getByLabelText('Close')).toBeInTheDocument()
  })
})
