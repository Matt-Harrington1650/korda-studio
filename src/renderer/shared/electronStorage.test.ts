import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createElectronStorage } from './electronStorage'

describe('createElectronStorage', () => {
  const mockStoreGet = vi.fn()
  const mockStoreSet = vi.fn()

  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('kordaAPI', {
      storeGet: mockStoreGet,
      storeSet: mockStoreSet,
    })
  })

  it('getItem calls storeGet with the key', async () => {
    mockStoreGet.mockResolvedValue('"hello"')
    const storage = createElectronStorage('test-key')
    const result = await storage.getItem('test-key')
    expect(mockStoreGet).toHaveBeenCalledWith('test-key')
    expect(result).toBe('"hello"')
  })

  it('getItem returns null when storeGet returns null', async () => {
    mockStoreGet.mockResolvedValue(null)
    const storage = createElectronStorage('test-key')
    const result = await storage.getItem('test-key')
    expect(result).toBeNull()
  })

  it('setItem calls storeSet with key and value', async () => {
    mockStoreSet.mockResolvedValue(undefined)
    const storage = createElectronStorage('test-key')
    await storage.setItem('test-key', '{"a":1}')
    expect(mockStoreSet).toHaveBeenCalledWith('test-key', '{"a":1}')
  })

  it('removeItem calls storeSet with null', async () => {
    mockStoreSet.mockResolvedValue(undefined)
    const storage = createElectronStorage('test-key')
    await storage.removeItem('test-key')
    expect(mockStoreSet).toHaveBeenCalledWith('test-key', null)
  })
})
