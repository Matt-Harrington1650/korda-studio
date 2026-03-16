import { create } from 'zustand'
import { devtools } from 'zustand/middleware'

interface ProjectState {
  activeProjectId: string | null
  activeProjectName: string | null
}

export const useProjectStore = create<ProjectState>()(
  devtools(() => ({
    activeProjectId: null,
    activeProjectName: null,
  })),
)
