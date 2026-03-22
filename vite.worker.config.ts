import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [
  'electron',
  'electron/common',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

export default defineConfig({
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    outDir: '.vite/build',
    lib: {
      entry: 'src/main/ingestionWorker.ts',
      fileName: () => 'ingestionWorker.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['better-sqlite3', ...builtins],
    },
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
})
