import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
import { readdirSync } from 'node:fs';

const root = fileURLToPath(new URL('.', import.meta.url));
const sandboxes = Object.fromEntries(
  readdirSync(root + 'sandbox')
    .filter((f) => f.endsWith('.html'))
    .map((f) => ['sandbox_' + f.replace('.html', ''), root + 'sandbox/' + f]),
);

export default defineConfig(({ command }) => ({
  // GitHub Pages serves the game from /kart/
  base: command === 'build' ? '/kart/' : '/',
  resolve: { alias: { '@': root + 'src' } },
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: root + 'index.html', ...sandboxes } },
  },
  server: { host: '127.0.0.1' },
  test: { environment: 'node', include: ['tests/**/*.test.ts'] },
}));
