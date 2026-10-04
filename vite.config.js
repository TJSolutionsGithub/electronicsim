import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const freshHeaders = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0',
  'Pragma': 'no-cache',
  'Expires': '0',
  // The preview origin previously served an older editor shell. This asks a
  // secure browser context to evict that HTTP cache without deleting projects
  // stored in localStorage.
  'Clear-Site-Data': '"cache"'
}

// The editor binds native pointer/drag events to generated SVG nodes. A full
// reload is safer than preserving an old DOM through React Fast Refresh.
const fullReloadEditor = {
  name: 'circuitlab-full-reload',
  handleHotUpdate({ server }) {
    server.ws.send({ type: 'full-reload' })
    return []
  }
}

export default defineConfig({
  plugins: [react(), fullReloadEditor],
  server: {
    host: '0.0.0.0',
    allowedHosts: true,
    headers: freshHeaders
  },
  preview: {
    host: '0.0.0.0',
    allowedHosts: true,
    headers: freshHeaders
  }
})
