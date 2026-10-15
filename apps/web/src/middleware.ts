import { defineMiddleware } from 'astro:middleware';
import { startBackupScheduler } from './lib/backup-runner';

// Starts background jobs once per server process (idempotent).
export const onRequest = defineMiddleware((_ctx, next) => {
  startBackupScheduler();
  return next();
});
