import fs from 'node:fs'
import { builtinModules } from 'node:module'
import path from 'node:path'
import { defineConfig, type Plugin } from 'vite'

const builtins = [
  'electron',
  'electron/common',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

/**
 * pdfjs-dist loads pdf.worker.mjs relative to the ingestionWorker bundle at
 * runtime. The Vite build doesn't copy it automatically, so we do it here
 * after every build so `npm start` and `npm run test:e2e` both work without
 * any manual steps.
 */
function copyPdfWorker(): Plugin {
  return {
    name: 'copy-pdf-worker',
    closeBundle() {
      const src = path.resolve(__dirname, 'node_modules/pdfjs-dist/build/pdf.worker.mjs')
      const dest = path.resolve(__dirname, '.vite/build/pdf.worker.mjs')
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true })
        fs.copyFileSync(src, dest)
        console.log('[copy-pdf-worker] Copied pdf.worker.mjs → .vite/build/')
      }
    },
  }
}

export default defineConfig({
  plugins: [copyPdfWorker()],
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
