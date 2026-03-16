import type { ModuleDefinition } from './module'
import { Home } from 'lucide-react'

describe('ModuleDefinition type', () => {
  it('accepts a valid module definition', () => {
    const def: ModuleDefinition = {
      id: 'test',
      name: 'Test',
      icon: Home,
      path: '/test',
      group: 'work',
      order: 0,
    }
    expect(def.id).toBe('test')
    expect(def.group).toBe('work')
  })
})
