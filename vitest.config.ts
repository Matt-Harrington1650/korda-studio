import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/renderer/**/*.{ts,tsx}'],
      exclude: ['src/**/*.test.*', 'src/**/*.d.ts'],
    },
  },
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'src/renderer/shared'),
      '@modules': path.resolve(__dirname, 'src/renderer/modules'),
    },
  },
})
