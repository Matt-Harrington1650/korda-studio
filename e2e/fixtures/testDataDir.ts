import path from 'node:path'

// Points to the projects/ subdirectory — PROJ-001 and PROJ-002 live inside it.
// __testdata__/ itself contains only a `projects/` folder.
// Set this as the Connections root so fileIndexService discovers project folders.
export const TEST_DATA_ROOT = path.resolve(
  __dirname,
  '../../src/main/__testdata__/projects'
)
