import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// tauri.conf.json is the version the installer is actually stamped with,
// so that's the one Settings → About shows.
const appVersion = JSON.parse(readFileSync(new URL('./src-tauri/tauri.conf.json', import.meta.url), 'utf-8')).version

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
  test: { environment: 'jsdom' },
  clearScreen: false,
  server: {
    port: 5173,
    strictPort: true,
  }
})