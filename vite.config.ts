import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // GitHub Pages serves the game from /<repository>/; the deploy workflow sets
  // BASE_PATH. Locally it is the site root.
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  server: { port: 5173 },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as Parameters<typeof defineConfig>[0]);
