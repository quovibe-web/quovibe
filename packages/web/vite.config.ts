import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'path';
import { execSync } from 'child_process';

function getGitVersion(): string {
  if (process.env.APP_VERSION) return process.env.APP_VERSION;
  try {
    return execSync('git tag --sort=-v:refname').toString().trim().split('\n')[0] || 'v0.0.0';
  } catch {
    return 'v0.0.0';
  }
}

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(getGitVersion()),
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@quovibe/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  // esbuild handles minification + transform. Drop console + debugger only
  // for production builds — dev keeps them so DevTools investigations work.
  esbuild: command === 'build' ? { drop: ['console', 'debugger'] } : {},
  build: {
    // Source maps off in prod: they leak the entire module tree to anyone
    // with DevTools open. Re-enable to 'hidden' if Sentry-style upload is
    // ever wired up.
    sourcemap: false,
    minify: 'esbuild',
  },
  server: {
    host: '0.0.0.0',
    watch: { usePolling: true },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            if ((err as NodeJS.ErrnoException).code === 'ECONNREFUSED') {
              if (!res.headersSent) {
                (res as import('http').ServerResponse).writeHead(503);
                res.end();
              }
              return;
            }
            console.error('[vite proxy]', err.message);
          });
        },
      },
    },
  },
}));
