import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

// Bundle @vibeseek/core from source into the main/preload output (rather than
// externalizing it and depending on a built dist/). The alias resolves the
// workspace package to its TypeScript entry; node built-ins it uses stay
// external automatically.
const coreAlias = {
  '@vibeseek/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
}
const externalize = externalizeDepsPlugin({ exclude: ['@vibeseek/core'] })

export default defineConfig({
  main: {
    plugins: [externalize],
    resolve: { alias: coreAlias },
  },
  preload: {
    plugins: [externalize],
    resolve: { alias: coreAlias },
  },
  renderer: {
    plugins: [react()],
    resolve: { alias: coreAlias },
  },
})
