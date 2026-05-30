import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // '/' is required for service-worker scope to cover the entire origin.
  // The old './' default is only appropriate for static file deployments
  // served from a sub-path; it breaks SW registration at the domain root.
  base: '/',

  plugins: [
    VitePWA({
      // Auto-update: the SW silently fetches updates in the background and
      // activates on next page load, with no manual prompt needed for an idle game.
      registerType: 'autoUpdate',

      // 'auto' injects the registration snippet automatically; no need for a
      // manual import of 'virtual:pwa-register' in application code.
      injectRegister: 'auto',

      // Static assets to copy to the build output alongside the manifest.
      includeAssets: [
        'favicon.ico',
        'apple-touch-icon-180x180.png',
        'icon.svg',
      ],

      // ── Web App Manifest ──────────────────────────────────────────────────
      manifest: {
        name: 'Tubes',
        short_name: 'Tubes',
        description:
          'An idle game about moving data across the internet — route packets, build pipes, and grow your network.',
        // Dark navy from tokens.css --color-bg: oklch(8% 0.02 240)
        theme_color: '#0a0c14',
        background_color: '#0a0c14',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          {
            src: 'pwa-64x64.png',
            sizes: '64x64',
            type: 'image/png',
          },
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
          {
            src: 'maskable-icon-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },

      // ── Workbox precaching config ─────────────────────────────────────────
      workbox: {
        // Precache the built app shell: JS chunks, CSS, HTML entry point,
        // SVG assets, PNG icons, and WOFF2 fonts if any are added later.
        globPatterns: ['**/*.{js,css,html,svg,png,ico,woff2}'],

        // Remove stale precache entries from previous deployments automatically.
        cleanupOutdatedCaches: true,

        // Offline fallback: navigate to the cached index.html shell for any
        // document request that isn't otherwise matched (SPA routing).
        navigateFallback: 'index.html',
      },
    }),
  ],

  server: {
    host: true,
  },

  test: {
    globals: true,
    environment: 'node',
    passWithNoTests: true,
  },
});
