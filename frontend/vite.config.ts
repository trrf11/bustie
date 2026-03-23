import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(process.env.APP_VERSION || 'dev'),
  },
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'prompt',
      injectRegister: false,
      manifest: {
        name: 'busties.nl — Bus 80 Tracker',
        short_name: 'busties',
        description: 'Volg bus 80 tussen Amsterdam en Zandvoort',
        theme_color: '#1a1a2e',
        background_color: '#0a1a1c',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: '/icons/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/icons/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: '/icons/icon-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,png,svg,ico,woff2}'],
      },
      devOptions: {
        enabled: false,
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
})
