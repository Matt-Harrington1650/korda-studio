import { useToastStore } from '../state/toastStore'

describe('toastStore', () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] })
  })

  it('adds a toast', () => {
    useToastStore.getState().addToast({ title: 'Saved', type: 'success' })
    expect(useToastStore.getState().toasts).toHaveLength(1)
    expect(useToastStore.getState().toasts[0].title).toBe('Saved')
  })

  it('removes a toast', () => {
    useToastStore.getState().addToast({ title: 'Test', type: 'info' })
    const id = useToastStore.getState().toasts[0].id
    useToastStore.getState().removeToast(id)
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('limits to 3 visible toasts', () => {
    for (let i = 0; i < 5; i++) {
      useToastStore.getState().addToast({ title: `Toast ${i}`, type: 'info' })
    }
    expect(useToastStore.getState().toasts.length).toBeLessThanOrEqual(3)
  })
})
