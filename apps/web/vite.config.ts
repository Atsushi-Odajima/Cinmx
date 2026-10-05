import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync, existsSync } from 'node:fs';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // ルート1（同一 Wi-Fi の HTTPS 開発サーバー）: mkcert で作った証明書のパスを環境変数で指定する
  const certPath = env.DEV_HTTPS_CERT;
  const keyPath = env.DEV_HTTPS_KEY;
  const https = mode === 'lan' && certPath && keyPath && existsSync(certPath) && existsSync(keyPath) ? { cert: readFileSync(certPath), key: readFileSync(keyPath) } : undefined;
  if (mode === 'lan' && !https) {
    console.warn('[cinemix] --mode lan ですが DEV_HTTPS_CERT / DEV_HTTPS_KEY が見つかりません。HTTP で起動します（iPhone では PWA・一部メディア API が使えません）。docs/README.txt を参照。');
  }
  return {
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['brand/*.svg', 'brand/pwa-icon-*.png', 'brand/apple-touch-icon.png'],
        manifest: {
          name: 'CinemiX',
          short_name: 'CinemiX',
          description: '写真を選んで、見本のような動画に。',
          lang: 'ja',
          start_url: '/',
          scope: '/',
          display: 'standalone',
          background_color: '#F3F0E7',
          theme_color: '#F3F0E7',
          icons: [
            { src: '/brand/pwa-icon-192.png', sizes: '192x192', type: 'image/png' },
            { src: '/brand/pwa-icon-512.png', sizes: '512x512', type: 'image/png' },
            { src: '/brand/pwa-icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        workbox: {
          // アプリシェルと同梱素材（表紙・サンプル）だけをキャッシュ。フォントは実行時に CacheFirst。
          globPatterns: ['**/*.{js,css,html,svg,ico,json,webmanifest}', 'brand/pwa-icon-*.png', 'brand/apple-touch-icon.png', 'brand/logo-mark.png', 'templates/*/cover.png', 'templates/*/meta.json'],
          globIgnores: ['fonts/**', 'samples/**', 'templates/*.mp4'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/supabase/, /^\/api/],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          runtimeCaching: [
            { urlPattern: /\/fonts\/.*\.(woff2|css)$/, handler: 'CacheFirst', options: { cacheName: 'cinemix-fonts', expiration: { maxEntries: 600, maxAgeSeconds: 60 * 60 * 24 * 365 } } },
            { urlPattern: /\/(samples|templates)\/.*\.(jpg|mp3|mp4|png)$/, handler: 'CacheFirst', options: { cacheName: 'cinemix-bundled', expiration: { maxEntries: 40, maxAgeSeconds: 60 * 60 * 24 * 30 } } },
            // 認証レスポンス・非公開素材は共有キャッシュしない
            { urlPattern: /supabase\.co\//, handler: 'NetworkOnly' },
          ],
        },
        devOptions: { enabled: false },
      }),
    ],
    server: { port: 5173, strictPort: false, ...(https ? { https } : {}) },
    preview: { port: 4173, strictPort: true },
    build: { target: 'es2022', sourcemap: false, chunkSizeWarningLimit: 1500 },
    optimizeDeps: { exclude: ['@mediabunny/mp3-encoder'] },
    worker: { format: 'es' },
    define: { __APP_VERSION__: JSON.stringify(process.env['npm_package_version'] ?? '0.1.0') },
  };
});
