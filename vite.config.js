import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/PinyinLens/',
  build: { target: 'es2022' },
  worker: { format: 'es' },
  plugins: [
    VitePWA({
      // A new service worker waits and takes over on the next cold launch: no skipWaiting/clientsClaim
      // and no update prompt, so app code is never swapped under a running session.
      registerType: 'prompt',
      injectRegister: 'script',
      manifest: {
        name: 'PinyinLens',
        short_name: 'PinyinLens',
        description: 'Point your camera at Chinese text and read it with pinyin.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#000000',
        theme_color: '#000000',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      workbox: {
        // App shell only. OCR assets (public/ocr/) are cached by src/app/assets.js, except the
        // manifest, which must stay in step with the shell.
        globPatterns: ['**/*.{html,js,css,png,svg,webmanifest}', 'ocr/manifest.json'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        skipWaiting: false,
        clientsClaim: false,
      },
    }),
  ],
});
