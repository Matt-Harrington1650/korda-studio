/**
 * Standalone build config for the Electron main process.
 * Used to recompile main.js without launching the full app via electron-forge.
 * Usage: npx vite build --config vite.main.build.config.ts
 */
import { builtinModules } from 'node:module'
import { defineConfig } from 'vite'

const builtins = [
  'electron',
  'electron/common',
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
]

export default defineConfig({
  // electron-forge's VitePlugin injects these globals at build time.
  // For e2e tests the renderer is served from the Vite dev server on 5173.
  define: {
    MAIN_WINDOW_VITE_DEV_SERVER_URL: JSON.stringify('http://localhost:5173'),
    MAIN_WINDOW_VITE_NAME: JSON.stringify('main_window'),
  },
  build: {
    copyPublicDir: false,
    emptyOutDir: false,
    outDir: '.vite/build',
    lib: {
      entry: 'src/main/main.ts',
      fileName: () => 'main-updated.js',
      formats: ['cjs'],
    },
    rollupOptions: {
      external: ['better-sqlite3', ...builtins],
      output: {
        // Disable code splitting — produce a single self-contained CJS bundle
        // like electron-forge's VitePlugin does, so Electron can load it.
        inlineDynamicImports: true,
      },
    },
  },
  resolve: {
    conditions: ['node'],
    mainFields: ['module', 'jsnext:main', 'jsnext'],
  },
})
