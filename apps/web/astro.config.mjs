// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

export default defineConfig({
  output: 'server',
  // Astro's built-in check compares Origin to the in-cluster http URL and rejects every form post behind the Olares proxy.
  // Every POST handler (rate.ts, logout.ts) does its own host-based sameOrigin() check instead; keep it that way for new POST routes.
  security: { checkOrigin: false },
  adapter: node({ mode: 'standalone' }),
  vite: { ssr: { noExternal: ['@rogue/core'] } },
});
