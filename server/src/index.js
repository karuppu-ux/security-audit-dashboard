import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

async function main() {
  // Connect before listening: an instance that accepts traffic it cannot serve
  // is worse than one that is briefly unavailable.
  await connectDatabase();

  const server = createApp().listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT} (${env.NODE_ENV})`);
  });

  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down`);
    // Stop accepting connections, let in-flight requests finish, then close the
    // pool. Killing the DB connection first would fail those requests.
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
    // Backstop: never hang a deploy on a stuck socket.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  logger.error('Failed to start server', error);
  process.exit(1);
});
