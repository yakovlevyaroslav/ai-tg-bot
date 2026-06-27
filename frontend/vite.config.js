import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { htmlIncludesPlugin } from './plugins/html-includes.js';
import { htmlMinifyPlugin } from './plugins/html-minify.js';

const rootDir = fileURLToPath(new URL('.', import.meta.url));
const pagesDir = resolve(rootDir, 'pages');
const outDir = resolve(rootDir, '../dist');

const pageInputs = {
  landing: resolve(pagesDir, 'landing/landing.html'),
  privacy: resolve(pagesDir, 'privacy/privacy.html'),
  cookies: resolve(pagesDir, 'cookies/cookies.html'),
  onboarding: resolve(pagesDir, 'onboarding/onboarding.html'),
  visitCard: resolve(pagesDir, 'visit-card/visit-card.html'),
};

export default defineConfig(({ mode }) => {
  const isProd = mode === 'production';

  return {
    plugins: [htmlIncludesPlugin(), isProd && htmlMinifyPlugin()].filter(Boolean),
    root: pagesDir,
    publicDir: resolve(rootDir, 'public'),
    build: {
      outDir,
      emptyOutDir: true,
      minify: isProd ? 'esbuild' : false,
      cssMinify: isProd,
      sourcemap: !isProd,
      reportCompressedSize: isProd,
      target: isProd ? 'es2018' : 'esnext',
      esbuild: isProd
        ? {
            legalComments: 'none',
          }
        : undefined,
      rollupOptions: {
        input: pageInputs,
        output: {
          entryFileNames: isProd ? 'assets/[name]-[hash].js' : 'assets/[name].js',
          chunkFileNames: isProd ? 'assets/[name]-[hash].js' : 'assets/[name].js',
          assetFileNames: isProd ? 'assets/[name]-[hash][extname]' : 'assets/[name][extname]',
        },
      },
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: 'http://localhost:3080',
          changeOrigin: true,
        },
      },
    },
  };
});
