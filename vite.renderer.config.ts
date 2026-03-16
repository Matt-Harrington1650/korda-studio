import { defineConfig } from 'vite'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      '@shared': '/src/renderer/shared',
      '@modules': '/src/renderer/modules',
    },
  },
})
