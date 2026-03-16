import { render, screen } from '@testing-library/react'
import SystemStatusModule from './SystemStatusModule'

describe('SystemStatusModule', () => {
  it('shows network connectivity status', () => {
    render(<SystemStatusModule />)
    expect(screen.getByText(/network/i)).toBeInTheDocument()
  })

  it('shows placeholder services as Not Configured', () => {
    render(<SystemStatusModule />)
    const notConfigured = screen.getAllByText(/not configured/i)
    expect(notConfigured.length).toBeGreaterThanOrEqual(3)
  })

  it('has a refresh button', () => {
    render(<SystemStatusModule />)
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument()
  })
})
