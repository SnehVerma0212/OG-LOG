import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// Pure TypeScript modules shared with the mobile app. They must not import any
// package (see src/test/sharedModules.test.ts), so they cannot pull React
// Native, Expo or a second copy of React into the web bundle.
const sharedDomain = fileURLToPath(new URL('../src/domain', import.meta.url));
const sharedUtils = fileURLToPath(new URL('../src/utils', import.meta.url));
const sharedSingleFlight = `${sharedUtils}/singleFlight.ts`;
const webRoot = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  resolve: {
    alias: {
      '@og-log/domain': sharedDomain,
      '@og-log/single-flight': sharedSingleFlight,
    },
  },
  server: {
    // The dev/test server may read the web app and the shared folders only, so
    // the rest of the mobile source stays unreachable. (A folder is listed for
    // utils because Vite checks `?raw` reads against folders, not single files.)
    fs: { strict: true, allow: [webRoot, sharedDomain, sharedUtils] },
  },
  test:
    mode === 'integration'
      ? {
          // `npm run test:integration`: real Supabase project. Only OGLOG_IT_*
          // variables are loaded (from web/.env.integration.local), never VITE_*
          // ones, so nothing here can reach a browser bundle.
          environment: 'node',
          include: ['supabase/integration/**/*.integration.test.ts'],
          env: loadEnv(mode, webRoot, 'OGLOG_IT_'),
          testTimeout: 30_000,
          hookTimeout: 30_000,
        }
      : {
          environment: 'jsdom',
          include: ['src/**/*.test.{ts,tsx}', 'supabase/tests/**/*.test.ts'],
          setupFiles: ['./src/test/setup.ts'],
          restoreMocks: true,
        },
}));
