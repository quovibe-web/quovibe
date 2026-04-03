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

export default defineConfig({
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
  server: {
    host: '0.0.0.0',
    watch: { usePolling: true },
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
